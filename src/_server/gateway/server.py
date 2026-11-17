"""Local V2 staging gateway; never deploy this process-local session store to Vercel."""
import hashlib,hmac,json,os,re,secrets,sys,threading,time
from cryptography.fernet import Fernet
from pathlib import Path
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer
from urllib.parse import parse_qs,urlsplit
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from preview import Handler as Preview
from auth import SupabaseAuth,Sessions,AuthUnavailable
from pairing import Pairing
from relay import Relay
from database import Database
from shared_state import SharedState,DurableSessions
from controller_relay import ControllerRelay
from feature_policy import FeaturePolicy

ORIGIN='http://127.0.0.1:8920'
class GatewayState:
    def __init__(self,auth=None,database=None,store=None,state_key=None,origin=ORIGIN,public=False):
        parsed=urlsplit(origin)
        if origin!=ORIGIN and (parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.port not in {None,443} or parsed.path or parsed.query or parsed.fragment):raise ValueError('Use a clean HTTPS controller origin')
        if public and (not store or not store.dsn or not state_key):raise ValueError('Public controller requires durable Postgres and protected server state')
        self.origin=origin;self.secure=parsed.scheme=='https';self.public=public
        self.auth=auth or SupabaseAuth()
        self.store=store or Database(path=database or ROOT/'userdata/v2-gateway.db')
        if not self.store.dsn:self.store.initialize_local()
        state_key=state_key or os.getenv('V2_STATE_KEY','').encode() or Fernet.generate_key()
        self.shared=SharedState(self.store,state_key);self.sessions=DurableSessions(self.auth,self.shared)
        self.pairs=Pairing(database or ROOT/'userdata/v2-gateway.db',origin,store=self.store,pepper=hashlib.sha256(state_key+b'pairing-v2').digest())
        self.relay=Relay(self.pairs)
        self.controller=ControllerRelay(self.pairs,self.shared)
        self.features=FeaturePolicy(public)
        self.rates={};self.oauth={};self.state_lock=threading.RLock()

class Gateway(ThreadingHTTPServer):
    def __init__(self,address,auth=None,database=None,**configuration):
        self.__dict__.update(GatewayState(auth,database,**configuration).__dict__)
        super().__init__(address,Handler)

class Handler(Preview):
    def log_message(self,format,*args):
        # Never log credentials, OAuth callback query strings, pairing challenges or request bodies.
        pass
    def end_headers(self):
        if urlsplit(self.path).path=='/mobile/sw.js':self.send_header('Service-Worker-Allowed','/')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        super().end_headers()
    def json(self,data,status=200,cookie=None):
        raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Robots-Tag','noindex,nofollow')
        if cookie:self.send_header('Set-Cookie',cookie)
        self.end_headers();self.wfile.write(raw)
    def cookie(self,name):
        try:c=SimpleCookie();c.load(self.headers.get('Cookie',''));return c[name].value if name in c else ''
        except Exception:return ''
    def rate(self,bucket,limit=20):
        return self.server.shared.rate(self.client_address[0]+':'+bucket,limit)
    def agent_status(self,token):
        state=self.server.relay.status(token)
        policy=self.server.features.state(self.headers.get('X-SARAS-Companion-Version',''))
        return {**state,**policy,'enabled':state['enabled'] and policy['policy_enabled']}
    def set_session_cookie(self,identifier='',oauth=False,clear=False):
        name='saras_v2_oauth' if oauth else 'saras_v2'
        if self.server.secure:name='__Host-'+name
        return name+'='+identifier+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+('0' if clear else '600' if oauth else '2592000')+('; Secure' if self.server.secure else '')
    def session_cookie(self,oauth=False):return self.cookie(('__Host-' if self.server.secure else '')+('saras_v2_oauth' if oauth else 'saras_v2'))
    def old_rate(self,bucket,limit=20):
        now=time.monotonic();key=(self.client_address[0],bucket)
        with self.server.state_lock:
            self.server.rates={k:v for k,v in self.server.rates.items() if v[0]>now-60}
            start,count=self.server.rates.get(key,(now,0))
            if count>=limit:raise ValueError('Too many requests. Please wait one minute.')
            self.server.rates[key]=(start,count+1)
    def session(self,mutation=False):
        s=self.server.sessions.read(self.session_cookie())
        if mutation and not hmac.compare_digest(self.headers.get('X-CSRF-Token',''),s['csrf']):raise PermissionError('Refresh this page before changing account or device settings')
        route=urlsplit(self.path).path
        if s.get('pin_hash') and s.get('unlocked_until',0)<=self.server.shared.clock() and route not in {'/api/v2/session','/api/v2/auth/app-lock','/api/v2/auth/logout'}:raise PermissionError('SARAS app is locked. Unlock it in My Devices.')
        return s
    def host_valid(self):return self.headers.get('Host')==urlsplit(self.server.origin).netloc
    def device_token(self):
        value=self.headers.get('Authorization','')
        if not value.startswith('Bearer ') or not 32<=len(value[7:])<=200:raise PermissionError('Paired laptop credential required')
        return value[7:]
    def do_GET(self):
        if not self.host_valid():return self.json({'error':'Host rejected'},403)
        path=urlsplit(self.path).path
        try:
            if path=='/' and self.server.public:
                self.send_response(303);self.send_header('Location','/mobile/');self.end_headers();return
            match=re.fullmatch(r'/account/([0-9a-f]{32})(?:/(.*))?',path)
            if match:
                tail=match[2] or ''
                try:session=self.session()
                except PermissionError:
                    if tail.startswith('api/'):raise
                    self.send_response(303);self.send_header('Location','/mobile/');self.end_headers();return
                owner=session['user']['id'];device=match[1];self.server.relay.describe(owner,device)
                if tail.startswith('api/'):
                    self.rate('controller-read',120)
                    return self.json(self.server.controller.create(owner,device,session['id'],'GET','/'+tail,{}),202)
                if tail not in {'','index.html'}:return self.json({'error':'Not found'},404)
                text=(ROOT/'saras-next/web/index.html').read_text(encoding='utf-8')
                text=re.sub(r'(href|src)="/([^"?#]+)([^\"]*)"',lambda m:m[1]+'="/runtime-assets/'+m[2]+m[3]+'"',text)
                text=re.sub(r'<link rel="manifest"[^>]*>','<link rel="manifest" href="/mobile/manifest.webmanifest">',text)
                text=text.replace('</head>','<script src="/mobile/app-boundary.js"></script><script src="/mobile/controller-client.js"></script></head>')
                return self.reply(200,text.encode(),'text/html')
            if path=='/api/agent/poll':return self.json(self.server.relay.poll(self.device_token()))
            if path=='/api/agent/status':return self.json(self.agent_status(self.device_token()))
            if path.startswith('/api/agent/check/') or path.startswith('/api/agent/scroll-status/'):
                return self.json(self.server.relay.status(self.device_token(),path.rsplit('/',1)[1],scroll='/scroll-status/' in path))
            if path=='/api/v2/config':
                self.rate('config',60);providers=self.server.auth.providers()
                return self.json({'providers':providers,'auth_origin':self.server.auth.url,'environment':'public' if self.server.public else 'isolated-staging','message':'Account sign-in is configured.' if any(providers.values()) else 'Account sign-in has not been configured. No login or PC access is available yet.'})
            if path=='/api/v2/session':
                try:s=self.session()
                except PermissionError:return self.json({'user':None,'csrf':''})
                u=s['user'];profile=self.server.shared.profile(u['id']);return self.json({'user':{'id':u['id'],'email':u.get('email',''),'display_name':(profile or {}).get('display_name') or u.get('user_metadata',{}).get('display_name',''),'profile':profile},'csrf':s['csrf'],'pin_enabled':bool(s.get('pin_hash')),'locked':bool(s.get('pin_hash') and s.get('unlocked_until',0)<=self.server.shared.clock())},cookie=self.set_session_cookie(self.session_cookie()))
            if path=='/api/v2/devices':return self.json({'devices':self.server.pairs.devices(self.session()['user']['id'])})
            if path=='/auth/callback':
                args=parse_qs(urlsplit(self.path).query);identifier=self.session_cookie(oauth=True)
                state=self.server.shared.oauth_consume(identifier)
                if not args.get('code'):raise PermissionError('Sign-in was not approved. Start sign-in again.')
                tokens=self.server.auth.exchange(args['code'][0],state['verifier']);session=self.server.sessions.create(tokens)
                self.send_response(303);self.send_header('Location','/mobile/');self.send_header('Set-Cookie',self.set_session_cookie(session));self.send_header('Set-Cookie',self.set_session_cookie(oauth=True,clear=True));self.send_header('Cache-Control','no-store');self.end_headers();return
            if path.startswith('/api/'):return self.json({'error':'This route is not available in V2 staging'},404)
            if self.server.public and not path.startswith(('/mobile/','/runtime-assets/')):return self.json({'error':'Not found'},404)
            return super().do_GET()
        except (PermissionError,ValueError,AuthUnavailable) as e:return self.json({'error':str(e)},503 if isinstance(e,AuthUnavailable) else 403 if isinstance(e,PermissionError) else 400)
        except Exception:return self.json({'error':'The staging request could not be completed. No action was confirmed.'},500)
    def do_POST(self):
        agent_path=urlsplit(self.path).path
        native_agent=agent_path in {'/api/agent/result','/api/agent/disable','/api/agent/scroll-finished','/api/agent/voice-poll','/api/agent/voice-result','/api/agent/controller-poll','/api/agent/controller-result'}
        if not self.host_valid() or (self.headers.get('Origin')!=self.server.origin and not (native_agent and not self.headers.get('Origin'))):return self.json({'error':'Origin rejected'},403)
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.json({'error':'JSON request required'},415)
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=(3500000 if agent_path=='/api/agent/controller-result' else 1500000 if agent_path=='/api/agent/voice-result' else 65536):raise ValueError('Invalid request size')
            data=json.loads(self.rfile.read(size))
            if not isinstance(data,dict):raise ValueError('Object required')
            match=re.fullmatch(r'/account/([0-9a-f]{32})/(api/.*)',agent_path)
            if match:
                session=self.session(mutation=True);owner=session['user']['id'];device=match[1];path='/'+match[2]
                self.server.relay.describe(owner,device);self.rate('controller-write',120)
                if path=='/api/logout':
                    self.server.sessions.revoke(self.session_cookie());return self.json({'ok':True},cookie=self.set_session_cookie(clear=True))
                if path=='/api/remote':return self.json(self.server.relay.access(owner,device,data.get('enabled'),True))
                return self.json(self.server.controller.create(owner,device,session['id'],'POST',path,data),202)
            if native_agent:
                token=self.device_token();self.rate('agent-result:'+hashlib.sha256(token.encode()).hexdigest()[:16],240)
                if agent_path=='/api/agent/controller-poll':
                    status=self.agent_status(token)
                    return self.json({**(self.server.controller.poll(token) if status['enabled'] else {'job':None}),**status})
                if agent_path=='/api/agent/controller-result':return self.json(self.server.controller.finish(token,data.get('id'),data.get('response')))
                if agent_path=='/api/agent/voice-poll':return self.json(self.server.relay.voice_poll(token,data.get('voices')))
                if agent_path=='/api/agent/voice-result':return self.json(self.server.relay.voice_result(token,data.get('id'),data.get('audio'),data.get('cues',[])))
                if agent_path=='/api/agent/disable':return self.json(self.server.relay.disable(token))
                if agent_path=='/api/agent/scroll-finished':
                    return self.json(self.server.relay.scroll_finished(token,data.get('id'),data.get('reason','Stopped')))
                return self.json(self.server.relay.result(token,data.get('id'),data.get('ok'),data.get('result')))
            path=urlsplit(self.path).path.removeprefix('/api/v2/');self.rate(path,5 if path.startswith(('auth/','pairing/claim','pairing/qr')) else 60)
            if path in {'auth/login','auth/signup'}:
                email=data.get('email');password=data.get('password')
                if not isinstance(email,str) or len(email)>254 or '@' not in email or not isinstance(password,str) or not 12<=len(password)<=1024:raise ValueError('Enter a valid email and a password of 12–1024 characters')
                if path=='auth/signup':
                    name=data.get('name')
                    if not isinstance(name,str) or not 1<=len(name.strip())<=80 or any(ord(c)<32 for c in name):raise ValueError('Enter your name using 1–80 visible characters')
                    tokens=self.server.auth.signup(email,password,name.strip())
                else:tokens=self.server.auth.login(email,password)
                if not tokens.get('access_token'):return self.json({'message':'Check your email to confirm your new account, then sign in.'})
                identifier=self.server.sessions.create(tokens)
                return self.json({'ok':True},cookie=self.set_session_cookie(identifier))
            if path=='auth/oauth':
                identifier=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(48)
                url=self.server.auth.oauth_url(data.get('provider'),verifier,self.server.origin+'/auth/callback')
                self.server.shared.oauth_create(identifier,verifier)
                return self.json({'url':url},cookie=self.set_session_cookie(identifier,oauth=True))
            # Desktop proof endpoints are protected by an installation capability, not a mobile cookie.
            if path=='pairing/claim':return self.json(self.server.pairs.claim(data.get('code'),data.get('installation'),data.get('name','Windows laptop')))
            if path=='pairing/qr':return self.json(self.server.pairs.qr(data.get('installation'),data.get('name','Windows laptop')))
            if path=='pairing/local-approve':return self.json(self.server.pairs.approve_local(data.get('id'),data.get('proof'),data.get('compare'),data.get('approved')))
            if path=='pairing/finish':return self.json(self.server.pairs.finish(data.get('id'),data.get('proof')))
            if path=='pairing/desktop-info':return self.json(self.server.pairs.desktop_info(data.get('id'),data.get('proof')))
            if path=='device/revoke':
                device=self.server.pairs.verify_device(data.get('token',''))
                return self.json(self.server.pairs.revoke(device['owner'],device['id'],data.get('confirmed')))
            session=self.session(mutation=True);owner=session['user']['id']
            if self.server.public and path.startswith('pairing/') and not self.server.shared.profile(owner):raise ValueError('Choose your username in account settings before pairing a laptop')
            if path=='auth/app-lock':
                self.server.shared.rate('app-lock:'+session['id'],10,60)
                return self.json(self.server.sessions.app_lock(self.session_cookie(),data.get('action'),data.get('pin',''),data.get('current_pin','')))
            if path=='controller/job':return self.json(self.server.controller.read(owner,data.get('device'),data.get('id'),session['id']))
            if path=='control/info':return self.json(self.server.relay.describe(owner,data.get('device')))
            if path=='control/access':return self.json(self.server.relay.access(owner,data.get('device'),data.get('enabled'),data.get('confirmed')))
            if path=='control/send':return self.json(self.server.relay.enqueue(owner,data.get('device'),data.get('tool'),data.get('args'),data.get('confirmed'),data.get('confirmation','')))
            if path=='voice/create':return self.json(self.server.relay.voice_create(owner,data.get('device'),data.get('text'),data.get('voice'),data.get('confirmed')))
            if path=='voice/job':return self.json(self.server.relay.voice_job(owner,data.get('device'),data.get('id')))
            if path=='auth/logout':self.server.sessions.revoke(self.session_cookie());return self.json({'ok':True},cookie=self.set_session_cookie(clear=True))
            if path=='profile':
                name=data.get('name','')
                if not isinstance(name,str) or not 1<=len(name.strip())<=80:raise ValueError('Use a display name of 1–80 characters')
                return self.json({'profile':self.server.shared.save_profile(owner,data.get('username',''),name.strip())})
            if path=='pairing/create':return self.json(self.server.pairs.create(owner,session['user'].get('email','')))
            if path=='pairing/from-laptop':return self.json(self.server.pairs.claim_mobile(owner,data.get('code'),session['user'].get('email','')))
            if path=='pairing/info':return self.json(self.server.pairs.info(owner,data.get('id'),data.get('challenge','')))
            if path=='pairing/cancel':return self.json(self.server.pairs.cancel(owner,data.get('id'),data.get('challenge','')))
            if path=='pairing/approve':return self.json(self.server.pairs.approve_mobile(owner,data.get('id'),data.get('compare'),data.get('approved'),data.get('challenge',''),session['user'].get('email','')))
            if path=='devices/manage':return self.json(self.server.pairs.manage(owner,data.get('id'),data.get('action'),data.get('value'),data.get('confirmed')))
            if path=='devices/revoke':return self.json(self.server.pairs.revoke(owner,data.get('id'),data.get('confirmed')))
            return self.json({'error':'Unknown staging route'},404)
        except (PermissionError,ValueError,AuthUnavailable) as e:return self.json({'error':str(e)},503 if isinstance(e,AuthUnavailable) else 403 if isinstance(e,PermissionError) else 400)
        except Exception:return self.json({'error':'The staging request could not be completed. No action was confirmed.'},500)

if __name__=='__main__':
    if os.getenv('DATABASE_URL') or os.getenv('SARAS_NEXT_CLOUD'):raise SystemExit('V2 refuses inherited production database configuration')
    print('SARAS V2 isolated gateway + preview: '+ORIGIN,flush=True)
    Gateway(('127.0.0.1',8920)).serve_forever()
