(() => {
  'use strict';
  const key='saras-v2-theme', root=document.documentElement;
  let mode='light';try{mode=localStorage.getItem(key)||'light';}catch{}
  if(!['light','dark'].includes(mode))mode='light';
  function apply(){
    const dark=mode==='dark';
    root.dataset.v2Theme=dark?'dark':'light';root.dataset.v2Mode=mode;
    root.dataset.theme=dark?'dark':'light';root.dataset.themeChoice=mode;
    root.style.setProperty('--v2-auto-bg',dark?'#101e19':'#f8f9f5');
    root.style.setProperty('--v2-auto-sage',dark?'#20392b':'#eaf1e7');
    root.style.setProperty('--v2-auto-accent',dark?'#d6e9dd':'#073d32');
    root.style.colorScheme=dark?'dark':'light';
    document.querySelectorAll('[data-v2-theme-select]').forEach(el=>el.value=mode);
    document.querySelectorAll('[data-v2-theme-caption]').forEach(el=>el.textContent=dark?'Dark appearance':'Light appearance');
  }
  function mount(){
    if(document.querySelector('.v2-appearance'))return;
    const wrapper=document.createElement('label');wrapper.className='v2-appearance';
    const caption=document.createElement('span');caption.textContent='Appearance';
    const select=document.createElement('select');select.setAttribute('aria-label','Appearance mode');select.dataset.v2ThemeSelect='';
    for(const [value,title] of [['light','Light'],['dark','Dark']]){const opt=document.createElement('option');opt.value=value;opt.textContent=title;select.append(opt);}
    const hint=document.createElement('small');hint.dataset.v2ThemeCaption='';
    select.addEventListener('change',()=>{mode=select.value;try{localStorage.setItem(key,mode)}catch{}apply()});
    wrapper.append(caption,select,hint);
    const sidebar=document.querySelector('.v2-sidebar'),existing=document.getElementById('theme-choice');
    if(existing){existing.dataset.v2ThemeSelect='';existing.addEventListener('change',()=>{mode=existing.value;try{localStorage.setItem(key,mode)}catch{}apply()})}
    else (sidebar||document.body).append(wrapper);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    document.querySelectorAll('.v2-device-stage,.v2-card,.v2-trust').forEach(el=>{
      el.addEventListener('pointermove',event=>{
        if(reduced.matches||event.pointerType==='touch')return;
        const r=el.getBoundingClientRect(),x=(event.clientX-r.left)/r.width-.5,y=(event.clientY-r.top)/r.height-.5;
        el.style.setProperty('--v2-tilt-x',(-y*4)+'deg');el.style.setProperty('--v2-tilt-y',(x*5)+'deg');
      });
      el.addEventListener('pointerleave',()=>{el.style.setProperty('--v2-tilt-x','0deg');el.style.setProperty('--v2-tilt-y','0deg')});
    });
    apply();
  }
  apply();document.readyState==='loading'?document.addEventListener('DOMContentLoaded',mount):mount();
})();
