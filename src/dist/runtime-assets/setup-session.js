/* Launcher capability -> HttpOnly session -> fresh CSRF token. No credentials stored. */
(function(global){
  function create(fetcher,launchToken){
    let csrf='',pending=null;
    async function request(path,options={}){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),path==='/folder'?125000:20000);
      try{return await fetcher(path,{...options,signal:controller.signal});}
      catch(error){if(error.name==='AbortError')throw Error('Setup request timed out. Check the status before retrying; the previous action may still be running.');throw error;}
      finally{clearTimeout(timer);}
    }
    async function session(){
      const response=await request('/session',{credentials:'same-origin',cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Reopen Start SARAS.cmd to authorize this browser.');
      csrf=data.csrf;return csrf;
    }
    async function initialize(){
      if(launchToken){
        const response=await request('/bootstrap',{method:'POST',credentials:'same-origin',headers:{Authorization:'Bearer '+launchToken,'Content-Type':'application/json'},body:'{}'});
        const data=await response.json();
        if(response.ok){csrf=data.csrf;return csrf;}
      }
      return session();
    }
    function ready(){if(!pending)pending=initialize().catch(error=>{pending=null;throw error});return pending;}
    async function call(path,data){
      await ready();
      const options=()=>({method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+csrf,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
      let response=await request(path,options());
      if(response.status===401||response.status===403){
        // A new launcher tab has refreshed the shared cookie after a restart.
        await session();response=await request(path,options());
      }
      const result=await response.json();if(!response.ok)throw Error(result.error||'Setup request failed');return result;
    }
    return {call,ready};
  }
  global.SarasSetupSession={create};
})(globalThis);
