"""Stateless Vercel entrypoint. All private state is durable and server-owned."""
import importlib.util,json,sys,threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit,parse_qs,urlencode
ROOT=Path(__file__).resolve().parents[1]/'_server'
sys.path[:0]=[str(ROOT/'gateway'),str(ROOT)]
import server as gateway
from cloud import create_application
APP=None;LOCK=threading.Lock()

class handler(gateway.Handler):
    def __init__(self,request,client_address,http_server):
        global APP
        try:
            with LOCK:
                if APP is None:APP=create_application()
        except Exception:
            class Unavailable(BaseHTTPRequestHandler):
                def log_message(self,*args):pass
                def do_GET(self):
                    data=json.dumps({'error':'SARAS cloud configuration is incomplete. Sign-in and PC control remain disabled.'}).encode();self.send_response(503);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
                do_POST=do_GET
            Unavailable(request,client_address,http_server);return
        super().__init__(request,client_address,APP)
    def route(self):
        parsed=urlsplit(self.path);query=parse_qs(parsed.query);route=query.pop('route',[None])[0]
        if route is not None:self.path='/'+route.lstrip('/')+('?' + urlencode(query,doseq=True) if query else '')
    def do_GET(self):self.route();super().do_GET()
    def do_POST(self):self.route();super().do_POST()
