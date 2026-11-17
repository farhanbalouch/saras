"""Bounded server configuration: existing capabilities only, never remote code."""
import json,os,re
from contracts import SPECS

def version(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:-dev\.\d+)?',value):return None
    release,*dev=value.split('-dev.');return (*map(int,release.split('.')),int(dev[0]) if dev else 10**9)

class FeaturePolicy:
    def __init__(self,public=False):
        self.minimum=os.getenv('V2_MIN_COMPANION_VERSION','2.0.0-dev.3' if public else '0.0.0')
        if version(self.minimum) is None:raise ValueError('Invalid minimum companion version')
        self.public=public;self.disabled=json.loads(os.getenv('V2_DISABLED_TOOLS','[]'))
        if not isinstance(self.disabled,list) or len(self.disabled)>len(SPECS) or any(not isinstance(x,str) or x not in SPECS for x in self.disabled):raise ValueError('Only known SARAS tools can be disabled')
        self.emergency=os.getenv('V2_REMOTE_CONTROL_DISABLED','false').lower()=='true'
    def state(self,client):
        supported=(version(client) or (() if self.public else version('0.0.0')))>=version(self.minimum)
        return {'compatible':supported,'minimum_version':self.minimum,'disabled_tools':self.disabled,'policy_enabled':supported and not self.emergency}
