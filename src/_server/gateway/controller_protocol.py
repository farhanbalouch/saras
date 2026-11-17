"""Shared allowlist for the existing controller over an authenticated outbound link.
No caller supplies a host, port, filesystem URL, shell command, cookie or header.
"""
GET_PATHS={'/api/state','/api/tools','/api/memory','/api/desktop-check'}
POST_PATHS={'/api/chat','/api/chat-stream','/api/plan','/api/command','/api/memory','/api/history-recall','/api/clear','/api/weather','/api/timer','/api/reminder','/api/reminder/cancel','/api/scroll/stop','/api/workflow/plan','/api/workflow/approve','/api/workflow/cancel','/api/voice/catalog','/api/voice/job','/api/voice/script','/api/voice/speak','/api/ai/status','/api/ai/models','/api/ai/test','/api/ai/save'}
MAX_BODY=32768
MAX_RESULT=2500000
def validate_request(method,path,body):
    import json
    if (method=='GET' and path not in GET_PATHS) or (method=='POST' and path not in POST_PATHS) or method not in {'GET','POST'}:raise ValueError('This controller endpoint is not remotely available')
    if not isinstance(body,dict) or len(json.dumps(body,ensure_ascii=False).encode())>MAX_BODY:raise ValueError('Controller request exceeds its limit')
    if method=='GET' and body:raise ValueError('GET controller requests cannot contain data')
    return {'method':method,'path':path,'body':body}
