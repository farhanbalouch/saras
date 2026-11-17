"""Staging Supabase Auth adapter. Tokens never enter browser storage or logs."""
import base64,hashlib,json,os,re,secrets,threading,time,urllib.request,urllib.error
from urllib.parse import urlencode,urlsplit

PRODUCTION_REF='pahpvndzfdngxpfdvrqy'
class AuthUnavailable(RuntimeError):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class SupabaseAuth:
    def __init__(self):
        self.url=os.getenv('V2_SUPABASE_URL','').rstrip('/')
        self.key=os.getenv('V2_SUPABASE_PUBLISHABLE_KEY','')
        self.ref=os.getenv('V2_STAGING_PROJECT_REF','')
        self.enabled=bool(self.url and self.key and self.ref)
        if self.enabled:
            u=urlsplit(self.url)
            production_approved=os.getenv('V2_ENVIRONMENT') in {'staging','production'} and os.getenv('V2_APPROVED_EXISTING_PROJECT')==self.ref
            if (self.ref==PRODUCTION_REF and not production_approved) or not re.fullmatch(r'[a-z]{20}',self.ref) or self.url!='https://'+self.ref+'.supabase.co':raise AuthUnavailable('V2 requires a separate staging project or an explicitly approved production project')
        self.opener=urllib.request.build_opener(NoRedirect())
    def call(self,path,data=None,token='',method=None):
        if not self.enabled:raise AuthUnavailable('Separate staging Auth project is not configured. No production login is used.')
        req=urllib.request.Request(self.url+'/auth/v1'+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'apikey':self.key,'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
        try:
            with self.opener.open(req,timeout=10) as response:
                raw=response.read(250001)
                if len(raw)>250000:raise AuthUnavailable('Authentication response exceeded size limit')
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code==429:raise AuthUnavailable('Authentication rate limit reached. Please wait before retrying.') from None
            if e.code>=500:raise AuthUnavailable('Authentication provider is temporarily unavailable.') from None
            raise PermissionError('Sign-in was not accepted. Check your details, email confirmation or provider configuration.') from None
        except (OSError,ValueError):raise AuthUnavailable('Cannot reach the staging authentication provider.') from None
    def providers(self):
        if not self.enabled:return {'email':False,'google':False,'facebook':False,'github':False}
        external=self.call('/settings').get('external',{})
        return {p:external.get(p) is True for p in ['email','google','facebook','github']}
    def login(self,email,password):return self.call('/token?grant_type=password',{'email':email,'password':password})
    def signup(self,email,password,name):return self.call('/signup',{'email':email,'password':password,'data':{'display_name':name}})
    def user(self,access):
        user=self.call('/user',token=access)
        if not isinstance(user.get('id'),str) or not user.get('email_confirmed_at'):raise PermissionError('Verified account required')
        return user
    def refresh(self,refresh):return self.call('/token?grant_type=refresh_token',{'refresh_token':refresh})
    def profile(self,access,name):return self.call('/user',{'data':{'display_name':name}},access,'PUT')
    def logout(self,access):return self.call('/logout?scope=local',{},access)
    def oauth_url(self,provider,verifier,callback):
        if provider not in {'google','facebook','github'} or not self.providers().get(provider):raise AuthUnavailable('This sign-in provider has not been enabled in staging')
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        return self.url+'/auth/v1/authorize?'+urlencode({'provider':provider,'redirect_to':callback,'code_challenge':challenge,'code_challenge_method':'s256'})
    def exchange(self,code,verifier):return self.call('/token?grant_type=pkce',{'auth_code':code,'code_verifier':verifier})

class Sessions:
    """Process-local development sessions. Restart logs users out; no token files."""
    def __init__(self,auth):self.auth=auth;self.items={};self.lock=threading.RLock()
    def create(self,tokens):
        user=self.auth.user(tokens['access_token'])
        identifier=secrets.token_urlsafe(32)
        with self.lock:
            now=time.time();self.items={k:v for k,v in self.items.items() if v['until']>now}
            if len(self.items)>=1000:raise AuthUnavailable('Staging session capacity reached')
            self.items[hashlib.sha256(identifier.encode()).hexdigest()]={'tokens':tokens,'user':user,'csrf':secrets.token_urlsafe(32),'until':now+43200,'refresh_at':now+max(1,int(tokens.get('expires_in',3600))-60)}
        return identifier
    def read(self,identifier):
        with self.lock:
            session=self.items.get(hashlib.sha256(identifier.encode()).hexdigest())
            if not session or session['until']<=time.time():raise PermissionError('Please sign in to your SARAS V2 account')
            if session['refresh_at']<=time.time():
                session['tokens']=self.auth.refresh(session['tokens']['refresh_token']);session['refresh_at']=time.time()+max(1,int(session['tokens'].get('expires_in',3600))-60)
            # Verify with the Auth service on every authorized request, not unverified JWT claims.
            session['user']=self.auth.user(session['tokens']['access_token'])
            return session
    def revoke(self,identifier):
        with self.lock:session=self.items.pop(hashlib.sha256(identifier.encode()).hexdigest(),None)
        if session:
            try:self.auth.logout(session['tokens']['access_token'])
            except (AuthUnavailable,PermissionError):pass
