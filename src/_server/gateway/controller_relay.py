"""Encrypted, device-owned request/acknowledgement bridge for the REAL controller."""
import base64,json,uuid
from controller_protocol import validate_request,MAX_RESULT

class ControllerRelay:
    def __init__(self,pairs,state):self.pairs=pairs;self.state=state;self.clock=pairs.clock
    def create(self,owner,device,session_id,method,path,body):
        request=validate_request(method,path,body)
        with self.pairs.db() as db:
            row=db.execute('SELECT token_hash,last_seen FROM devices WHERE id=? AND owner=? AND revoked=0',(device,owner)).fetchone()
            if not row:raise PermissionError('Laptop unavailable in this account')
            if row['last_seen']<self.clock()-15:raise ValueError('Laptop offline. Keep your companion connected; no request was sent.')
            session=db.execute('SELECT id FROM web_sessions WHERE id=? AND expires>?',(session_id,self.clock())).fetchone()
            if not session:raise PermissionError('Sign in again before using this laptop')
            db.execute('DELETE FROM controller_jobs WHERE expires<?',(self.clock()-60,))
            count=db.execute("SELECT count(*) FROM controller_jobs WHERE device=? AND state IN ('queued','claimed') AND expires>?",(device,self.clock())).fetchone()[0]
            if count>=8:raise ValueError('The companion is busy. Wait for its current requests to finish.')
            identifier=uuid.uuid4().hex
            db.execute("INSERT INTO controller_jobs(id,device,owner,credential,request,state,created,expires,session_id) VALUES(?,?,?,?,?,'queued',?,?,?)",(identifier,device,owner,row['token_hash'],self.state.seal(request),self.clock(),self.clock()+90,session_id))
            return {'controller_job':identifier,'state':'queued'}
    def poll(self,token):
        device=self.pairs.verify_device(token)
        with self.pairs.db() as db:
            row=db.execute("SELECT j.id,j.request FROM controller_jobs j JOIN web_sessions s ON j.session_id=s.id WHERE j.device=? AND j.credential=? AND j.state='queued' AND j.expires>? AND s.expires>? ORDER BY j.created LIMIT 1",(device['id'],self.pairs.token_hash(token),self.clock(),self.clock())).fetchone()
            if not row:return {'job':None}
            db.execute("UPDATE controller_jobs SET state='claimed' WHERE id=?",(row['id'],))
            return {'job':{'id':row['id'],**self.state.open(row['request'])}}
    def finish(self,token,identifier,response):
        device=self.pairs.verify_device(token)
        if not isinstance(response,dict) or type(response.get('status')) is not int or not 200<=response['status']<=599 or response.get('type') not in {'application/json','text/event-stream','audio/wav'}:raise ValueError('Invalid controller response')
        try:raw=base64.b64decode(response.get('body',''),validate=True)
        except Exception:raise ValueError('Invalid controller response body') from None
        if len(raw)>MAX_RESULT:raise ValueError('Controller response exceeds its limit')
        with self.pairs.db() as db:
            row=db.execute("UPDATE controller_jobs SET state='done',response=? WHERE id=? AND device=? AND credential=? AND state='claimed' AND expires>? RETURNING id",(self.state.seal(response),identifier,device['id'],self.pairs.token_hash(token),self.clock())).fetchone()
            if not row:raise PermissionError('Request expired, cancelled or belongs to another laptop')
        return {'ok':True}
    def read(self,owner,device,identifier,session_id):
        with self.pairs.db() as db:
            row=db.execute('SELECT j.state,j.response FROM controller_jobs j JOIN devices d ON j.device=d.id AND j.credential=d.token_hash WHERE j.id=? AND j.device=? AND j.owner=? AND j.session_id=? AND j.expires>? AND d.owner=? AND d.revoked=0',(identifier,device,owner,session_id,self.clock(),owner)).fetchone()
            if not row:raise PermissionError('Request unavailable or device disconnected. Check the execution log before repeating an action.')
            return {'state':row['state'],**({'response':self.state.open(row['response'])} if row['state']=='done' else {})}
