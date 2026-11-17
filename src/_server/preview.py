"""Read-only V2 design preview. No app, PC or production API calls are allowed."""
import json,mimetypes,re
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.parse import urlsplit,unquote
R=Path(__file__).resolve().parent
SITE=R/'saras-public-vercel/dist';WEB=R/'saras-next/web'
PREVIEW_JS='''document.addEventListener('submit',e=>{e.preventDefault();alert('Design preview only. No credentials, settings or commands are sent.');});
document.querySelectorAll('button').forEach(b=>b.addEventListener('click',e=>{if(b.dataset.tab){document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!==b.dataset.tab);document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));return;}if(b.id==='v2Explore'){document.querySelector('#login').hidden=true;document.querySelector('#app').hidden=false;return;}e.preventDefault();alert('This is the read-only V2 design preview. This action requires the connected staging backend.');}));'''
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):self.reply(405,b'Preview is read-only','text/plain')
    def do_GET(self):
        route=unquote(urlsplit(self.path).path)
        if route.startswith('/api/') or route=='/api':return self.reply(503,json.dumps({'error':'Read-only design preview; no backend calls enabled.'}).encode(),'application/json')
        if route=='/v2-preview.js':return self.reply(200,PREVIEW_JS.encode(),'text/javascript')
        kind='website';base=SITE
        if route.startswith('/mobile'):
            kind='mobile';base=R/'mobile';relative='index.html' if route in ['/mobile','/mobile/'] else route.removeprefix('/mobile/');file=base/relative
        elif route.startswith('/legacy'):
            kind='legacy';base=WEB;file=WEB/'index.html'
        elif route in ['/setup','/setup/','/dashboard','/dashboard/']:
            kind='setup' if route.startswith('/setup') else 'dashboard';base=WEB;file=WEB/('setup.html' if kind=='setup' else 'dashboard.html')
        elif route.startswith('/runtime-assets/'):
            base=WEB;file=WEB/route.removeprefix('/runtime-assets/')
        else:
            file=SITE/route.lstrip('/')
            if file.is_dir():file=file/'index.html'
        try:
            if not file.resolve().is_relative_to(base.resolve()) or not file.is_file():return self.reply(404,b'Not found','text/plain')
            data=file.read_bytes();mime=mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
            if file.suffix=='.html':
                text=data.decode('utf-8')
                if base==WEB:
                    text=re.sub(r'<script\b(?![^>]*v2-theme.js)[^>]*>.*?</script>','',text,flags=re.S)
                    text=re.sub(r'(href|src)="/([^"?#]+)([^\"]*)"',lambda m:m[1]+'="/runtime-assets/'+m[2]+m[3]+'"' if (WEB/m[2]).is_file() else m[0],text)
                    text=text.replace('href="/#','href="/setup/#')
                    text=text.replace('</body>','<script src="/v2-preview.js"></script></body>')
                    if kind=='mobile':text=text.replace('</form></section><div id="app"','</form><button class="v2-secondary" type="button" id="v2Explore">Explore mobile UI · preview only</button></section><div id="app"',1)
                    text=text.replace('Companion offline','Staging preview · laptop not connected').replace('http://127.0.0.1:8865','Staging backend not configured')
                links=[('/', 'Download site','website'),('/mobile/','Mobile app','mobile'),('/setup/','Windows setup','setup'),('/dashboard/','Dashboard','dashboard')]
                bar='<div class="v2-hub-nav"><b>✦ SARAS V2</b>'+''.join('<a href="'+url+'" class="'+('active' if active==kind else '')+'">'+label+'</a>' for url,label,active in links)+'</div>'
                banner='<div class="v2-preview-banner"><strong>Isolated V2 preview.</strong> No live account, PC actions or production data connected. Existing public installer is unchanged.</div>'
                text=text.replace('<body>','<body>'+bar+banner,1) if '<body>' in text else re.sub(r'(<body[^>]*>)',lambda m:m[0]+bar+banner,text,count=1)
                if kind!='mobile':text=re.sub(r'<link rel="manifest"[^>]*>','',text)
                data=text.encode('utf-8')
            return self.reply(200,data,mime)
        except (OSError,UnicodeError):return self.reply(500,b'Preview file unavailable','text/plain')
    def reply(self,status,data,mime):
        self.send_response(status);self.send_header('Content-Type',mime+'; charset=utf-8' if mime.startswith(('text/','application/json')) else mime);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Robots-Tag','noindex,nofollow');self.end_headers()
        try:self.wfile.write(data)
        except (ConnectionError,BrokenPipeError):pass
if __name__=='__main__':
    print('SARAS V2 read-only preview: http://127.0.0.1:8920/',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8920),Handler).serve_forever()
