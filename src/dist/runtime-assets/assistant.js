(function(){
'use strict';
const el=id=>document.getElementById(id),base=location.pathname.match(/^\/account\/[0-9a-f]{32}/)?.[0]||'';
const request=(path,data)=>SarasNetwork.json(base+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
const host=document.createElement('div');host.id='sarasCompanion';host.hidden=true;
host.innerHTML=`<button id="mouseCharacter" data-side="right" data-pose="peek" type="button" aria-label="Talk to SARAS" title="Talk to SARAS"><span class="hamster-sprite" aria-hidden="true"><span class="hamster-muzzle"></span></span><span class="sr">SARAS hamster</span></button>
<section id="assistantPanel" role="dialog" aria-label="SARAS assistant" hidden><div class="assistant-heading"><strong>SARAS · your companion</strong><button id="assistantClose" type="button" aria-label="Close assistant">×</button></div><p id="assistantHealth" role="status"></p><div id="assistantMessages" role="log" aria-live="polite"></div><div id="assistantReview" hidden><pre id="assistantPlan"></pre><label id="assistantConfirmLabel" hidden>Type the approval shown above<input id="assistantConfirm" autocomplete="off"></label><button id="assistantApprove" type="button">Approve & run</button><button id="assistantCancel" type="button">Cancel</button></div><form id="assistantForm"><label class="sr" for="assistantText">Ask SARAS</label><textarea id="assistantText" maxlength="4000" required placeholder="Ask a question, latest news, or open calculator…"></textarea><label>Request type<select id="assistantRoute"><option value="auto">Auto</option><option value="chat">Chat / news / research</option><option value="pc">Do a laptop task</option><option value="settings">SARAS settings / memory</option></select></label><button id="assistantSend" type="submit">Send</button><button id="assistantMic" type="button">Use voice input</button></form><div class="assistant-options"><label><input id="assistantMotion" type="checkbox">Pause movement</label><button id="assistantHide" type="button">Hide character</button><button id="assistantEmergency" type="button">Stop PC access</button></div><p class="assistant-help">PC actions need review. Results come from your laptop. Local setup permissions stay under your control.</p></section>`;
document.body.append(host);
const show=document.createElement('button');show.type='button';show.textContent='Show SARAS character';show.id='showAssistant';el('settings').append(show);
let busy=false,proposal=null,tracking=null,hidden=false,paused=false,previousFocus=null;
try{hidden=localStorage.getItem('saras-character-hidden')==='1';paused=localStorage.getItem('saras-character-paused')==='1'}catch{}
el('assistantMotion').checked=paused;
function persist(){try{localStorage.setItem('saras-character-hidden',hidden?'1':'0');localStorage.setItem('saras-character-paused',paused?'1':'0')}catch{}}
function line(text,role='assistant'){const p=document.createElement('div');p.className='bubble '+role;p.dir='auto';p.textContent=text;el('assistantMessages').append(p);while(el('assistantMessages').children.length>40)el('assistantMessages').firstChild.remove();p.scrollIntoView({block:'nearest'});return p}
function say(text){if(el('speak').checked)SarasVoice.speak(text,el('voiceLanguage').value)}
function tab(name){document.querySelector('[data-tab="'+name+'"]')?.click()}
function visibility(){host.hidden=el('app').hidden;if(host.hidden){proposal=null;tracking=null;el('assistantReview').hidden=true;el('assistantPanel').hidden=true;el('assistantMessages').replaceChildren()}el('mouseCharacter').hidden=hidden||!el('assistantPanel').hidden;host.classList.toggle('motion-paused',paused)}
new MutationObserver(visibility).observe(el('app'),{attributes:true,attributeFilter:['hidden']});visibility();
function open(){previousFocus=document.activeElement;hidden=false;persist();el('assistantPanel').hidden=false;visibility();el('assistantText').focus();status()}
function close(){el('assistantPanel').hidden=true;visibility();if(previousFocus?.isConnected)previousFocus.focus()}
el('mouseCharacter').onclick=open;show.onclick=open;el('assistantClose').onclick=close;
host.addEventListener('keydown',e=>{if(e.key==='Escape'){close();e.stopPropagation()}});
el('assistantHide').onclick=()=>{hidden=true;persist();close();line('Character hidden. Restore it from Settings.');tab('settings');show.focus()};
el('assistantMotion').onchange=()=>{paused=el('assistantMotion').checked;persist();visibility()};
async function status(){try{const s=await request('state');el('assistantHealth').textContent=(Date.now()/1000-s.heartbeat<45?'Laptop online':'Laptop offline')+' · PC access '+(s.remote?'enabled':'disabled')}catch(e){el('assistantHealth').textContent=e.message}}
async function work(fn){if(busy)return;busy=true;el('assistantSend').disabled=true;el('assistantApprove').disabled=true;try{await fn()}catch(e){line(e.message||'Request failed. Please try again.')}finally{busy=false;el('assistantSend').disabled=false;el('assistantApprove').disabled=false}}
async function settings(text){
 const memory=text.match(/^(?:remember|yaad rakho|memory|یاد رکھو)\s*:\s*([\s\S]+)$/i);
 if(memory){const current=await request('memory');const next=[current.text,memory[1]].filter(Boolean).join('\n');if(next.length>2000)throw Error('Saved memory is full. Review it in Settings.');if(!confirm('Add this to your saved SARAS memory?\n'+memory[1]))return line('Memory change cancelled.');await request('memory',{text:next});line('Added to your saved memory.');return}
 if(/^voice (on|off)$/i.test(text)){el('speak').checked=/on$/i.test(text);el('speak').dispatchEvent(new Event('change'));line('Spoken replies '+(el('speak').checked?'enabled.':'disabled.'));return}
 if(/^(dark|light) mode$/i.test(text)){const target=/^dark/i.test(text)?'dark':'light';if(document.documentElement.dataset.console!==target)el('themeToggle').click();line('Changed to '+target+' mode.');return}
 const language=text.match(/^language\s*:\s*(urdu|hindi|punjabi|english)$/i);
 if(language){const code={urdu:'ur-PK',hindi:'hi-IN',punjabi:'pa-IN',english:'en-US'}[language[1].toLowerCase()];if(!Array.from(el('voiceLanguage').options).some(o=>o.value===code))throw Error('Choose the available language in Settings.');el('voiceLanguage').value=code;el('voiceLanguage').dispatchEvent(new Event('change'));line('Input language changed. Select an installed speaker for matching pronunciation in Settings.');return}
 if(/^(settings|my settings|meri settings)$/i.test(text)){const m=await request('memory');line('Reply voice: '+(el('speak').checked?'on':'off')+'\nLanguage: '+el('voiceLanguage').value+'\nSpeaker: '+el('voiceEngine').selectedOptions[0].textContent+'\nHistory recall: '+(m.history_recall?'on':'off')+'\nSaved memory: '+(m.text||'empty'));return}
 tab('settings');line('Settings opened. You can say: “voice on”, “voice off”, “dark mode”, “language: Urdu”, or “remember: I prefer Roman Urdu”. Laptop pairing and permissions must be changed in the local setup; I cannot silently grant access.');
}
el('assistantForm').onsubmit=e=>{e.preventDefault();work(async()=>{
 if(tracking)throw Error('A PC action is still pending. Wait for its result or stop PC access.');
 const text=el('assistantText').value.trim();if(!text)return;
 proposal=null;el('assistantReview').hidden=true;line(text,'user');el('assistantText').value='';
 const intent=globalThis.SarasAssistantRouting.route(text,el('assistantRoute').value);
 if(intent==='settings')return settings(text);
 if(intent==='pc'){
  const s=await request('state');if(!s.remote||Date.now()/1000-s.heartbeat>=45)throw Error('Laptop must be online with PC access enabled. Open My PC to check.');
  proposal=await request('plan',{text});if(!proposal.tool)throw Error(proposal.explanation||'No supported PC action found.');
  el('assistantPlan').textContent=proposal.explanation+'\nAction: '+proposal.tool.replaceAll('_',' ')+'\n'+Object.entries(proposal.args).map(([key,value])=>key.replaceAll('_',' ')+': '+(typeof value==='string'?value:JSON.stringify(value))).join('\n')+(proposal.sensitive?'\nType: '+(proposal.confirmation||'APPROVE '+proposal.tool):'');
  el('assistantConfirmLabel').hidden=!proposal.sensitive;el('assistantConfirm').value='';el('assistantReview').hidden=false;line('I prepared the action. Review it, then approve to run.');return;
 }
 const output=line('Thinking…');let answer='';
 await globalThis.SarasAssistantBridge.chat(text,delta=>{answer+=delta;output.replaceChildren();globalThis.SarasAssistantBridge.render(output,answer)});
});};
el('assistantApprove').onclick=()=>work(async()=>{if(!proposal)return;const p=proposal;const result=await request('command',{plan_id:p.plan_id,confirmed:true,confirmation:el('assistantConfirm').value});proposal=null;el('assistantReview').hidden=true;if(Number.isInteger(result.command_id)){tracking={id:result.command_id,started:Date.now()};line('Request #'+result.command_id+' sent to your laptop. Waiting for its result.')}else line('Request sent. This older server does not return an action ID; check My PC execution log before retrying.');say('I have sent the approved action to your laptop.');await globalThis.SarasAssistantBridge.refresh()});
el('assistantCancel').onclick=()=>{proposal=null;el('assistantReview').hidden=true;line('Cancelled. No action sent.')};
el('assistantEmergency').onclick=()=>work(async()=>{await request('remote',{enabled:false});proposal=null;tracking=null;el('assistantReview').hidden=true;line('PC access disabled; pending actions cancelled. A running action may finish.');await globalThis.SarasAssistantBridge.refresh();status()});
el('assistantMic').onclick=()=>work(async()=>{if(!confirm('Use browser speech recognition? Its provider may process microphone audio.'))return;await SarasVoice.listen(el('voiceLanguage').value,text=>{el('assistantText').value=text;el('assistantText').focus()},text=>{el('assistantHealth').textContent=text})});
setInterval(async()=>{if(!tracking||document.hidden||el('app').hidden)return;const pending=tracking;try{const s=await request('state');if(tracking!==pending)return;const c=s.commands.find(c=>c.id===pending.id);if(c&&!['queued','awaiting local approval'].includes(c.status)){tracking=null;const text='Request #'+c.id+' · '+c.status+'\n'+(c.result||'No result details.');line(text);say('Your laptop reported: '+c.status);await globalThis.SarasAssistantBridge.refresh()}else if(Date.now()-pending.started>300000){tracking=null;line('No final result received. Check My PC execution log; completion is not confirmed.')}}catch(e){el('assistantHealth').textContent='Cannot check laptop result: '+e.message}},3000);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
function cornerPlan(width,height,random=Math.random){
 const side=random()<.5?'left':'right',roll=random();
 return {side,pose:roll<.55?'peek':roll<.83?'eyes':roll<.93?'hide':'walk',left:side==='left'?0:Math.max(0,width-64),top:random()<.5?12:Math.max(12,height-180)};
}
function move(){
 const pet=el('mouseCharacter');
 if(paused||reduced.matches||host.hidden||hidden||!el('assistantPanel').hidden||document.hidden||document.activeElement===pet||pet.matches(':hover')||pet.classList.contains('is-curious'))return;
 const plan=cornerPlan(document.documentElement.clientWidth,innerHeight);
 const apply=()=>{pet.dataset.side=plan.side;pet.style.left=plan.left+'px';pet.style.top=plan.top+'px';pet.dataset.pose=plan.pose;};
 if(pet.dataset.side!==plan.side){pet.dataset.pose='hide';setTimeout(apply,700)}else apply();
}
let cursor=null;
addEventListener('pointermove',event=>{if(event.pointerType!=='touch')cursor={x:event.clientX,y:event.clientY,at:performance.now()}},{passive:true});
addEventListener('blur',()=>{cursor=null});
addEventListener('pointerout',event=>{if(!event.relatedTarget)cursor=null});
setInterval(()=>{
 const pet=el('mouseCharacter'),rect=pet.getBoundingClientRect();
 const dx=cursor?cursor.x-(rect.left+rect.width/2):0,dy=cursor?cursor.y-(rect.top+32):0;
 const near=!!cursor&&!document.hidden&&!host.hidden&&el('assistantPanel').hidden&&Math.hypot(dx,dy)<150&&!paused&&!reduced.matches;
 pet.classList.toggle('is-curious',near);pet.dataset.focusBlink=near&&performance.now()%4800<160?'1':'0';
 const sideways=['peek','eyes'].includes(pet.dataset.pose),localX=sideways?(pet.dataset.side==='left'?dy:-dy):dx;pet.style.setProperty('--gaze-mirror',near&&localX<0?'-1':'1');
 pet.style.setProperty('--gaze-yaw',(near?Math.max(-7,Math.min(7,dx*.06)):0)+'deg');
 pet.style.setProperty('--gaze-pitch',(near?Math.max(-5,Math.min(5,-dy*.04)):0)+'deg');
 if(near&&pet.dataset.pose==='hide')pet.dataset.pose='peek';
},80);
setInterval(move,9500);
setInterval(()=>{if(!host.hidden)el('mouseCharacter').classList.toggle('is-speaking',!!globalThis.SarasVoice?.isSpeaking())},120);
addEventListener('resize',()=>{const pet=el('mouseCharacter');pet.style.left=(pet.dataset.side==='left'?0:Math.max(0,document.documentElement.clientWidth-64))+'px';pet.style.top=Math.min(parseFloat(pet.style.top)||12,Math.max(12,innerHeight-180))+'px'});
})();
