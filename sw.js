const BUILD = 'criativamc-7265b643e43c6517';
const PREFIX = 'criativamc-';
const SHELL = ['index.html','login.html','dashboard.html','obras.html','obras-detalhe.html','caixa.html','agenda.html',
'css/style.css','js/bootstrap.js','js/app.js','js/servicos.js','js/acesso.js','js/administracao.js','js/config.js','js/ui.js','js/dinheiro.js','js/recuperacao.js',
'js/vendor/supabase.js','js/vendor/chart.js','js/agenda-efeitos.js','js/pwa.js','manifest.json','images/web-app-manifest-192x192.png','images/web-app-manifest-512x512.png'];
const ALLOWED = new Set(SHELL.map(p => new URL(p,self.registration.scope).href));
self.addEventListener('install',e=>{
 e.waitUntil(caches.open(BUILD).then(c=>c.addAll(SHELL.map(p=>new URL(p,self.registration.scope).href))));
});
self.addEventListener('message',e=>{if(e.data==='ACTIVATE_BUILD')self.skipWaiting();});
self.addEventListener('activate',e=>{
 e.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==BUILD)await caches.delete(key);
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);
 if(url.origin!==self.location.origin || !ALLOWED.has(url.origin+url.pathname))return;
 e.respondWith(caches.open(BUILD).then(async c=>(await c.match(url.origin+url.pathname))||fetch(e.request)));
});
