(function(global){
let selected='device',deviceVoice='',queue=Promise.resolve(),generation=0,audio=null,request=null,pending=0,activeCues=[];
const base=typeof location==='undefined'?'':location.pathname.match(/^\/account\/[0-9a-f]{32}/)?.[0]||'';
function voiceStatus(text,state){if(typeof document==='undefined')return;const el=document.getElementById('voiceEngineStatus');if(el){el.textContent=text;el.dataset.state=state}}
function cancel(){generation++;pending=0;activeCues=[];request?.abort();if(audio){audio.pause();audio=null}if(global.speechSynthesis)global.speechSynthesis.cancel()}
function viseme(){const time=audio?.currentTime||0;return activeCues.find(c=>c.start<=time&&time<c.end)?.pose||0}
function configure(voice,device){cancel();selected=voice||'device';deviceVoice=device||''}
function isSpeaking(){return pending>0||!!(global.speechSynthesis&&global.speechSynthesis.speaking)}
function localSpeak(text){
 const revision=generation;pending++;
 voiceStatus('Audio ban rahi hai… pehli dafa model load hone mein waqt lagta hai.','loading');
 queue=queue.catch(()=>{}).then(async()=>{
  if(revision!==generation)return;
  const controller=new AbortController();request=controller;let url;
  try{
   // Bound each request; split only on whitespace so speech text is not truncated.
   const size=selected.startsWith('kokoro-')?90:300;
   const parts=text.match(new RegExp('.{1,'+size+'}(?:\\s|$)|\\S{1,'+size+'}','gu'))||[];
   for(const part of parts){
    if(revision!==generation)return;
    const response=await fetch(base+'/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:part.trim(),voice:selected}),signal:controller.signal});
    if(!response.ok){const error=await response.json();throw Error(error.error||'Local voice failed')}
    let blob;activeCues=[];
    if(response.status===202){
     const ticket=await response.json();let ready=false;
     for(let attempt=0;attempt<90;attempt++){
      await new Promise(resolve=>setTimeout(resolve,650));
      if(controller.signal.aborted||revision!==generation)return;
      const poll=await fetch(base+'/api/voice/job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:ticket.id}),signal:controller.signal});
      const result=await poll.json();if(!poll.ok||result.error)throw Error(result.error||'Voice relay unavailable');
      if(result.state==='done'){const bytes=Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0));blob=new Blob([bytes],{type:'audio/wav'});activeCues=Array.isArray(result.cues)?result.cues:[];ready=true;break}
     }
     if(!ready)throw Error('Voice companion took too long. Check laptop connection.');
    }else blob=await response.blob();
    if(revision!==generation)return;
    url=URL.createObjectURL(blob);audio=new Audio(url);
    voiceStatus('SARAS bol rahi hai… Stop voice / reply se rok sakte hain.','success');
    await new Promise((resolve,reject)=>{audio.onended=resolve;audio.onerror=()=>reject(Error('Audio playback failed'));controller.signal.addEventListener('abort',()=>reject(Error('Speech stopped')),{once:true});audio.play().catch(reject)});
    URL.revokeObjectURL(url);url=null;audio=null;
   }
  }catch(error){if(revision===generation&&typeof document!=='undefined'){const status=document.getElementById('voiceEngineStatus');if(status){status.textContent=error.message;status.dataset.state='error'}}}
  finally{if(url)URL.revokeObjectURL(url);if(revision===generation){pending=Math.max(0,pending-1);audio=null;request=null}}
 });
 return true;
}
function spokenText(text){
 try{const parsed=JSON.parse(String(text).trim());if(parsed&&typeof parsed==='object')return ''}catch{}
 return String(text||'').replace(/```[\s\S]*?```/g,' ').replace(/`[^`]*`/g,' ')
  .replace(/\{[^{}]*\}|\[[\s\S]*?\]/g,match=>{try{JSON.parse(match);return ' '}catch{return match}})
  .replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
  .replace(/https?:\/\/\S+/g,' ').replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu,' ')
  .replace(/^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/gm,'').replace(/[*_~|<>={}\[\]\\]/g,' ')
  .replace(/\s+/g,' ').replace(/\s+([.,!?،؟])/g,'$1').trim();
}
function speak(text,language,append=false){
 const clean=spokenText(text);if(!clean)return false;
 if(selected!=='device'){if(!append)cancel();return localSpeak(clean)}
 if(!global.speechSynthesis)return false;
 if(!append)global.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(clean);
 utterance.lang=language||'ur-PK';utterance.rate=1.04;utterance.pitch=1.03;
 const voices=global.speechSynthesis.getVoices();const voice=voices.find(v=>v.voiceURI===deviceVoice)||voices.find(v=>v.lang.toLowerCase()===utterance.lang.toLowerCase())||voices.find(v=>v.lang.startsWith(utterance.lang.split('-')[0]));if(voice)utterance.voice=voice;
 global.speechSynthesis.speak(utterance);return true;
}
function listen(language,onText,onStatus){
 const R=global.SpeechRecognition||global.webkitSpeechRecognition;
 if(!R)return Promise.reject(Error('Voice input unsupported. Try Chrome / Edge or type.'));
 cancel();
 return new Promise((resolve,reject)=>{const recognition=new R();let failed=false;
  recognition.lang=language;recognition.interimResults=true;recognition.continuous=false;
  recognition.onresult=e=>{let text='';for(let i=0;i<e.results.length;i++)text+=e.results[i][0].transcript+' ';onText(text.trim())};
  recognition.onstart=()=>onStatus('Listening… jo bolo ge woh screen par dikhega.');
  recognition.onerror=e=>{failed=true;reject(Error('Microphone: '+e.error))};
  recognition.onend=()=>{if(!failed)resolve()};recognition.start();
 });
}
function createNarrator(language){
 let raw='',sent='',cancelled=false;cancel();
 function flush(final){
  if(cancelled)return;
  if(!final&&((raw.match(/```/g)||[]).length%2||(raw.match(/`/g)||[]).length%2||(raw.match(/\{/g)||[]).length!==(raw.match(/\}/g)||[]).length))return;
  let content=raw;if(final&&(raw.match(/```/g)||[]).length%2)content=raw.slice(0,raw.lastIndexOf('```'));
  const clean=spokenText(content);if(!clean.startsWith(sent))return;const remaining=clean.slice(sent.length);
  let end=final?remaining.length:0;if(!final){const matches=[...remaining.matchAll(/[.!?۔؟](?=\s)/g)];if(matches.length)end=matches.at(-1).index+1}
  if(end){const text=remaining.slice(0,end);speak(text,language,true);sent+=text}
 }
 return {push(delta){raw+=delta;flush(false)},finish(){flush(true)},cancel(){cancelled=true;cancel()}};
}
global.SarasVoice={spokenText,speak,listen,createNarrator,configure,cancel,isSpeaking,viseme};
})(globalThis);
