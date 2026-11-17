"""Account-owned, two-party staging pairing. No authority from an 8-digit code alone."""
import hashlib,hmac,json,secrets,sqlite3,time,uuid
from contextlib import contextmanager
from pathlib import Path

class Pairing:
    def __init__(self,path,origin,clock=time.time,store=None,pepper=None):
        self.store=store;self.persistent=store is not None
        self.path=Path(path);self.origin=origin;self.clock=clock;self.pepper=pepper or secrets.token_bytes(32)
        if self.persistent:
            if not pepper or len(pepper)!=32:raise ValueError('Persistent pairing requires a stable server-side secret')
            with self.db() as db:db.execute('SELECT id FROM pairs LIMIT 1')
            return
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS pairs(id TEXT PRIMARY KEY,owner TEXT,code_hash TEXT UNIQUE,proof_hash TEXT NOT NULL,challenge_hash TEXT,device_id TEXT,name TEXT,compare_code TEXT NOT NULL,expires REAL NOT NULL,claimed INTEGER DEFAULT 0,mobile_ok INTEGER DEFAULT 0,local_ok INTEGER DEFAULT 0,finished INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,owner TEXT NOT NULL,installation TEXT NOT NULL,name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,revoked INTEGER DEFAULT 0,created REAL NOT NULL,last_seen REAL DEFAULT 0,UNIQUE(owner,installation));
            CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,device TEXT,kind TEXT NOT NULL,at REAL NOT NULL);
            ''')
            # Pairing challenges do not survive process restart; persistent device identities do.
            db.execute('DELETE FROM pairs')
    @contextmanager
    def db(self):
        if self.store:
            with self.store.db() as db:yield db
            return
        db=sqlite3.connect(self.path,timeout=10)
        try:
            db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON');db.execute('BEGIN IMMEDIATE')
            with db:yield db
        finally:db.close()
    def digest(self,value):return hmac.new(self.pepper,str(value).encode(),hashlib.sha256).hexdigest()
    @staticmethod
    def token_hash(value):return hashlib.sha256(str(value).encode()).hexdigest()
    @staticmethod
    def identity(value):
        if not isinstance(value,str) or len(value)>100 or len(value)<8:raise ValueError('Invalid device identity')
        return value
    def create(self,owner,label=''):
        if not owner:raise PermissionError('Sign-in required')
        identifier=uuid.uuid4().hex;code=str(secrets.randbelow(90000000)+10000000);proof=secrets.token_urlsafe(32)
        with self.db() as db:
            db.execute('DELETE FROM pairs WHERE expires<?',(self.clock(),))
            if db.execute('SELECT count(*) FROM pairs WHERE owner=? AND finished=0',(owner,)).fetchone()[0]>=5:raise ValueError('Finish or wait for existing pairing codes to expire')
            db.execute('INSERT INTO pairs(id,owner,code_hash,proof_hash,compare_code,expires) VALUES(?,?,?,?,?,?)',(identifier,owner,self.digest(code),self.token_hash(proof),str(secrets.randbelow(900000)+100000),self.clock()+900))
            if self.persistent:db.execute('UPDATE pairs SET account_label=? WHERE id=?',(str(label)[:254],identifier))
        return {'id':identifier,'code':code,'expires_in':900}
    def _read(self,db,identifier):
        row=db.execute('SELECT * FROM pairs WHERE id=? AND expires>? AND finished=0',(identifier,self.clock())).fetchone()
        if not row:raise ValueError('Pairing expired, already used or unavailable')
        return row
    def claim(self,code,installation,name):
        self.identity(installation)
        if not isinstance(code,str) or len(code)!=8 or not code.isascii() or not code.isdigit():raise ValueError('Enter the 8-digit mobile pairing code')
        proof=secrets.token_urlsafe(32)
        with self.db() as db:
            row=db.execute('SELECT id FROM pairs WHERE code_hash=? AND expires>? AND claimed=0 AND finished=0',(self.digest(code),self.clock())).fetchone()
            if not row:raise ValueError('Pairing code expired, incorrect or already used')
            db.execute('UPDATE pairs SET claimed=1,code_hash=NULL,device_id=?,name=?,proof_hash=? WHERE id=?',(installation,str(name)[:80],self.token_hash(proof),row['id']))
            row=self._read(db,row['id'])
            return {'id':row['id'],'proof':proof,'compare_code':row['compare_code'],'requesting_account':row['account_label'] if self.persistent else None,'expires_in':max(0,int(row['expires']-self.clock()))}
    def qr(self,installation,name):
        self.identity(installation);identifier=uuid.uuid4().hex;proof=secrets.token_urlsafe(32);challenge=secrets.token_urlsafe(32);code=str(secrets.randbelow(90000000)+10000000)
        with self.db() as db:
            db.execute('DELETE FROM pairs WHERE expires<?',(self.clock(),))
            db.execute('INSERT INTO pairs(id,proof_hash,challenge_hash,device_id,name,compare_code,expires,claimed) VALUES(?,?,?,?,?,?,?,1)',(identifier,self.token_hash(proof),self.token_hash(challenge),installation,str(name)[:80],str(secrets.randbelow(900000)+100000),self.clock()+900))
            row=self._read(db,identifier)
            db.execute('UPDATE pairs SET code_hash=? WHERE id=?',(self.digest(code),identifier))
        return {'id':identifier,'proof':proof,'compare_code':row['compare_code'],'code':code,'url':self.origin+'/mobile/?pair='+identifier+'#challenge='+challenge,'expires_in':900}
    def claim_mobile(self,owner,code,label=''):
        if not self.persistent:raise ValueError('Account pairing store is required')
        if not isinstance(code,str) or not re_code(code):raise ValueError('Enter the 8-digit laptop pairing code')
        with self.db() as db:
            row=db.execute('SELECT id FROM pairs WHERE code_hash=? AND owner IS NULL AND claimed=1 AND finished=0 AND expires>?',(self.digest(code),self.clock())).fetchone()
            if not row:raise ValueError('Laptop code is wrong, expired or already used')
            db.execute('UPDATE pairs SET owner=?,account_label=?,code_hash=NULL WHERE id=?',(owner,str(label)[:254],row['id']))
            identifier=row['id']
        return self.info(owner,identifier)
    def info(self,owner,identifier,challenge=''):
        with self.db() as db:
            complete=db.execute('SELECT id,name FROM pairs WHERE id=? AND owner=? AND finished=1 AND expires>?',(identifier,owner,self.clock())).fetchone()
            if complete:return {'id':identifier,'name':complete['name'],'complete':True}
            row=self._read(db,identifier)
            if row['owner']!=owner:
                if row['owner'] or not challenge or not hmac.compare_digest(self.token_hash(challenge),row['challenge_hash'] or ''):raise PermissionError('Pairing belongs to another account')
            return {'id':identifier,'name':row['name'],'claimed':bool(row['claimed']),'compare_code':row['compare_code'] if row['claimed'] else None,'local_approved':bool(row['local_ok']),'mobile_approved':bool(row['mobile_ok']),'expires_in':max(0,int(row['expires']-self.clock()))}
    def cancel(self,owner,identifier,challenge=''):
        with self.db() as db:
            row=db.execute('SELECT * FROM pairs WHERE id=? AND finished=0',(identifier,)).fetchone()
            if not row:return {'cancelled':True}
            if row['owner']!=owner:
                if row['owner'] or not challenge or not hmac.compare_digest(self.token_hash(challenge),row['challenge_hash'] or ''):raise PermissionError('Pairing belongs to another account')
            db.execute('DELETE FROM pairs WHERE id=?',(identifier,))
        return {'cancelled':True}
    def approve_mobile(self,owner,identifier,compare,approved,challenge='',label=''):
        if approved is not True:raise ValueError('Explicit mobile approval required')
        with self.db() as db:
            row=self._read(db,identifier)
            if not row['claimed'] or not hmac.compare_digest(str(compare),row['compare_code']):raise ValueError('Compare the code on both screens first')
            if row['owner']!=owner:
                if row['owner'] or not challenge or not hmac.compare_digest(self.token_hash(challenge),row['challenge_hash'] or ''):raise PermissionError('Pairing belongs to another account')
            db.execute('UPDATE pairs SET owner=?,mobile_ok=1,challenge_hash=NULL WHERE id=?',(owner,identifier))
            if self.persistent:db.execute('UPDATE pairs SET account_label=? WHERE id=?',(str(label)[:254],identifier))
        return {'ok':True}
    def approve_local(self,identifier,proof,compare,approved):
        if approved is not True:raise ValueError('Explicit approval on this laptop is required')
        with self.db() as db:
            row=self._read(db,identifier)
            if not hmac.compare_digest(self.token_hash(proof),row['proof_hash']):raise PermissionError('Wrong laptop proof')
            if self.persistent and not row['owner']:raise ValueError('Wait for the signed-in phone account before approving this laptop')
            if not hmac.compare_digest(str(compare),row['compare_code']):raise ValueError('Comparison code mismatch')
            db.execute('UPDATE pairs SET local_ok=1 WHERE id=?',(identifier,))
        return {'ok':True}
    def finish(self,identifier,proof):
        with self.db() as db:
            row=self._read(db,identifier)
            if not hmac.compare_digest(self.token_hash(proof),row['proof_hash']):raise PermissionError('Wrong laptop proof')
            if not row['mobile_ok'] or not row['local_ok'] or not row['owner']:return {'pending':True}
            existing=db.execute('SELECT id,owner FROM devices WHERE installation=? AND revoked=0',(row['device_id'],)).fetchone()
            if existing and existing['owner']!=row['owner']:raise PermissionError('Disconnect this laptop from its existing account before changing owner')
            token=secrets.token_urlsafe(32);device=existing['id'] if existing else uuid.uuid4().hex
            previous=db.execute('SELECT id FROM devices WHERE owner=? AND installation=?',(row['owner'],row['device_id'])).fetchone()
            if previous:device=previous['id'];db.execute('UPDATE devices SET token_hash=?,revoked=0,name=? WHERE id=?',(self.token_hash(token),row['name'],device))
            else:db.execute('INSERT INTO devices(id,owner,installation,name,token_hash,created) VALUES(?,?,?,?,?,?)',(device,row['owner'],row['device_id'],row['name'],self.token_hash(token),self.clock()))
            db.execute('UPDATE pairs SET finished=1 WHERE id=?',(identifier,));db.execute('INSERT INTO events(owner,device,kind,at) VALUES(?,?,?,?)',(row['owner'],device,'paired',self.clock()))
            return {'pending':False,'device_id':device,'token':token}
    def devices(self,owner):
        with self.db() as db:
            result=[]
            for row in db.execute('SELECT id,name,created,last_seen,revoked FROM devices WHERE owner=?',(owner,)):
                visible=db.execute("SELECT kind FROM events WHERE owner=? AND device=? AND kind IN ('hidden','paired') ORDER BY id DESC LIMIT 1",(owner,row['id'])).fetchone()
                if visible and visible['kind']=='hidden':continue
                pin=db.execute("SELECT kind FROM events WHERE owner=? AND device=? AND kind IN ('pinned','unpinned') ORDER BY id DESC LIMIT 1",(owner,row['id'])).fetchone()
                result.append({**dict(row),'online':not row['revoked'] and row['last_seen']>self.clock()-15,'pinned':bool(pin and pin['kind']=='pinned')})
            return sorted(result,key=lambda d:(not d['pinned'],-d['created']))
    def manage(self,owner,device,action,value=None,confirmed=False):
        with self.db() as db:
            row=db.execute('SELECT id FROM devices WHERE id=? AND owner=?',(device,owner)).fetchone()
            if not row:raise PermissionError('Device unavailable in this account')
            if action=='rename':
                if not isinstance(value,str) or not 1<=len(value.strip())<=80 or any(ord(c)<32 for c in value):raise ValueError('Use a device name of 1–80 visible characters')
                db.execute('UPDATE devices SET name=? WHERE id=? AND owner=?',(value.strip(),device,owner));kind='renamed'
            elif action=='pin':
                if type(value) is not bool:raise ValueError('Choose pin or unpin')
                kind='pinned' if value else 'unpinned'
            elif action in {'block','remove'}:
                if confirmed is not True:raise ValueError('Confirm revoking this laptop access first')
                db.execute('UPDATE devices SET revoked=1 WHERE id=? AND owner=?',(device,owner));kind='hidden' if action=='remove' else 'revoked'
            else:raise ValueError('Unsupported device option')
            db.execute('INSERT INTO events(owner,device,kind,at) VALUES(?,?,?,?)',(owner,device,kind,self.clock()))
        return {'ok':True}
    def revoke(self,owner,device,confirmed):
        if confirmed is not True:raise ValueError('Confirm disconnecting this laptop')
        with self.db() as db:
            row=db.execute('UPDATE devices SET revoked=1 WHERE id=? AND owner=? RETURNING id',(device,owner)).fetchone()
            if not row:raise PermissionError('Device unavailable in this account')
            db.execute('INSERT INTO events(owner,device,kind,at) VALUES(?,?,?,?)',(owner,device,'revoked',self.clock()))
        return {'ok':True}
    def verify_device(self,token):
        with self.db() as db:
            row=db.execute('SELECT id,owner,name FROM devices WHERE token_hash=? AND revoked=0',(self.token_hash(token),)).fetchone()
            if not row:raise PermissionError('Device pairing is invalid or revoked')
            db.execute('UPDATE devices SET last_seen=? WHERE id=?',(self.clock(),row['id']))
            return dict(row)
    def desktop_info(self,identifier,proof):
        with self.db() as db:
            row=self._read(db,identifier)
            if not hmac.compare_digest(self.token_hash(proof),row['proof_hash']):raise PermissionError('Wrong laptop proof')
            return {'requesting_account':row['account_label'] if self.persistent else row['owner'],'mobile_approved':bool(row['mobile_ok']),'compare_code':row['compare_code']}

def re_code(code):return len(code)==8 and code.isascii() and code.isdigit()
