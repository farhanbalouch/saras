/* Same registered photographic muzzle approach as the Windows renderer. */
(function(){
const sprite=document.querySelector('.hamster-sprite');if(!sprite)return;
const visible=document.createElement('canvas');visible.width=visible.height=64;visible.className='speech-rig';visible.setAttribute('aria-hidden','true');sprite.append(visible);
const image=new Image(),frames=[];image.src='/runtime-assets/hamster-visemes.png';
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function nose(cell){const {data}=cell.getContext('2d').getImageData(0,0,cell.width,cell.height);let sumX=0,sumY=0,n=0,w=cell.width,h=cell.height;
for(let y=Math.floor(h*.3);y<h*.62;y+=2)for(let x=Math.floor(w*.3);x<w*.7;x+=2){const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];if(data[i+3]>150&&r>g*1.14&&b>g*.92&&r>b*1.04){sumX+=x;sumY+=y;n++}}
return n>=4?[sumX/n,sumY/n]:[w*.5,h*.46]}
image.onload=()=>{const w=image.width/3,h=image.height/2,cells=[];for(let i=0;i<6;i++){const c=canvas(w,h);c.getContext('2d').drawImage(image,(i%3)*w,Math.floor(i/3)*h,w,h,0,0,w,h);cells.push(c)}const [x,y]=nose(cells[0]);
for(const cell of cells){const [nx,ny]=nose(cell),patch=canvas(w,h),pc=patch.getContext('2d');pc.drawImage(cell,Math.round(x-nx),Math.round(y-ny));pc.globalCompositeOperation='destination-in';const mask=pc.createRadialGradient(x,y+h*.1,w*.03,x,y+h*.1,w*.13);mask.addColorStop(0,'#fff');mask.addColorStop(.75,'#fff');mask.addColorStop(1,'#fff0');pc.fillStyle=mask;pc.fillRect(0,0,w,h);const frame=canvas(64,64),ctx=frame.getContext('2d');ctx.drawImage(cells[0],0,0,64,64);ctx.drawImage(patch,0,0,64,64);frames.push(frame)}sprite.classList.add('rig-ready')};
let last=-1;function render(){const pose=Math.max(0,Math.min(5,globalThis.SarasVoice?.viseme?.()||0));if(pose!==last&&frames[pose]){visible.getContext('2d').clearRect(0,0,64,64);visible.getContext('2d').drawImage(frames[pose],0,0);last=pose}if(!frames.length)last=-1;requestAnimationFrame(render)}requestAnimationFrame(render);
})();
