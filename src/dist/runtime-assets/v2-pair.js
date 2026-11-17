(() => {
  const $=id=>document.getElementById(id),session=SarasSetupSession.create(fetch.bind(window),'');
  let active=false,busy=false,paired=false,deadline=0,starting=false;
  const panel=$('v2-account-pair');
  panel.querySelector('h2').textContent='Connect your phone';
  panel.querySelector(':scope > p').textContent='1. Show a QR here. 2. In the signed-in mobile app choose Scan laptop QR and request the connection. 3. Compare the code and approve here. You can use an 8-digit code instead.';
  $('v2Claim').textContent='Connect using phone code';$('v2QR').textContent='Show QR / generate new code';
  const autoLabel=document.createElement('label');autoLabel.className='check';
  const auto=document.createElement('input');auto.type='checkbox';auto.checked=true;autoLabel.append(auto,document.createTextNode('Start the companion connection after I approve. Local power, keyboard and voice permissions stay as selected below.'));$('v2Review').append(autoLabel);
  const startButton=document.createElement('button');startButton.type='button';startButton.textContent='Start account connection';startButton.className='v2-outline';startButton.disabled=true;panel.append(startButton);
  function note(message){$('v2PairStatus').textContent=message}
  function clear(message){active=false;deadline=0;$('v2Review').hidden=true;$('v2QRImage').hidden=$('v2QRLink').hidden=true;$('v2Compare').textContent='';$('v2CompareConsent').checked=false;if(message)note(message)}
  async function task(button,work){if(button.disabled)return;const label=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Please wait…';try{await work()}catch(error){note(error.message)}finally{button.disabled=button===startButton?!paired:false;button.removeAttribute('aria-busy');button.textContent=label}}
  async function start(){
    if(starting)return;starting=true;
    try{note('Account paired. Starting your secure outbound connection…');const result=await session.call('/v2/start',{confirmed:$('v2LocalConsent').checked,folder:$('folder').value,desktop_input:$('desktopInput').checked,system_controls:$('powerPermission').checked,remote_voice:$('remoteVoice').checked});note('Connected. On your phone, open My Devices → Control laptop. '+result.message)}finally{starting=false}
  }
  startButton.onclick=()=>task(startButton,start);
  async function begin(qr){
    clear();note(qr?'Creating a secure QR and laptop code…':'Checking your phone code…');
    const result=await session.call(qr?'/v2/qr':'/v2/claim',{code:$('v2Code').value,confirmed:$('v2LocalConsent').checked});
    active=true;paired=false;startButton.disabled=true;deadline=Date.now()+result.expires_in*1000;
    $('v2Compare').textContent=result.compare_code;$('v2Review').hidden=false;$('v2Approval').disabled=false;$('v2Code').value='';
    $('v2QRImage').hidden=!result.url;$('v2QRLink').hidden=!result.url;
    if(result.url){$('v2QRImage').src='/v2/qr.svg';$('v2QRLink').href=result.url;$('v2QRLink').textContent='Open mobile pairing page';note('Ready. Scan this QR from the mobile app. Or enter laptop code '+result.code+' on your phone. Waiting for your account request…')}
    else note('Code accepted. On your phone compare the approval code, tick confirmation and request the connection.');
  }
  $('v2Claim').onclick=()=>task($('v2Claim'),()=>begin(false));$('v2QR').onclick=()=>task($('v2QR'),()=>begin(true));
  $('v2Approval').textContent='Approve this account';
  $('v2Approval').onclick=()=>task($('v2Approval'),async()=>{if(!$('v2CompareConsent').checked)throw Error('Compare both screens and tick the matching-code confirmation first');await session.call('/v2/approve',{compare:$('v2Compare').textContent,approved:true});note('Laptop approval sent. Finishing pairing…')});
  setInterval(async()=>{
    if(!active||busy)return;if(Date.now()>deadline){clear('Pairing expired. Old QR and code cleared. Choose Show QR / generate new code to start again.');return}busy=true;
    try{const result=await session.call('/v2/finish',{});
      if(result.requesting_account)note('Connection request from '+result.requesting_account+'. Compare code '+result.compare_code+' on both screens, then approve only if this is your account.');
      if(result.paired){paired=true;clear();startButton.disabled=false;note('Pairing complete. Your account owns this laptop.');if(auto.checked)await start();else note('Pairing complete. Choose your local permissions below, then Start account connection.');}
    }catch(error){if(/expired|used|unavailable|another account/i.test(error.message))clear(error.message+' Generate a fresh QR to start again.');else note(error.message+' Your pairing is kept; retrying…')}finally{busy=false}
  },2000);
  session.call('/v2/finish',{}).then(result=>{paired=!!result.paired;startButton.disabled=!paired;if(paired)note('Account pairing is saved. Use Start account connection if it is not already online.');else note('Start here: tick “This is my laptop”, then choose Show QR.');}).catch(error=>note(error.message));
})();
