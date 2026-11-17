(() => {
  let prompt=null;const button=document.getElementById('mobileInstall');
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;button.hidden=false});
  button.addEventListener('click',async()=>{
    if(!prompt){window.alert('On iPhone or iPad: open SARAS in Safari, tap Share, then Add to Home Screen. On Android: use your browser menu and choose Install app or Add to Home screen.');return}
    await prompt.prompt();await prompt.userChoice;prompt=null;button.hidden=true;
  });
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  if(!standalone){button.hidden=false;button.textContent='Install SARAS'}
  const offline=document.createElement('p');offline.setAttribute('role','status');offline.textContent='You are offline. Laptop control is unavailable until this device reconnects.';offline.hidden=navigator.onLine;document.querySelector('main')?.prepend(offline);
  window.addEventListener('online',()=>{offline.hidden=true});window.addEventListener('offline',()=>{offline.hidden=false});
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/mobile/sw.js',{scope:'/'}).then(registration=>{
      const offer=()=>{if(!registration.waiting)return;const update=document.createElement('button');update.type='button';update.textContent='SARAS update ready — reload';update.addEventListener('click',()=>registration.waiting?.postMessage({type:'ACTIVATE_UPDATE'}));document.querySelector('header')?.append(update)};
      offer();registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)offer()})});
      let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloading&&navigator.serviceWorker.controller){reloading=true;location.reload()}});
    }).catch(()=>{});
  }
})();
