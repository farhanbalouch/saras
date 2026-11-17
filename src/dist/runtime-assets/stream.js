(function(global){
async function request(text,onDelta,signal,voiceLanguage,webMode){
 const response=await fetch((global.location?.pathname.match(/^\/account\/[0-9a-f]{32}/)?.[0]||'')+'/api/chat-stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice_language:voiceLanguage,web_mode:webMode}),signal});
 if(!response.ok){const data=await response.json();throw Error(data.error||'Chat unavailable')}
 if(!response.body)throw Error('Streaming unsupported in this browser');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false;
 try{while(true){const chunk=await reader.read();buffer+=decoder.decode(chunk.value||new Uint8Array(),{stream:!chunk.done});let split;while((split=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,split);buffer=buffer.slice(split+2);const payload=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(!payload)continue;const event=JSON.parse(payload);if(event.type==='delta')onDelta(event.text);if(event.type==='error')throw Error(event.message);if(event.type==='done')done=true}if(chunk.done)break}if(!done)throw Error('Reply interrupted; partial text is incomplete.')}
 finally{reader.releaseLock()}
}
global.SarasStream={request};
})(globalThis);
