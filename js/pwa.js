// Development never registers the published worker.
if ('serviceWorker' in navigator && location.protocol === 'https:' &&
    !['localhost','127.0.0.1'].includes(location.hostname)) {
 window.addEventListener('load',async()=>{
  try {
   const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
   function oferecer(){
    if(!registration.waiting || document.getElementById('atualizar-app'))return;
    const b=document.createElement('button');b.id='atualizar-app';b.textContent='Nova versão disponível — atualizar';
    b.addEventListener('click',()=>{
     if(document.body.dataset.ocupado==='true')return;
     if(window.confirm('Conclua as operações em todas as abas antes de atualizar. Atualizar agora?'))registration.waiting.postMessage('ACTIVATE_BUILD');
    });document.body.append(b);
   }
   oferecer();
   registration.addEventListener('updatefound',()=>{registration.installing?.addEventListener('statechange',oferecer);});
   navigator.serviceWorker.addEventListener('controllerchange',()=>{
    const tentar=()=>{if(document.body.dataset.ocupado==='true'){setTimeout(tentar,500);return;}location.reload();};tentar();
   });
  }catch{const aviso=document.getElementById('app-mensagem');if(aviso)aviso.textContent='Não foi possível preparar a versão offline. Confira a conexão.';}
 });
}
