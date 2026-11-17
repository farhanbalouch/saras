/* JSON requests are bounded and never retried: a timed-out action may have run. */
(function(global){
async function json(url,options={},timeout=45000){
 const controller=new AbortController();let timedOut=false;
 const abort=()=>controller.abort();
 if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},timeout);
 try{
  let response;
  try{response=await fetch(url,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal})}
  catch(error){if(timedOut)throw Error('SARAS took too long. Check the execution log before sending an action again.');if(error.name==='AbortError')throw error;throw Error('Cannot reach SARAS. Check your connection and keep SARAS Next running on the laptop. No automatic retry was sent.');}
  let data;try{data=await response.json()}catch(error){if(timedOut)throw Error('SARAS response timed out. Check the execution log before retrying.');throw Error('SARAS returned an unreadable response. Reopen SARAS Next; if using a private link, check its connection.');}
  if(!response.ok)throw Error(data.error||('SARAS request failed (HTTP '+response.status+').'));
  return data;
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort)}
}
global.SarasNetwork={json};
})(globalThis);
