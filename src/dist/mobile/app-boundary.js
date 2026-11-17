/* Navigation hints suppress only redundant locking; server PIN checks remain authority. */
(() => {
 const key='saras-internal-navigation';let arrival=false,leaving=false;
 try{const hint=JSON.parse(sessionStorage.getItem(key)||'null');sessionStorage.removeItem(key);arrival=!!hint&&hint.path.replace(/\/$/,'')===location.pathname.replace(/\/$/,'')&&Date.now()-hint.at>=0&&Date.now()-hint.at<10000}catch{}
 function mark(value){const url=new URL(value,location.href);if(url.origin!==location.origin||!/^\/(?:mobile\/|account\/)/.test(url.pathname))return false;leaving=true;try{sessionStorage.setItem(key,JSON.stringify({path:url.pathname,at:Date.now()}))}catch{}return true}
 document.addEventListener('click',event=>{const link=event.target.closest?.('a[href]');if(link&&!event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&(!link.target||link.target==='_self'))mark(link.href)},true);
 globalThis.navigation?.addEventListener('navigate',event=>{mark(event.destination.url)});
 window.addEventListener('pageshow',()=>{leaving=false});
 globalThis.SarasAppBoundary={get internalArrival(){return arrival},get internalNavigation(){return leaving},go(url){mark(url);location.assign(url)}};
})();
