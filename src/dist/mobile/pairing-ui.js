/* Camera frames stay on this device. Only validated pairing data reaches SARAS. */
(() => {
  'use strict';
  function parseQr(value,origin) {
    const url=new URL(value);
    const query=new URLSearchParams(url.search),fragment=new URLSearchParams(url.hash.slice(1));
    if(url.origin!==origin||url.username||url.password||url.pathname!=='/mobile/'||[...query.keys()].join(',')!=='pair'||[...fragment.keys()].join(',')!=='challenge')throw Error('This is not a pairing QR code for this SARAS app. Generate a new QR on your laptop.');
    const id=query.get('pair'),challenge=fragment.get('challenge');
    if(!/^[a-f0-9]{32}$/.test(id)||!/^[A-Za-z0-9_-]{32,100}$/.test(challenge))throw Error('The pairing QR code is incomplete. Generate it again on your laptop.');
    return {id,challenge};
  }
  let decoder;
  async function nativeQr(){
    try{if(globalThis.BarcodeDetector&&(await BarcodeDetector.getSupportedFormats()).includes('qr_code'))return new BarcodeDetector({formats:['qr_code']})}catch{}
    return null;
  }
  function loadDecoder(){
    if(globalThis.jsQR)return Promise.resolve();
    if(!decoder)decoder=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/mobile/vendor/jsQR-1.4.0.js';script.onload=resolve;script.onerror=()=>{decoder=null;reject(Error('Scanner could not load. Use the pairing code instead.'))};document.head.append(script)});
    return decoder;
  }
  function mount({parent,onScan,onReset,onManual}) {
    const make=(tag,text)=>{const element=document.createElement(tag);if(text)element.textContent=text;return element};
    const guide=make('div');guide.className='pairing-guide';
    const heading=make('h3','Connect in three steps');
    const steps=make('ol');steps.className='pairing-steps';
    ['Open Companion on your laptop','Scan QR or use a code','Approve on your laptop'].forEach(text=>steps.append(make('li',text)));
    const progress=make('p','Open the installed Windows companion, then choose Show QR.');progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');
    const actions=make('div');actions.className='pairing-actions';
    const scan=make('button','Scan laptop QR'),manual=make('button','Use a code instead'),reset=make('button','Start again');
    for(const button of [scan,manual,reset])button.type='button';manual.className=reset.className='v2-outline';reset.hidden=true;
    actions.append(scan,manual,reset);guide.append(heading,steps,progress,actions);parent.prepend(guide);
    const dialog=make('dialog');dialog.className='qr-dialog';dialog.setAttribute('aria-label','Scan your laptop pairing QR');
    const title=make('h2','Scan the QR on your laptop');
    const hint=make('p','Hold the QR inside the frame. Camera images stay on your phone.');
    const video=make('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.setAttribute('playsinline','');
    const cameraFrame=make('div');cameraFrame.className='qr-camera-frame';
    const target=make('div');target.className='qr-scan-target';target.setAttribute('aria-hidden','true');
    const laser=make('span');laser.className='qr-scan-laser';target.append(laser);cameraFrame.append(video,target);
    const status=make('p','Allow camera access, then point it at the QR.');status.setAttribute('role','status');
    function setStatus(message,state=''){status.textContent=message;status.dataset.state=state;cameraFrame.dataset.state=state}
    const fileLabel=make('label','Or choose a QR photo');const file=make('input');file.type='file';file.accept='image/*';fileLabel.append(file);
    const close=make('button','Close scanner');close.type='button';dialog.append(title,hint,cameraFrame,status,fileLabel,close);document.body.append(dialog);
    const canvas=make('canvas');let stream=null,frame=0,scanning=false,reading=false,attempt=0,native=null;
    function stop(){attempt++;scanning=false;cancelAnimationFrame(frame);if(stream)for(const track of stream.getTracks())track.stop();stream=null;video.srcObject=null;if(dialog.open)dialog.close();}
    async function deliver(value){
      try{parseQr(value,location.origin);setStatus('QR found. Checking your laptop…','success');stop();await onScan(value)}catch(error){setStatus(error.message,'error');if(!dialog.open)state(1,error.message,true)}
    }
    async function read(source,width,height){
      if(native){try{const found=await native.detect(source);if(found.length)return found[0].rawValue}catch(error){if(error.name==='NotSupportedError')native=null}}
      if(!globalThis.jsQR)return null;
      for(const crop of [1,.6]){
        const w=width*crop,h=height*crop,scale=Math.min(1,1600/Math.max(w,h));canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
        const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(source,(width-w)/2,(height-h)/2,w,h,0,0,canvas.width,canvas.height);
        const pixels=context.getImageData(0,0,canvas.width,canvas.height),result=globalThis.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});if(result)return result.data;
      }
      return null;
    }
    let previous=0;
    async function tick(time){
      if(!scanning)return;
      if(!reading&&time-previous>220&&video.readyState>=2){reading=true;previous=time;try{const value=await read(video,video.videoWidth,video.videoHeight);if(value){await deliver(value)}}catch{setStatus('Keep the whole QR inside the frame. Try moving closer.','error')}finally{reading=false}}
      if(scanning)frame=requestAnimationFrame(tick);
    }
    scan.addEventListener('click',async()=>{
      dialog.showModal();setStatus('Opening your camera…','loading');scan.disabled=true;scan.dataset.loading='true';const current=++attempt;
      try{native=await nativeQr();try{await loadDecoder()}catch(error){if(!native)throw error}if(current!==attempt)return;if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera is unavailable in this browser. Choose a QR photo or use a code instead.');
        const camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
        if(current!==attempt){camera.getTracks().forEach(track=>track.stop());return}stream=camera;
        const track=camera.getVideoTracks()[0];try{if(track.getCapabilities?.().focusMode?.includes('continuous'))await track.applyConstraints({advanced:[{focusMode:'continuous'}]})}catch{}
        video.srcObject=camera;await video.play();if(current!==attempt)return;scanning=true;setStatus('Searching for the laptop QR… hold it inside the frame.','scanning');frame=requestAnimationFrame(tick);
      }catch(error){if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;setStatus(error.name==='NotAllowedError'?'Camera permission was not granted. Choose a QR photo or use a code.':error.message,'error')}finally{scan.disabled=false;delete scan.dataset.loading}
    });
    file.addEventListener('change',async()=>{
      const photo=file.files?.[0];if(!photo)return;if(photo.size>10000000){status.textContent='Choose an image smaller than 10 MB.';return}
      file.disabled=true;setStatus('Reading QR photo…','loading');let bitmap;const current=attempt;
      try{await loadDecoder();if(current!==attempt)return;bitmap=await createImageBitmap(photo,{resizeWidth:1280});const value=await read(bitmap,bitmap.width,bitmap.height);if(current!==attempt)return;if(!value)throw Error('No readable QR found. Try a clearer photo or use a code.');await deliver(value)}catch(error){setStatus(error.message,'error')}finally{bitmap?.close();file.value='';file.disabled=false}
    });
    close.addEventListener('click',stop);dialog.addEventListener('cancel',stop);dialog.addEventListener('close',()=>{if(stream)stop()});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
    manual.addEventListener('click',onManual);reset.addEventListener('click',onReset);
    function state(step,message,error=false){
      progress.textContent=message;progress.dataset.error=String(error);reset.hidden=false;
      [...steps.children].forEach((item,index)=>{item.dataset.state=index<step?'done':index===step?'current':'pending';if(index===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current')});
    }
    return {state,stop,setEnabled(enabled){scan.disabled=manual.disabled=!enabled}};
  }
  globalThis.SarasPairingUI={parseQr,mount,nativeQr};
})();
