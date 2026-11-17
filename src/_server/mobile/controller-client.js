/* Reuse the existing controller. Only its transport changes; no fake responses. */
(() => {
 'use strict';window.SarasHostedController=true;
 const base=location.pathname.match(/^\/account\/([0-9a-f]{32})(?:\/|$)/),device=base?.[1],prefix=base?'/account/'+device+'/api/':null;
 if(!prefix)return;
 const original=window.fetch.bind(window);let sessionPromise=null;
 let statusBusy=false,statusTimer,hasPin=false;
 async function connectionStatus(){
  if(statusBusy||document.hidden)return;
  statusBusy=true;const node=document.getElementById('pcStatus');
  try{
   const signed=await session();
   const response=await original('/api/v2/control/info',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':signed.csrf},body:JSON.stringify({device}),signal:AbortSignal.timeout(7000)});
   const info=await response.json();if(!response.ok){if(response.status===401||response.status===403)sessionPromise=null;throw Error(info.error||'Connection unavailable')}
   if(node){node.textContent=(info.online?'Companion online':'Companion offline')+' • Access '+(info.enabled?'enabled':'disabled');node.dataset.online=String(info.online)}
  }catch(error){if(node){node.textContent=navigator.onLine?'Connection unavailable — retrying':'Phone offline';node.dataset.online='false'}}
  finally{statusBusy=false;clearTimeout(statusTimer);statusTimer=setTimeout(connectionStatus,3000)}
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){sessionPromise=null;connectionStatus()}else if(!globalThis.SarasAppBoundary?.internalNavigation){session().then(s=>original('/api/v2/auth/app-lock',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({action:'lock'})})).catch(()=>{})}});
 window.addEventListener('online',connectionStatus);
 window.addEventListener('offline',()=>{const node=document.getElementById('pcStatus');if(node){node.textContent='Phone offline';node.dataset.online='false'}});
 function awaitLockOnEntry(s){original('/api/v2/auth/app-lock',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({action:'lock'})}).finally(()=>location.assign('/mobile/'))}
 async function session(){if(!sessionPromise)sessionPromise=original('/api/v2/session',{cache:'no-store',credentials:'same-origin'}).then(r=>r.json()).then(s=>{hasPin=!!s.pin_enabled;if(hasPin&&!globalThis.SarasAppBoundary?.internalArrival){awaitLockOnEntry(s);throw Error('Unlock SARAS in My Devices.')}if(s.locked){location.assign('/mobile/');throw Error('Unlock SARAS in My Devices.')}if(!s.user)throw Error('Your sign-in expired. Open My Devices and sign in again.');return s});return sessionPromise}
 window.fetch=async function(resource,options={}){
  const url=new URL(typeof resource==='string'?resource:resource.url,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith(prefix))return original(resource,options);
  const signed=await session(),headers=new Headers(options.headers||{});headers.set('X-CSRF-Token',signed.csrf);
  const response=await original(resource,{...options,headers,cache:'no-store',credentials:'same-origin'});
  if(response.status===401||response.status===403){sessionPromise=null;return response}
  if(response.status!==202){if(url.pathname.endsWith('/api/logout')&&response.ok)location.assign('/mobile/');return response}
  const ticket=await response.json();if(!ticket.controller_job)throw Error('Invalid controller acknowledgement');
  for(let i=0;i<100;i++){
   if(options.signal?.aborted)throw new DOMException('Stopped','AbortError');
   await new Promise(resolve=>setTimeout(resolve,600));
   const poll=await original('/api/v2/controller/job',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':signed.csrf},body:JSON.stringify({device,id:ticket.controller_job}),signal:options.signal});
   const result=await poll.json();if(!poll.ok)throw Error(result.error||'Controller connection interrupted. Check the execution log before repeating an action.');
   if(result.state==='cancelled')throw Error('Request cancelled.');
   if(result.state==='done'){
    const answer=result.response,bytes=Uint8Array.from(atob(answer.body),c=>c.charCodeAt(0));
    return new Response(bytes,{status:answer.status,headers:{'Content-Type':answer.type,'Cache-Control':'no-store'}});
   }
  }
  throw Error('The laptop took too long. Check its execution log before repeating an action.');
 };
 document.addEventListener('DOMContentLoaded',()=>{
  connectionStatus();
  for(const id of ['login','accountOwnerTools','pair','pairCodeButton','revokeDevice']){const node=document.getElementById(id);if(node)node.hidden=true}
  const app=document.getElementById('app');if(app)app.hidden=false;
  const status=document.getElementById('pcStatus');if(status)status.textContent='Connecting to your authorized laptop…';
  const nav=document.createElement('a');nav.href='/mobile/';nav.textContent='← My Devices';nav.className='button';document.querySelector('main')?.prepend(nav);
 });
})();
