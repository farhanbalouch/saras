"""Tenant-bound staging command queue using the existing Windows tool contract.

Claimed actions are never requeued: a lost acknowledgement is an unknown result,
not permission to execute the same computer action again.
"""
import base64,io,json,sys,uuid,wave
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'saras-next'))
from contracts import SPECS,validate
from speech_text import without_emoji

class Relay:
    def __init__(self,pairing):
        self.pairs=pairing;self.clock=pairing.clock
        if pairing.persistent:
            with pairing.db() as db:db.execute('SELECT device FROM relay_access LIMIT 1')
            return
        with pairing.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS relay_access(device TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS relay_commands(id TEXT PRIMARY KEY,device TEXT NOT NULL,owner TEXT NOT NULL,credential TEXT NOT NULL,tool TEXT NOT NULL,args TEXT NOT NULL,state TEXT NOT NULL,created REAL NOT NULL,expires REAL NOT NULL,result TEXT,ok INTEGER);
            CREATE TABLE IF NOT EXISTS relay_voices(device TEXT PRIMARY KEY,voices TEXT NOT NULL,at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS relay_speech(id TEXT PRIMARY KEY,device TEXT NOT NULL,owner TEXT NOT NULL,credential TEXT NOT NULL,text TEXT NOT NULL,voice TEXT NOT NULL,state TEXT NOT NULL,expires REAL NOT NULL,audio TEXT,cues TEXT);
            ''')
            # Restarting a staging service must not revive unattended control.
            db.execute('UPDATE relay_access SET enabled=0')
            db.execute('DELETE FROM relay_voices');db.execute('DELETE FROM relay_speech')
            db.execute("UPDATE relay_commands SET state='cancelled' WHERE state IN ('queued','claimed','running')")
    def owned(self,db,owner,device):
        row=db.execute('SELECT * FROM devices WHERE id=? AND owner=? AND revoked=0',(device,owner)).fetchone()
        if not row:raise PermissionError('Laptop unavailable in this account')
        return row
    def enabled(self,db,device):
        row=db.execute('SELECT enabled FROM relay_access WHERE device=?',(device,)).fetchone()
        return bool(row and row['enabled'])
    def access(self,owner,device,enabled,confirmed):
        if type(enabled) is not bool or confirmed is not True:raise ValueError('Explicit access approval required')
        with self.pairs.db() as db:
            self.owned(db,owner,device)
            db.execute('INSERT INTO relay_access(device,enabled) VALUES(?,?) ON CONFLICT(device) DO UPDATE SET enabled=excluded.enabled',(device,int(enabled)))
            if not enabled:
                db.execute("UPDATE relay_commands SET state='cancelled' WHERE device=? AND state IN ('queued','claimed','running')",(device,))
                db.execute('DELETE FROM relay_speech WHERE device=?',(device,))
        return {'enabled':enabled}
    def describe(self,owner,device):
        with self.pairs.db() as db:
            row=self.owned(db,owner,device)
            voices=db.execute('SELECT voices FROM relay_voices WHERE device=? AND at>?',(device,self.clock()-15)).fetchone()
            return {'enabled':self.enabled(db,device),'online':row['last_seen']>self.clock()-15,'voices':json.loads(voices['voices']) if voices else [],'tools':SPECS,'commands':[dict(r) for r in db.execute('SELECT id,tool,args,state,created,expires,result,ok FROM relay_commands WHERE device=? AND owner=? ORDER BY created DESC LIMIT 30',(device,owner))]}
    def enqueue(self,owner,device,tool,args,confirmed,confirmation=''):
        validate(tool,args)
        if confirmed is not True:raise ValueError('Review and approve the exact action first')
        phrase=SPECS[tool].get('confirmation')
        if phrase and confirmation!=phrase:raise ValueError('Type '+phrase+' to approve this action')
        with self.pairs.db() as db:
            row=self.owned(db,owner,device)
            if not self.enabled(db,device):raise PermissionError('Enable remote access for this laptop first')
            if row['last_seen']<self.clock()-15:raise ValueError('Laptop is offline. No action was queued.')
            count=db.execute("SELECT count(*) FROM relay_commands WHERE device=? AND state IN ('queued','claimed') AND expires>?",(device,self.clock())).fetchone()[0]
            if count>=5:raise ValueError('Wait for the existing actions to finish')
            identifier=uuid.uuid4().hex
            if tool=='stop_scroll':db.execute("UPDATE relay_commands SET state='cancelled' WHERE device=? AND tool='desktop_scroll_start' AND state IN ('queued','claimed','running')",(device,))
            db.execute("INSERT INTO relay_commands(id,device,owner,credential,tool,args,state,created,expires) VALUES(?,?,?,?,?,?,'queued',?,?)",(identifier,device,owner,row['token_hash'],tool,json.dumps(args,ensure_ascii=False),self.clock(),self.clock()+60))
        return {'id':identifier,'state':'queued'}
    def poll(self,token):
        device=self.pairs.verify_device(token)
        with self.pairs.db() as db:
            enabled=self.enabled(db,device['id']);command=None
            db.execute("UPDATE relay_commands SET state='expired' WHERE device=? AND state IN ('queued','claimed','running') AND expires<=?",(device['id'],self.clock()))
            if enabled:
                row=db.execute("SELECT id,tool,args FROM relay_commands WHERE device=? AND credential=? AND state='queued' AND expires>? ORDER BY created LIMIT 1",(device['id'],self.pairs.token_hash(token),self.clock())).fetchone()
                if row:
                    command=dict(row);db.execute("UPDATE relay_commands SET state='claimed' WHERE id=?",(row['id'],))
        return {'enabled':enabled,'command':command}
    def status(self,token,identifier=None,scroll=False):
        device=self.pairs.verify_device(token)
        with self.pairs.db() as db:
            enabled=self.enabled(db,device['id'])
            if identifier:
                row=db.execute("SELECT id FROM relay_commands WHERE id=? AND device=? AND credential=? AND state IN ('claimed','running') AND expires>? AND (?=1 OR state='claimed')",(identifier,device['id'],self.pairs.token_hash(token),self.clock(),int(scroll))).fetchone()
                enabled=enabled and bool(row)
            return {'enabled':enabled}
    def result(self,token,identifier,ok,result):
        if type(ok) is not bool or not isinstance(result,str) or len(result)>32000:raise ValueError('Invalid command result')
        device=self.pairs.verify_device(token)
        with self.pairs.db() as db:
            row=db.execute("UPDATE relay_commands SET state=CASE WHEN tool='desktop_scroll_start' AND ?=1 THEN 'running' ELSE ? END,ok=?,result=? WHERE id=? AND device=? AND credential=? AND state='claimed' RETURNING id",(int(ok),'completed' if ok else 'failed',int(ok),result,identifier,device['id'],self.pairs.token_hash(token))).fetchone()
            if not row:raise PermissionError('Command was cancelled, already reported or belongs to another laptop')
        return {'ok':True}
    def scroll_finished(self,token,identifier,reason):
        device=self.pairs.verify_device(token)
        with self.pairs.db() as db:
            row=db.execute("UPDATE relay_commands SET state='completed',result=? WHERE id=? AND device=? AND credential=? AND tool='desktop_scroll_start' AND state='running' RETURNING id",(json.dumps(str(reason)[:500]),identifier,device['id'],self.pairs.token_hash(token))).fetchone()
            if not row:raise PermissionError('Scroll is not active for this laptop')
        return {'ok':True}
    def disable(self,token):
        device=self.pairs.verify_device(token)
        return self.access(device['owner'],device['id'],False,True)
    def voice_poll(self,token,voices):
        if not isinstance(voices,list) or len(voices)>150 or any(not isinstance(v,str) or not 1<=len(v)<=200 for v in voices):raise ValueError('Invalid installed voice list')
        device=self.pairs.verify_device(token)
        with self.pairs.db() as db:
            db.execute('DELETE FROM relay_speech WHERE expires<=?',(self.clock(),))
            db.execute('INSERT INTO relay_voices(device,voices,at) VALUES(?,?,?) ON CONFLICT(device) DO UPDATE SET voices=excluded.voices,at=excluded.at',(device['id'],json.dumps(voices),self.clock()))
            job=None
            if self.enabled(db,device['id']):
                row=db.execute("SELECT id,text,voice FROM relay_speech WHERE device=? AND credential=? AND state='queued' ORDER BY expires LIMIT 1",(device['id'],self.pairs.token_hash(token))).fetchone()
                if row:
                    job=dict(row);db.execute("UPDATE relay_speech SET state='claimed' WHERE id=?",(row['id'],))
            return {'job':job}
    def voice_create(self,owner,device,text,voice,confirmed):
        limit=90 if isinstance(voice,str) and voice.startswith('kokoro-') else 300
        if confirmed is not True or not isinstance(text,str) or not 1<=len(text.strip())<=limit:raise ValueError('Review and approve 1–'+str(limit)+' characters of speech for this voice')
        text=without_emoji(text)
        if not text:raise ValueError('Enter spoken words; emoji alone cannot be spoken')
        with self.pairs.db() as db:
            row=self.owned(db,owner,device);catalog=db.execute('SELECT voices FROM relay_voices WHERE device=? AND at>?',(device,self.clock()-15)).fetchone()
            if not self.enabled(db,device) or not catalog or voice not in json.loads(catalog['voices']):raise ValueError('This installed laptop voice is not currently available or access is stopped')
            db.execute('DELETE FROM relay_speech WHERE expires<=?',(self.clock(),))
            if db.execute('SELECT count(*) FROM relay_speech WHERE device=?',(device,)).fetchone()[0]>=3:raise ValueError('Finish the existing speech requests first')
            identifier=uuid.uuid4().hex
            db.execute("INSERT INTO relay_speech(id,device,owner,credential,text,voice,state,expires) VALUES(?,?,?,?,?,?,'queued',?)",(identifier,device,owner,row['token_hash'],text.strip(),voice,self.clock()+120))
        return {'id':identifier,'state':'queued'}
    def voice_result(self,token,identifier,audio,cues):
        device=self.pairs.verify_device(token)
        if audio is not None:
            if not isinstance(audio,str) or len(audio)>1333340:raise ValueError('Speech audio is too large')
            try:
                raw=base64.b64decode(audio,validate=True)
                with wave.open(io.BytesIO(raw),'rb') as wav:
                    if not 8000<=wav.getframerate()<=96000 or wav.getnchannels() not in {1,2} or wav.getsampwidth() not in {1,2,3,4} or wav.getnframes()/wav.getframerate()>90:raise ValueError('Unsupported WAV')
            except Exception:raise ValueError('Valid PCM WAV audio required') from None
        # Mouth cues are not interpreted by the staging mobile audio player.
        with self.pairs.db() as db:
            row=db.execute("UPDATE relay_speech SET state=?,audio=?,cues='[]' WHERE id=? AND device=? AND credential=? AND state='claimed' AND expires>? RETURNING id",('done' if audio else 'failed',audio,identifier,device['id'],self.pairs.token_hash(token),self.clock())).fetchone()
            if not row:raise PermissionError('Speech request expired or belongs to another laptop')
        return {'ok':True}
    def voice_job(self,owner,device,identifier):
        with self.pairs.db() as db:
            current=self.owned(db,owner,device)
            row=db.execute('SELECT state,audio,cues FROM relay_speech WHERE id=? AND device=? AND owner=? AND credential=? AND expires>?',(identifier,device,owner,current['token_hash'],self.clock())).fetchone()
            if not row or not self.enabled(db,device):raise PermissionError('Speech request unavailable in this account or access stopped')
            return dict(row)
