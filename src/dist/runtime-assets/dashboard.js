(() => {
  const $=id=>document.getElementById(id),token=location.hash.slice(1);
  if(token)history.replaceState(null,'','/dashboard');
  const session=SarasSetupSession.create(fetch.bind(window),token);
  async function load(){try{
    const s=await session.call('/status'),d=s.defaults;
    $('dashboardStatus').textContent=s.status;
    $('connectionSummary').textContent=s.busy?'Working · check status':s.status;
    $('voiceSummary').textContent=d.remote_voice?'Allowed on this laptop':'Not allowed';
    $('powerSummary').textContent=d.system_controls?'Allowed with approval':'Not allowed';
    $('inputSummary').textContent=d.desktop_input?'Allowed with approval':'Not allowed';
    $('serverSummary').textContent='Saved server: '+d.url;
    $('dashboardLogs').textContent=s.logs.join('\n')||'No companion events yet.';
  }catch(e){$('notice').textContent=e.message;$('notice').dataset.state='error'}}
  for(const [id,path] of [['dashboardStop','/stop'],['dashboardStart','/start']])$(id).addEventListener('click',async()=>{
    const button=$(id);button.disabled=true;
    try{await session.call(path,{});await load()}catch(e){$('notice').textContent=e.message}finally{button.disabled=false}
  });
  load();setInterval(load,5000);
})();
