"""Explicit cloud configuration; no fallback to local/in-memory production state."""
import hashlib,os,re,tempfile
from pathlib import Path
from urllib.parse import urlsplit
from database import Database
from server import GatewayState

def create_application():
    mode=os.getenv('V2_ENVIRONMENT','staging');origin=os.getenv('V2_CONTROLLER_ORIGIN','').rstrip('/')
    if not origin and os.getenv('VERCEL_ENV')=='preview':
        host=os.getenv('VERCEL_URL','')
        if re.fullmatch('[a-z0-9-]+\.vercel\.app',host):origin='https://'+host
    parsed=urlsplit(origin)
    if mode not in {'staging','production'} or parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.port not in {None,443} or parsed.path or parsed.query or parsed.fragment:raise ValueError('Explicit HTTPS controller environment is required')
    if mode=='staging' and parsed.hostname=='saras.farhanbalouch.com':raise ValueError('Staging cannot replace the production controller')
    if mode=='production' and origin!='https://saras.farhanbalouch.com':raise ValueError('Production controller origin must be explicitly approved')
    ref=os.getenv('V2_STAGING_PROJECT_REF','');dsn=os.getenv('V2_DATABASE_URL','');key=os.getenv('V2_STATE_KEY','').encode();ca=os.getenv('V2_DATABASE_CA','').replace('\\n','\n')
    if not dsn or not key or 'BEGIN CERTIFICATE' not in ca:raise ValueError('Durable cloud database, protected state key and verified database CA are required')
    file=Path(tempfile.gettempdir())/('saras-v2-ca-'+hashlib.sha256(ca.encode()).hexdigest()+'.crt')
    if not file.exists():file.write_text(ca,encoding='ascii')
    store=Database(dsn=dsn,project_ref=ref,ca_file=file)
    return GatewayState(store=store,state_key=key,origin=origin,public=True)
