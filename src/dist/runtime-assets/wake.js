(function(global){
function extract(text){const match=text.trim().match(/^(?:hey\s+)?(?:saras\b|ساراس|سارس)[\s،,:-]*(.*)$/iu);return match?match[1].trim():null}
global.SarasWake={extract};
if(typeof document==='undefined')return;
let recognition=null,on=false,waitingUntil=0,retry=null,failures=0;
const status=document.getElementById('wakeStatus');
function show(text){status.textContent=text;const dock=document.getElementById('voiceDockStatus');if(dock)dock.textContent=text}

function stop(){on=false;waitingUntil=0;clearTimeout(retry);retry=null;const old=recognition;recognition=null;if(old)old.abort();show('Microphone off');if(global.SarasVoice)global.SarasVoice.cancel();else if(global.speechSynthesis)global.speechSynthesis.cancel()}
function restart(current){
 clearTimeout(retry);retry=null;
 if(!on||recognition!==current||document.hidden)return;
 retry=setTimeout(()=>{retry=null;if(!on||recognition!==current||document.hidden)return;current.lang=document.getElementById('voiceLanguage').value;try{current.start()}catch{failures++;restart(current)}},Math.min(30000,500*2**Math.min(failures,6)));
}
document.getElementById('wakeStop').onclick=stop;
document.getElementById('wakeStart').onclick=()=>{
 const R=global.SpeechRecognition||global.webkitSpeechRecognition;
 if(!R){show('Wake word is unsupported in this browser. Use the microphone button or type.');return}
 if(on)return;
 if(!confirm('Enable microphone listening while this page is open? Browser speech service may process audio. In hands-free conversation, each final utterance is sent; wake-word mode sends only requests after Saras.'))return;
 recognition=new R();const current=recognition;recognition.lang=document.getElementById('voiceLanguage').value;recognition.continuous=true;recognition.interimResults=true;on=true;
 recognition.onresult=e=>{if(!on||recognition!==current)return;if(global.SarasVoice?.isSpeaking()||global.speechSynthesis?.speaking)return;for(let i=e.resultIndex;i<e.results.length;i++){const text=e.results[i][0].transcript;const command=extract(text);if(document.getElementById('voiceSession').checked){document.getElementById('voiceTranscript').textContent=text;document.getElementById(document.getElementById('wakeMode').value==='workflow'?'workflowRequest':document.getElementById('wakeMode').value==='pc'?'pcRequest':'message').value=text;if(e.results[i].isFinal)global.sarasWakeCommand(command||text);continue;}if(command!==null||Date.now()<waitingUntil){const preview=command===null?text:command;document.getElementById('voiceTranscript').textContent=preview;const field=document.getElementById(document.getElementById('wakeMode').value==='workflow'?'workflowRequest':document.getElementById('wakeMode').value==='pc'?'pcRequest':'message');field.value=preview;}if(!e.results[i].isFinal)continue;if(command!==null){waitingUntil=Date.now()+8000;if(command){waitingUntil=0;global.sarasWakeCommand(command)}else show('Saras heard you — say your request now.')}else if(Date.now()<waitingUntil){waitingUntil=0;global.sarasWakeCommand(text)}}};
 recognition.onerror=e=>{if(recognition!==current||!on)return;if(['not-allowed','service-not-allowed','audio-capture','language-not-supported'].includes(e.error)){stop();show('Microphone or selected language unavailable. Check permission and language.')}else {if(e.error!=='no-speech')failures++;show('Listening will resume while this page is open.');restart(current)}};
 recognition.onend=()=>{if(recognition!==current)return;if(on){show(document.hidden?'Listening paused while page is hidden.':'Listening will resume…');restart(current)}};
 recognition.onstart=()=>{clearTimeout(retry);retry=null;show('Listening • Say “Saras…” • keep this page open')};
 recognition.onaudiostart=()=>{failures=0};
 recognition.onspeechstart=()=>show('Hearing you…');
 recognition.onspeechend=()=>show('Processing your words…');

 try{recognition.start();show('Microphone listening • Say Saras • page must stay open')}catch{stop();show('Cannot start microphone. Tap Resume to try again.')}
};
const resume=document.getElementById('voiceResume');if(resume)resume.onclick=()=>document.getElementById('wakeStart').click();
const dockStop=document.getElementById('voiceDockStop');if(dockStop)dockStop.onclick=stop;
global.addEventListener('pagehide',stop);
document.addEventListener('visibilitychange',()=>{if(!on||!recognition)return;clearTimeout(retry);retry=null;if(document.hidden){recognition.abort();show('Listening paused while page is hidden.')}else restart(recognition)});
})(globalThis);
