(function(){
const $=id=>document.getElementById(id),base=location.pathname.match(/^\/account\/[0-9a-f]{32}/)?.[0]||'';
function devices(){const select=$('deviceVoice'),previous=select.value;select.replaceChildren(new Option('Automatic device voice',''));for(const voice of speechSynthesis.getVoices())select.add(new Option(voice.name+' — '+voice.lang,voice.voiceURI));select.value=previous}
function apply(){$('voiceEngineStatus').dataset.catalog='0';SarasVoice.configure($('voiceEngine').value,$('deviceVoice').value);const choice=$('voiceEngine').selectedOptions[0];$('voiceEngineStatus').textContent=choice?.dataset.hint||($('voiceEngine').value==='fasih'?'Urdu script zaroori hai. Roman Urdu ko optional conversion se pehle review karein.':'Selected voice ready for a test.')}
$('voiceEngine').onchange=apply;$('deviceVoice').onchange=apply;
if('speechSynthesis'in window){devices();speechSynthesis.addEventListener('voiceschanged',devices)}
let checking=false,lastCatalog='';
const preferenceKey='saras-voice-choice:'+base;
let savedChoice='';try{savedChoice=localStorage.getItem(preferenceKey)||''}catch{}
const previousApply=apply;
$('voiceEngine').onchange=()=>{savedChoice=$('voiceEngine').value;try{localStorage.setItem(preferenceKey,savedChoice)}catch{}previousApply()};
async function loadCatalog(manual=false){
 if(checking||SarasVoice.isSpeaking())return;
 checking=true;const button=$('loadVoices'),controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),10000);
 if(manual){button.disabled=true;button.textContent='Checking voices…'}
 try{
  const response=await fetch(base+'/api/voice/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Voice connection could not be checked');
  const signature=JSON.stringify(data),firstCheck=!lastCatalog;
  if(signature!==lastCatalog){
   const select=$('voiceEngine'),previous=select.value;
   select.replaceChildren(new Option('Device voices — choose below','device'));
   for(const voice of data.voices){
    const missing=voice.remote&&voice.availability!=='model_missing'?' — laptop voice connection unavailable':' — not installed on laptop';
    const option=new Option(voice.name+(voice.installed?'':missing),voice.id);
    option.disabled=!voice.installed;option.dataset.language=voice.language;option.dataset.hint=voice.hint||voice.license;select.add(option);
   }
   const preferred=savedChoice||(firstCheck?(data.default_voice||'aegis-urdu-female'):previous);
   const available=value=>Array.from(select.options).some(o=>o.value===value&&!o.disabled);select.value=available(preferred)?preferred:available(data.default_voice)?data.default_voice:available(previous)?previous:'device';
   if(firstCheck||select.value!==previous)apply();
   lastCatalog=signature;
  }
  if(manual||firstCheck||$('voiceEngineStatus').dataset.catalog==='1'){
   $('voiceEngineStatus').textContent=data.relay?.message||'Choose a voice and press Test. Personal-use voices are labelled.';
   $('voiceEngineStatus').dataset.state=data.relay&&data.relay.state!=='ready'?'error':'success';
  }
  $('voiceEngineStatus').dataset.catalog='1';
 }catch(e){if(manual){$('voiceEngineStatus').textContent=e.name==='AbortError'?'Voice check timed out. Try again when connected.':e.message;$('voiceEngineStatus').dataset.state='error'}}
 finally{clearTimeout(timeout);checking=false;button.disabled=false;button.textContent='Load installed voices'}
}
$('loadVoices').onclick=()=>loadCatalog(true);
// Watch only an open Settings panel; do not cancel speech or change the speaker.
setInterval(()=>{if(!document.hidden&&$('voiceEngine').getClientRects().length&&document.activeElement!==$('voiceEngine'))loadCatalog()},10000);
document.querySelector('[data-tab="settings"]')?.addEventListener('click',()=>loadCatalog(true));
$('testVoice').onclick=()=>{const key=$('voiceEngine').value,lang=$('voiceEngine').selectedOptions[0]?.dataset.language;const text=lang==='ur-PK'?'السلام علیکم، میں ساراس ہوں۔ آج آپ کی پڑھائی کیسی جا رہی ہے؟':lang==='hi-IN'?'नमस्ते, मैं सारस हूँ। आज हम Python coding की practice करेंगे।':lang==='pa-IN'?'ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਸਾਰਸ ਹਾਂ। ਅੱਜ ਅਸੀਂ ਪੰਜਾਬੀ ਬੋਲਾਂਗੇ।':'Hello, I am Saras. Let us make a simple study plan.';$('speechScript').value=text;SarasVoice.speak(text,$('voiceLanguage').value)};
$('prepareSpeechScript').onclick=async()=>{const button=$('prepareSpeechScript');if(!confirm('Send only this box’s text to your configured AI provider for script conversion? Review the result before speaking.'))return;const old=button.textContent;button.disabled=true;button.textContent='Preparing script…';$('voiceEngineStatus').textContent='Converting with your AI provider…';$('voiceEngineStatus').dataset.state='loading';try{const response=await fetch(base+'/api/voice/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:$('speechScript').value,voice:$('voiceEngine').value,allow_provider_conversion:true})});const data=await response.json();if(!response.ok)throw Error(data.error);$('speechScript').value=data.text;$('voiceEngineStatus').textContent='Review / edit the transcript, then press Speak reviewed text. Conversion can make mistakes.';$('voiceEngineStatus').dataset.state='success'}catch(error){$('voiceEngineStatus').textContent=error.message;$('voiceEngineStatus').dataset.state='error'}finally{button.disabled=false;button.textContent=old}};
$('speakSpeechScript').onclick=()=>SarasVoice.speak($('speechScript').value,$('voiceLanguage').value);
// Load the shared model catalogue at login on desktop and mobile, not only Settings.
const app=document.getElementById('app');
if(app){new MutationObserver(()=>{if(!app.hidden&&!lastCatalog)loadCatalog()}).observe(app,{attributes:true,attributeFilter:['hidden']});if(!app.hidden)loadCatalog()}
})();
