"""Encrypted durable sessions/OAuth state and account profiles for stateless workers."""
import hashlib,json,re,secrets,time
from cryptography.fernet import Fernet,InvalidToken

class SharedState:
    def __init__(self,database,key,clock=time.time):self.database=database;self.cipher=Fernet(key);self.clock=clock
    def seal(self,value):return self.cipher.encrypt(json.dumps(value,ensure_ascii=False).encode()).decode()
    def open(self,value):
        try:return json.loads(self.cipher.decrypt(value.encode()))
        except (InvalidToken,ValueError):raise PermissionError('Protected session is unavailable. Sign in again.') from None
    @staticmethod
    def digest(value):return hashlib.sha256(value.encode()).hexdigest()
    def rate(self,key,limit,window=60):
        identifier=self.digest(key);bucket=int(self.clock()//window)
        with self.database.db(lock='rate:'+identifier) as db:
            row=db.execute('INSERT INTO request_rates AS current_rate(id,bucket,count) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN current_rate.bucket=excluded.bucket THEN current_rate.count+1 ELSE 1 END,bucket=excluded.bucket RETURNING count',(identifier,bucket)).fetchone()
            if row[0]>limit:raise ValueError('Too many requests. Please wait and try again.')
    def oauth_create(self,identifier,verifier):
        with self.database.db() as db:
            db.execute('DELETE FROM oauth_states WHERE expires<?',(self.clock(),))
            db.execute('INSERT INTO oauth_states VALUES(?,?,?)',(self.digest(identifier),self.seal({'verifier':verifier}),self.clock()+600))
    def oauth_consume(self,identifier):
        with self.database.db() as db:row=db.execute('DELETE FROM oauth_states WHERE id=? AND expires>? RETURNING sealed',(self.digest(identifier),self.clock())).fetchone()
        if not row:raise PermissionError('Sign-in expired or was already used. Start sign-in again.')
        return self.open(row[0])
    def profile(self,owner):
        with self.database.db() as db:row=db.execute('SELECT username,display_name FROM profiles WHERE owner=?',(owner,)).fetchone()
        return dict(row) if row else None
    def save_profile(self,owner,username,name):
        if not isinstance(username,str) or not re.fullmatch('[a-z][a-z0-9_]{2,23}',username):raise ValueError('Username: 3–24 lowercase letters, digits or underscores; start with a letter')
        if not isinstance(name,str) or not 1<=len(name.strip())<=80:raise ValueError('Use a display name of 1–80 characters')
        with self.database.db() as db:
            prior=db.execute('SELECT owner FROM profiles WHERE username=?',(username,)).fetchone()
            if prior and prior[0]!=owner:raise ValueError('This username is taken. Choose another one.')
            db.execute('INSERT INTO profiles(owner,username,display_name,created) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET username=excluded.username,display_name=excluded.display_name',(owner,username,name.strip(),self.clock()))
        return self.profile(owner)

class DurableSessions:
    def app_lock(self,identifier,action,pin='',current_pin=''):
        key=self.state.digest(identifier)
        with self.state.database.db(lock='session:'+key) as db:
            row=db.execute('SELECT sealed FROM web_sessions WHERE id=? AND expires>?',(key,self.state.clock())).fetchone()
            if not row:raise PermissionError('Please sign in to your SARAS account')
            s=self.state.open(row[0])
            def matches(value):
                import hmac
                return isinstance(value,str) and hmac.compare_digest(hashlib.pbkdf2_hmac('sha256',value.encode(),bytes.fromhex(s['pin_salt']),300000).hex(),s['pin_hash'])
            if action=='configure':
                if s.get('pin_hash') and not matches(current_pin):raise PermissionError('Current SARAS app PIN is incorrect')
                if not isinstance(pin,str) or not re.fullmatch(r'[0-9]{6,12}',pin):raise ValueError('Choose a SARAS app PIN of 6–12 digits')
                s['pin_salt']=secrets.token_hex(16);s['pin_hash']=hashlib.pbkdf2_hmac('sha256',pin.encode(),bytes.fromhex(s['pin_salt']),300000).hex();s['unlocked_until']=self.state.clock()+900
            elif action=='unlock':
                if not s.get('pin_hash') or not matches(pin):raise PermissionError('SARAS app PIN is incorrect')
                s['unlocked_until']=self.state.clock()+900
            elif action=='lock':
                if s.get('pin_hash'):s['unlocked_until']=0
                db.execute("UPDATE controller_jobs SET state='cancelled' WHERE session_id=? AND state IN ('queued','claimed')",(key,))
            else:raise ValueError('Unsupported app lock action')
            db.execute('UPDATE web_sessions SET sealed=? WHERE id=?',(self.state.seal(s),key))
        return {'ok':True}
    def __init__(self,auth,state):self.auth=auth;self.state=state
    def create(self,tokens):
        user=self.auth.user(tokens['access_token']);identifier=secrets.token_urlsafe(32);now=self.state.clock()
        session={'tokens':tokens,'user':user,'csrf':secrets.token_urlsafe(32),'until':now+2592000,'refresh_at':now+max(1,int(tokens.get('expires_in',3600))-60)}
        with self.state.database.db() as db:
            db.execute('DELETE FROM web_sessions WHERE expires<?',(now,))
            db.execute('INSERT INTO web_sessions VALUES(?,?,?)',(self.state.digest(identifier),self.state.seal(session),session['until']))
        return identifier
    def read(self,identifier):
        key=self.state.digest(identifier)
        with self.state.database.db(lock='session:'+key) as db:
            row=db.execute('SELECT sealed FROM web_sessions WHERE id=? AND expires>?',(key,self.state.clock())).fetchone()
            if not row:raise PermissionError('Please sign in to your SARAS account')
            session=self.state.open(row[0])
            if session['refresh_at']<=self.state.clock():
                session['tokens']=self.auth.refresh(session['tokens']['refresh_token']);session['refresh_at']=self.state.clock()+max(1,int(session['tokens'].get('expires_in',3600))-60)
            session['user']=self.auth.user(session['tokens']['access_token'])
            if session.get('pin_hash') and session.get('unlocked_until',0)>self.state.clock():
                session['unlocked_until']=self.state.clock()+900
            session['until']=self.state.clock()+2592000
            db.execute('UPDATE web_sessions SET sealed=?,expires=? WHERE id=?',(self.state.seal(session),session['until'],key))
        session['id']=key;return session
    def revoke(self,identifier):
        key=self.state.digest(identifier)
        with self.state.database.db(lock='session:'+key) as db:
            row=db.execute('DELETE FROM web_sessions WHERE id=? RETURNING sealed',(key,)).fetchone()
            db.execute("UPDATE controller_jobs SET state='cancelled' WHERE session_id=? AND state IN ('queued','claimed')",(key,))
        if row:
            try:self.auth.logout(self.state.open(row[0])['tokens']['access_token'])
            except Exception:pass
