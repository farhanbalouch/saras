/* Uses existing authenticated API, reminder storage and notification path. */
(function(){
 let audio=null;
 const dueChecks=new Set();
 let clipboardSnapshot=null,clipboardId=0;
 async function prepareAudio(){
  if(!$('timerSound').checked)return;
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)throw Error('Alarm audio unavailable; use browser notifications instead.');
  if(!audio)audio=new Audio();
  if(audio.state==='suspended')await audio.resume();
 }
 function alarm(due){
  if(typeof due==='number'&&Date.now()/1000-due>30)return;
  if(!$('timerSound').checked||!audio||audio.state!=='running')return;
  for(let i=0;i<3;i++){
   const oscillator=audio.createOscillator(),gain=audio.createGain();
   oscillator.frequency.value=660;gain.gain.value=.08;
   oscillator.connect(gain);gain.connect(audio.destination);
   oscillator.start(audio.currentTime+i*.35);oscillator.stop(audio.currentTime+i*.35+.18);
  }
 }
 $('timerSound').addEventListener('change',()=>prepareAudio().catch(error=>notice(error,'error')));
 $('timerForm').onsubmit=e=>formTask(e,'Starting timer…','Timer saved. Keep this page open for its countdown and sound.',async()=>{
  await prepareAudio();
  const seconds=Number($('timerSeconds').value);
  if(!Number.isInteger(seconds)||seconds<1||seconds>86400)throw Error('Use 1–86400 whole seconds.');
  await api('timer',{seconds,text:$('timerLabel').value});await refresh();tick();
 });
 $('weatherForm').onsubmit=e=>formTask(e,'Fetching city weather…','Weather fetched.',async()=>{
  const result=await api('weather',{city:$('weatherCity').value});
  const current=result.current,units=result.units;
  $('weatherResult').textContent=result.location+' • '+current.temperature_2m+(units.temperature_2m||'°C')+' • Feels like '+current.apparent_temperature+(units.apparent_temperature||'°C')+' • Humidity '+current.relative_humidity_2m+'% • Wind '+current.wind_speed_10m+' '+(units.wind_speed_10m||'km/h')+' • Conditions timestamp: '+current.time+' ('+result.timezone+'). '+result.note;
 });
 action('readClipboard',async()=>{
  if(!confirm('Read the current laptop clipboard into the private cloud command log? It may contain private text.'))return false;
  await api('command',{tool:'clipboard_read',args:{},confirmed:true,confirmation:'CLIPBOARD READ'});schedulePoll(2000);
 },'Requesting clipboard preview…','Clipboard read queued. Preview appears after the companion responds.');
 $('saveClipboardForm').onsubmit=e=>formTask(e,'Saving copied text…','Clipboard save queued. Check the execution log.',async()=>{
  if(!confirm('Save the laptop clipboard text to this new shared file?'))return false;
  await api('command',{tool:'clipboard_save',args:{folder:$('clipboardFolder').value,path:$('clipboardPath').value},confirmed:true,confirmation:'CLIPBOARD SAVE'});schedulePoll(2000);
 });
 $('pasteClipboardForm').onsubmit=e=>formTask(e,'Sending reviewed paste…','Paste queued. Check the target window and execution log.',async()=>{
  if(!clipboardSnapshot)throw Error('Read and review copied text first.');
  if(clipboardSnapshot.text.length>500||/[\x00-\x1f\x7f-\x9f]/.test(clipboardSnapshot.text))throw Error('Paste supports 1–500 visible characters. Save multiline text to a file instead.');
  if(!confirm('Type this reviewed clipboard text into '+$('clipboardWindow').value+'?'))return false;
  await api('command',{tool:'clipboard_paste',args:{window:$('clipboardWindow').value,expected_sha256:clipboardSnapshot.sha256},confirmed:true,confirmation:'CLIPBOARD PASTE'});schedulePoll(2000);
 });
 function tick(){
  $('liveClock').textContent=new Date().toLocaleString(undefined,{dateStyle:'full',timeStyle:'medium'})+' • Your device time';
  if(typeof state==='undefined'||!state||$('app').hidden)return;
  const copied=(state.commands||[]).find(c=>c.tool==='clipboard_read'&&c.status==='completed');
  if(copied&&copied.id!==clipboardId){try{const data=JSON.parse(copied.result);if(typeof data.text==='string'&&typeof data.sha256==='string'){clipboardSnapshot=data;clipboardId=copied.id;$('clipboardPreview').textContent=data.text;}}catch{}}
  const queue=$('timerQueue');queue.replaceChildren();
  for(const reminder of state.reminders||[]){
   const seconds=Math.max(0,Math.ceil(reminder.due-Date.now()/1000));
   if(!reminder.text.startsWith('Timer: ')&&seconds===0)continue;
   const row=document.createElement('div');row.className='item';
   const label=document.createElement('span');label.textContent=reminder.text+' • '+(seconds?Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m '+seconds%60+'s':'Due');row.append(label);
   const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Dismiss / cancel';
   cancel.onclick=()=>buttonTask(cancel,'Cancelling…',async()=>{await api('reminder/cancel',{id:reminder.id});await refresh();tick()},'Reminder cancelled.');row.append(cancel);queue.append(row);
   if(!seconds&&!delivered.has(reminder.id)&&!dueChecks.has(reminder.id)){
    dueChecks.add(reminder.id);refresh();
   }
  }
 }
 globalThis.SarasProductivity={alarm};tick();setInterval(tick,1000);
})();
