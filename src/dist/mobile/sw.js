/* Only public shell files. Auth, tokens, pairing requests and account data are never cached. */
const CACHE='saras-v2-mobile-shell-10';
const FILES=['/mobile/app-boundary.js','/mobile/guide.html','/mobile/app-lock.js','/mobile/','/mobile/mobile.css','/mobile/pairing.css','/mobile/mobile.js','/mobile/pairing-ui.js','/mobile/vendor/jsQR-1.4.0.js','/mobile/install.js','/mobile/google.svg','/mobile/facebook.svg','/mobile/github.svg','/runtime-assets/v2-theme.css','/runtime-assets/v2-motion.css','/runtime-assets/v2-theme.js','/runtime-assets/v2-logo.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('saras-v2-mobile-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==location.origin||!FILES.includes(u.pathname))return;event.respondWith(fetch(event.request).catch(()=>caches.match(u.pathname)))});
