/* PIN is verified by the server; this dialog does not grant authorization. */
globalThis.SarasAppLock={
 show(api,onUnlock){
  let dialog=document.getElementById('sarasUnlock');
  if(dialog){if(!dialog.open)dialog.showModal();return}
  dialog=document.createElement('dialog');dialog.id='sarasUnlock';
  dialog.innerHTML='<form><h2>Unlock SARAS</h2><p>Your account is signed in. Enter this device’s SARAS app PIN.</p><label>App PIN<input type="password" inputmode="numeric" autocomplete="off" required minlength="6" maxlength="12"></label><p role="status"></p><button>Unlock</button><button type="button" data-logout>Sign out</button></form>';
  dialog.addEventListener('cancel',e=>e.preventDefault());
  dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=dialog.querySelector('button');button.disabled=true;try{await api('auth/app-lock',{action:'unlock',pin:dialog.querySelector('input').value});dialog.querySelector('input').value='';dialog.close();dialog.remove();await onUnlock()}catch(error){dialog.querySelector('[role=status]').textContent=error.message}finally{button.disabled=false}};
  dialog.querySelector('[data-logout]').onclick=async()=>{await api('auth/logout',{});location.reload()};document.body.append(dialog);dialog.showModal();
 },
 settings(api){
  const parent=document.querySelector('[data-panel="settings"]');if(!parent)return;
  const form=document.createElement('form');form.innerHTML='<h3>App lock on this device</h3><p>Stay signed in for up to 30 days of inactivity. Set a separate SARAS PIN to lock this session when you leave the app. Google’s password is never requested here.</p><label>Current app PIN, if already set<input name="current" type="password" inputmode="numeric" autocomplete="off"></label><label>New app PIN (6–12 digits)<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6,12}" minlength="6" maxlength="12" required autocomplete="new-password"></label><button>Save app PIN</button><p role="status"></p>';
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{await api('auth/app-lock',{action:'configure',pin:form.elements.pin.value,current_pin:form.elements.current.value});form.reset();form.querySelector('[role=status]').textContent='App PIN saved for this signed-in device.'}catch(error){form.querySelector('[role=status]').textContent=error.message}finally{button.disabled=false}};parent.append(form);
 }
};
