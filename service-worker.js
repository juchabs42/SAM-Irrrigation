
const CACHE="sam-irrigation-pluie-racinaire-v1";
const ASSETS=[
  "./","./index.html","./css/style.css","./js/app.js","./manifest.webmanifest",
  "./assets/logo-sudexpe.jpg","./assets/icon-192.png","./assets/icon-512.png",
  "./assets/icon-maskable-512.png","./assets/apple-touch-icon.png"
];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{
  if(e.request.url.includes("api.open-meteo.com")){e.respondWith(fetch(e.request,{cache:"no-store"}));return}
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request)));
});
