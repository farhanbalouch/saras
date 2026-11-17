const accountBase=location.pathname.match(/^\/account\/[0-9a-f]{32}/)?.[0]||'';const $=id=>document.getElementById(id);let state;const delivered=new Set();let noticeRevision=0,refreshing=null,pollTimer=0;

async function api(path,data){return SarasNetwork.json(accountBase+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)})}

function notice(value,kind='error'){const el=$('notice');el.textContent=value?.message||value||'';el.dataset.state=kind;noticeRevision++}

async function buttonTask(button,label,work,success){if(!button||button.disabled)return;const old=button.dataset.idleText||button.textContent;button.dataset.idleText=old;const revision=noticeRevision;button.disabled=true;button.setAttribute('aria-busy','true');button.classList.add('is-loading');button.textContent=label;notice(label,'loading');$('assistantActivity').textContent=label;try{const result=await work();if(noticeRevision===revision+1)notice(result===false?'Cancelled.':typeof success==='function'?success(result):success||'Done.',result===false?'loading':'success');return result}catch(e){notice(e,'error')}finally{button.disabled=false;button.removeAttribute('aria-busy');button.classList.remove('is-loading');button.textContent=old;$('assistantActivity').textContent='SARAS ready'}}

function formTask(e,label,success,work){e.preventDefault();return buttonTask(e.submitter||e.currentTarget.querySelector('button[type="submit"],button:not([type])'),label,work,success)}

function item(parent,text,cls='item'){const el=document.createElement('div');el.className=cls;el.textContent=text;parent.append(el);return el}

let streamBusy=false,streamAbort=null,activeNarrator=null;
async function refresh(){if(streamBusy)return;if(refreshing)return refreshing;refreshing=loadState();try{return await refreshing}finally{refreshing=null}}
async function loadState(){try{state=await api('state');globalThis.SarasTaskProgress?.render(state.workflows);renderDesktopInspection(state.commands);$('login').hidden=true;$('app').hidden=false;$('mode').textContent=state.ai?'SARAS Next • AI configured':'SARAS Next • AI setup required';$('messages').replaceChildren();for(const m of state.messages){const el=item($('messages'),m.text,'bubble '+m.role);if(m.role==='assistant')renderResearchReply(el,m.text);el.dir='auto';const title=document.createElement('b');title.textContent=m.role==='user'?'YOU':'SARAS';el.prepend(title)}$('pushStatus').textContent=(state.push?'Server push configured':'Closed-app push keys not configured')+(state.push_failed?' • Failed device deliveries: '+state.push_failed:'');$('reminders').replaceChildren();for(const t of state.reminders){item($('reminders'),t.text+' • '+new Date(t.due*1000).toLocaleString());if(t.due*1000<=Date.now()&&!delivered.has(t.id)){delivered.add(t.id);globalThis.SarasProductivity?.alarm(t.due);notice('Reminder: '+t.text,'success');if(!t.delivered&&'Notification'in window&&Notification.permission==='granted')navigator.serviceWorker.ready.then(r=>r.showNotification('SARAS reminder',{body:t.text,icon:'/runtime-assets/icon.svg'}))}}if(!globalThis.SarasHostedController)$('pcStatus').textContent=(Date.now()/1000-state.heartbeat<45?'Companion online':'Companion offline')+' • Access '+(state.remote?'enabled':'disabled');$('commands').replaceChildren();for(const c of state.commands){const tone=c.status==='completed'?'success':/failed|rejected|cancelled/i.test(c.status)?'error':'pending';item($('commands'),'#'+c.id+' '+c.tool+' • '+c.status+'\n'+c.args+(c.result?'\n'+c.result:''),'item command-log '+tone)}}catch(e){if(e.message==='Please log in'){$('app').hidden=true;$('login').hidden=false}else notice(e,'error')}}

function action(id,fn,label='Working…',success='Done.'){$(id).addEventListener('click',e=>{e.preventDefault();buttonTask(e.currentTarget,label,fn,success)})}

$('loginForm').onsubmit=e=>formTask(e,'Signing in…','Login successful.',async()=>{await api('login',{password:$('password').value});$('password').value='';await refresh()});

document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!==b.dataset.tab);document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b))});

document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('message').value=b.dataset.prompt;$('message').focus()});

async function assistantChat(text,onDelta){
 if(streamBusy)throw Error('A reply is already in progress. Wait or stop it first.');
 streamBusy=true;streamAbort=new AbortController();activeNarrator=$('speak').checked?SarasVoice.createNarrator($('voiceLanguage').value):null;
 let answer='';item($('messages'),text,'bubble user');const bubble=item($('messages'),'Waiting for reply…','bubble assistant');
 try{await SarasStream.request(text,delta=>{answer+=delta;renderResearchReply(bubble,answer);onDelta?.(delta);if(!delta.startsWith('\n\nSources — checked '))activeNarrator?.push(delta)},streamAbort.signal,$('speak').checked?$('voiceEngine')?.selectedOptions[0]?.dataset.language:undefined,$('webMode').value);activeNarrator?.finish();streamBusy=false;await refresh();return answer}
 catch(error){activeNarrator?.cancel();throw error}
 finally{streamBusy=false;streamAbort=null;activeNarrator=null}
}
$('chatForm').onsubmit=e=>formTask(e,'SARAS is replying…','Reply received.',async()=>{await assistantChat($('message').value);$('message').value=''});
globalThis.SarasAssistantBridge={chat:assistantChat,render:renderResearchReply,refresh};

$('reminderForm').onsubmit=e=>{const form=e.currentTarget;return formTask(e,'Saving reminder…','Reminder saved.',async()=>{await api('reminder',{text:$('taskText').value,due:new Date($('taskDue').value).getTime()/1000});form.reset();await refresh()})};

$('commandForm').onsubmit=e=>formTask(e,'Sending to your PC…','Request sent. Watch the execution log for the result.',async()=>{await api('command',{tool:$('tool').value,args:$('tool').value==='write_note'?{name:$('noteName').value,text:$('noteText').value}:['current_time','clipboard_read','list_apps','list_windows','status','list_notes','shutdown_pc','restart_pc','cancel_shutdown','wifi_off','wifi_on','bluetooth_on','bluetooth_off'].includes($('tool').value)?{}:JSON.parse($('manualArgs').value||'{}'),confirmed:$('consent').checked,confirmation:$('manualConfirm').value});$('consent').checked=false;await refresh();schedulePoll(2000)});

action('pair',async()=>{if(!confirm('Rotate pairing? This disables access and revokes the previous companion token.'))return false;const j=await api('pair',{});prompt('Copy this secret for manual companion setup. The Windows setup wizard pairs automatically using your password. Do not share this token.',j.token);await refresh()},'Connecting…','Pairing token updated.');

action('enable',async()=>{if(confirm('Enable the listed actions in your PC-shared folders? Every request requires approval here. Your Windows configuration decides whether local approval is also required.')){await api('remote',{enabled:true});await refresh()}},'Enabling access…','PC access enabled.');

action('stop',async()=>{await api('remote',{enabled:false});await refresh();notice('Access disabled and pending commands cancelled. An action already executing may finish; Ctrl+C stops the companion.','success')},'Stopping access…','Access disabled.');
const revokeDevice=document.createElement('button');revokeDevice.id='revokeDevice';revokeDevice.type='button';revokeDevice.textContent='Disconnect paired laptop';$('stop').after(revokeDevice);
action('revokeDevice',async()=>{if(!confirm('Disconnect this laptop and invalidate every unused pairing code? Reconnect it with a new code when needed.'))return false;await api('devices/revoke',{confirmed:true});await refresh()},'Disconnecting…','Laptop disconnected. Old device tokens and unused pairing codes no longer work.');

action('clear',async()=>{if(confirm('Delete all stored chat messages?')){await api('clear',{});await refresh()}},'Clearing chats…','Chat history deleted.');action('logout',async()=>{await api('logout',{});await refresh()},'Logging out…','Logged out.');

action('notifications',async()=>{if(!('Notification'in window))throw Error('Notifications unavailable in this browser');notice('Notification permission: '+await Notification.requestPermission(),'success')},'Opening permission…');

action('voice',async()=>{if(!confirm('Use your browser speech service? Audio may be processed by its provider.'))return false;$('wakeStop').click();await SarasVoice.listen($('voiceLanguage').value,text=>{$('message').value=text;$('voiceTranscript').textContent=text},text=>notice(text,'loading'));notice('Speech written. Review it, then press Send.','success')},'Listening…');
action('readReply',()=>{const reply=[...(state?.messages||[])].reverse().find(m=>m.role==='assistant');if(!reply||!SarasVoice.speak(reply.text,$('voiceLanguage').value))throw Error('No spoken reply available on this device.')},'Reading reply…','Reading the reply aloud.');
for(const id of ['voiceLanguage','wakeMode','speak']){try{const saved=localStorage.getItem('saras-pref-'+id);if(saved!==null){if(id==='speak')$(id).checked=saved==='true';else if([...$(id).options].some(o=>o.value===saved))$(id).value=saved}}catch{}$(id).addEventListener('change',()=>{try{localStorage.setItem('saras-pref-'+id,id==='speak'?String($(id).checked):$(id).value)}catch{}})}

if(!globalThis.SarasHostedController&&'serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(notice);refresh();
async function pollView(){if(!$('app').hidden&&!document.hidden)await refresh();const pending=state?.commands.some(c=>['queued','awaiting local approval'].includes(c.status));schedulePoll(pending?2000:10000)}
function schedulePoll(delay){clearTimeout(pollTimer);pollTimer=setTimeout(pollView,delay)}schedulePoll(10000);



let proposal=null;

$('planForm').onsubmit=e=>formTask(e,'Preparing PC action…','Action prepared. Review it below; nothing has executed yet.',async()=>{proposal=await api('plan',{text:$('pcRequest').value});if(!proposal.tool)throw Error(proposal.explanation);$('proposalText').textContent=proposal.explanation+'\nAction: '+proposal.tool+'\n'+JSON.stringify(proposal.args,null,2)+(proposal.sensitive?'\nRequired approval: '+(proposal.confirmation||'APPROVE '+proposal.tool):'');$('sensitiveLabel').hidden=!proposal.sensitive;$('sensitiveConfirm').value='';$('proposal').hidden=false});

action('approvePlan',async()=>{if(!proposal)return false;if(!confirm('Send this exact action to your PC?'))return false;await api('command',{plan_id:proposal.plan_id,confirmed:true,confirmation:$('sensitiveConfirm').value});proposal=null;$('proposal').hidden=true;await refresh();schedulePoll(2000)},'Sending to your PC…','Approved request sent. Watch the execution log for the result.');

action('cancelPlan',()=>{proposal=null;$('proposal').hidden=true;notice('Proposal cancelled.','loading')});


function pushKey(s){const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0))}
action('pushEnable',async()=>{if(!state.push)throw Error('Configure server VAPID keys first; see START-HERE.md.');if(!('PushManager'in window))throw Error('Web Push is unsupported here. On iPhone, try the installed Home Screen app.');if(await Notification.requestPermission()!=='granted')throw Error('Notification permission was not granted');const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushKey(state.push_public_key)});await api('push/subscribe',{subscription:sub.toJSON()})},'Enabling notifications…','Push enabled on this device.');
action('pushDisable',async()=>{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub){await api('push/unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe()}},'Disabling notifications…','Push disabled on this device.');

action('pairCodeButton',async()=>{if(!confirm('Connect your own laptop? This code grants pairing access; keep it private.'))return false;const r=await api('pair-code',{confirmed:true});prompt('Enter this code in the laptop SARAS app. Valid for 5 minutes.',r.code.slice(0,4)+' '+r.code.slice(4))},'Creating secure code…','Pairing code created. Enter it on your laptop.');

window.sarasWakeCommand=text=>{if($('wakeMode').value==='workflow'){document.querySelector('[data-tab="pc"]').click();$('workflowRequest').value=text;$('workflowForm').requestSubmit();return}const pc=$('wakeMode').value==='pc'||/wifi|wi-fi|shutdown|restart|laptop.*(?:band|off)|لیپ.*بند|وائی.*(?:فائی|فای)/i.test(text);if(pc){document.querySelector('[data-tab="pc"]').click();$('pcRequest').value=text;$('planForm').requestSubmit()}else{document.querySelector('[data-tab="chat"]').click();$('message').value=text;$('chatForm').requestSubmit()}};

$('memoryForm').onsubmit=e=>formTask(e,'Saving personal memory…','Memory saved.',async()=>{await api('memory',{text:$('personalMemory').value})});
action('loadMemory',async()=>{const saved=await api('memory');$('personalMemory').value=saved.text;$('historyRecall').checked=saved.history_recall===true},'Loading memory…','Saved memory shown.');
action('forgetMemory',async()=>{if(!confirm('Forget your saved preferences? Chats stay saved.'))return false;await api('memory',{text:''});$('personalMemory').value=''},'Forgetting memory…','Personal memory cleared.');
$('conversationStart').onclick=()=>{$('voiceSession').checked=true;$('wakeMode').value='chat';$('speak').checked=true;$('wakeStart').click()};
$('conversationStop').onclick=()=>{$('voiceSession').checked=false;$('speak').checked=false;$('wakeStop').click();if(streamAbort)streamAbort.abort();activeNarrator?.cancel();SarasVoice.cancel();notice('Voice and reply display stopped.','loading')};

$('accountOwnerTools').hidden=!!accountBase;
$('accountForm').onsubmit=e=>formTask(e,'Creating separate account…','Account created. Share the login link and password privately.',async()=>{const created=await api('accounts',{name:$('accountName').value,password:$('accountPassword').value});$('accountPassword').value='';const link=$('createdAccountLink');link.href=created.path;link.textContent=location.origin+created.path;link.hidden=false;await showAccounts()});
async function showAccounts(){
 if(accountBase)return;const data=await api('accounts');$('accountList').replaceChildren();const select=$('resetAccountId');select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Choose a customer';select.append(empty);
 for(const account of data.accounts){const option=document.createElement('option');option.value=account.id;option.textContent=account.name+(account.enabled?'':' (disabled)');select.append(option);const row=item($('accountList'),account.name+(account.enabled?' • enabled':' • disabled'));const link=document.createElement('a');link.href='/account/'+account.id+'/';link.textContent='Open login';row.append(' ',link);const button=document.createElement('button');button.type='button';button.textContent=account.enabled?'Disable account':'Restore account';button.onclick=()=>buttonTask(button,'Updating…',async()=>{if(!confirm(account.enabled?'Disable this account and revoke its sessions and PC access? Data stays saved.':'Restore this account? Fresh login and laptop pairing are required.'))return false;await api(account.enabled?'accounts/disable':'accounts/enable',{id:account.id});await showAccounts()},'Customer access updated.');row.append(' ',button)}
}
action('loadAccounts',showAccounts,'Loading accounts…','Accounts loaded.');

const incomingLink=new URLSearchParams(location.search).get('device_link');
$('deviceLinkPanel').hidden=!incomingLink;
action('reviewDeviceLink',async()=>{const link=await api('device-link/info',{id:incomingLink});$('deviceLinkCode').textContent='Laptop code: '+link.code;$('approveDeviceLink').hidden=false},'Checking pairing…','Compare the code with your laptop.');
action('approveDeviceLink',async()=>{if(!confirm('Does this code match the QR you generated on your own laptop?'))return false;await api('device-link/approve',{id:incomingLink,approved:true});$('approveDeviceLink').hidden=true},'Approving laptop…','Pairing approved. Enable PC access after the laptop connects.');

$('resetAccountForm').onsubmit=e=>formTask(e,'Resetting customer access…','Password reset. Customer must log in and pair again; data stays saved.',async()=>{await api('accounts/reset',{id:$('resetAccountId').value,password:$('resetAccountPassword').value});$('resetAccountPassword').value=''});

let desktopInspectionId=0;
function renderDesktopInspection(commands){
 const result=(commands||[]).find(c=>c.tool==='inspect_desktop'&&c.status==='completed');
 if(!result||result.id===desktopInspectionId)return;
 try{const snapshot=JSON.parse(result.result);if(typeof snapshot.window!=='string')return;
 desktopInspectionId=result.id;$('desktopWindow').value=snapshot.window;$('desktopX').value=snapshot.x;$('desktopY').value=snapshot.y;
 $('desktopSnapshot').textContent='Last inspection #'+result.id+': '+snapshot.window+' • '+snapshot.width+' × '+snapshot.height+' • pointer '+snapshot.x+', '+snapshot.y+'. Inspect again after switching windows.';
 }catch{}
}
action('inspectDesktop',async()=>{if(!confirm('Read active window title and pointer position into the private execution log? No screenshot will be taken.'))return false;await api('command',{tool:'inspect_desktop',args:{},confirmed:true,confirmation:'APPROVE inspect_desktop'});schedulePoll(2000)},'Requesting desktop information…','Inspection queued. Keep the intended laptop window in front; result appears here after companion reports.');
let desktopBackendReady=false;
async function checkDesktopBackend(){
 if(desktopBackendReady)return;
 let result;try{result=await api('desktop-check')}catch(error){throw Error('Desktop backend readiness check failed: '+error.message+' Latest Preview deployment is required; refreshing an older deployment does not update its backend.')}
 if(result.capability!=='desktop-validator-v3'||result.validation!==true)throw Error('Desktop backend version mismatch. Open the Preview URL returned by the latest Update Preview.cmd.');
 desktopBackendReady=true;
}
$('desktopForm').onsubmit=e=>formTask(e,'Sending desktop input…','Input queued. Check the execution log; input may affect the active window.',async()=>{
 const tool=$('desktopAction').value,args={window:$('desktopWindow').value};
 if(tool==='desktop_type')args.text=$('desktopText').value;
 else if(tool==='desktop_click'){args.x=$('desktopX').value;args.y=$('desktopY').value}
 else if(tool==='desktop_scroll_start'){args.direction=$('desktopScrollDirection').value}
 else if(tool==='desktop_scroll'){args.direction=$('desktopScrollDirection').value;args.steps=$('desktopScrollSteps').value}
 else args.key=$('desktopKey').value;
 if(!$('desktopConsent').checked)throw Error('Approve this exact input first');
 if(!confirm('Send '+tool+' to window: '+args.window+'?\n'+(args.text|| (tool==='desktop_click'?args.x+', '+args.y:args.direction?'Scroll '+args.direction+(args.steps?' '+args.steps+' steps':' until Stop'):args.key))))return false;
 await checkDesktopBackend();
 await api('command',{tool,args,confirmed:true,confirmation:'APPROVE '+tool});$('desktopConsent').checked=false;schedulePoll(2000);
});

action('saveHistoryRecall',async()=>{await api('history-recall',{enabled:$('historyRecall').checked})},'Saving recall preference…','History recall preference saved.');

try{document.documentElement.dataset.console=localStorage.getItem('sarasConsole')||'light'}catch(e){}
$('themeToggle').onclick=()=>{const theme=document.documentElement.dataset.console==='dark'?'light':'dark';document.documentElement.dataset.console=theme;try{localStorage.setItem('sarasConsole',theme)}catch(e){}};

let toolSpecs=null;
$('tool').addEventListener('change',async()=>{
 try{
  if(!toolSpecs)toolSpecs=(await api('tools')).tools;
  const spec=toolSpecs[$('tool').value];if(!spec)return;
  $('toolHelp').textContent=spec.help+(spec.sensitive?' • Typed approval: '+(spec.confirmation||'APPROVE '+$('tool').value):'');
  const samples={direction:'down',steps:'3',folder:'workspace',path:'.',new_path:'new-name',query:'report',percent:'60',action:'up',window:'Exact title from list_windows',app:'vscode'};
  const args={};for(const name of Object.keys(spec.args))args[name]=samples[name]||'';
  if($('tool').value==='take_screenshot')args.path='screenshot.png';
  $('manualArgs').value=JSON.stringify(args,null,2);
 }catch(error){notice(error,'error')}
});

function updateDesktopFields(){
 const tool=$('desktopAction').value;
 const visible={desktopText:tool==='desktop_type',desktopX:tool==='desktop_click',desktopY:tool==='desktop_click',desktopKey:tool==='desktop_key',desktopScrollDirection:tool==='desktop_scroll'||tool==='desktop_scroll_start',desktopScrollSteps:tool==='desktop_scroll'};
 for(const [id,show] of Object.entries(visible)){
  const field=$(id);field.disabled=!show;const label=field.closest('label');if(label)label.hidden=!show;
 }
 const help=$('desktopUsage');if(help)help.textContent=tool==='desktop_type'?'Laptop par Notepad khol kar text cursor andar rakhein. Mobile se text bhejein; X/Y aur Key ki zaroorat nahi.':tool==='desktop_click'?'X left se right aur Y top se bottom pixel position hai. Ye laptop screen ki position hai, mobile screen ki nahi.':(tool==='desktop_scroll'||tool==='desktop_scroll_start')?'Target window active rakhein. Fixed mode: 1–1000 steps. Continuous mode: Stop scrolling, focus change or top-left pointer stops it; page end is not detected.':'Laptop par target app active rakhein. Select ki hui ek navigation key bheji jayegi.';
}
$('desktopAction').addEventListener('change',updateDesktopFields);updateDesktopFields();

function renderResearchReply(element,text){
 const boundary=text.indexOf('\n\nSources — checked ');
 if(boundary<0){element.textContent=text;return;}
 element.replaceChildren(document.createTextNode(text.slice(0,boundary)));
 const sources=document.createElement('div');sources.className='research-sources';
 for(const line of text.slice(boundary).split('\n')){
  if(/^https:\/\//.test(line)){try{const url=new URL(line);if(url.protocol==='https:'&&!url.username&&!url.password){const a=document.createElement('a');a.href=url.href;a.textContent=line;a.target='_blank';a.rel='noopener noreferrer';sources.append(a,document.createElement('br'));continue;}}catch{}}
  const row=document.createElement('div');row.textContent=line;sources.append(row);
 }
 element.append(sources);
}

action('stopScrolling',async()=>{await api('scroll/stop',{});await refresh()},'Stopping scroll…','Scroll stop requested. No pairing change; allow about 2 seconds while connected.');
