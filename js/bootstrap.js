import { configuracao } from './config.js';
import { criarServicos } from './servicos.js';
import { iniciar } from './app.js';
import { criarGateway } from './acesso.js';
const aviso=document.getElementById('app-mensagem');
if (!configuracao.url || !configuracao.publishableKey || !configuracao.accessUrl) {
  aviso.textContent='Integração local preparada. A configuração pública do Supabase ainda não foi definida.';
  document.querySelectorAll('button,input').forEach(el=>{el.disabled=true;});
} else {
  try {
    const alvo=new URL(configuracao.url);
    const local=['127.0.0.1','localhost','[::1]'].includes(alvo.hostname);
    if(alvo.protocol!=='https:' && !(local && alvo.protocol==='http:'))throw new Error('URL inválida');
    if(!configuracao.publishableKey.startsWith('sb_publishable_') && !configuracao.publishableKey.startsWith('eyJ'))throw new Error('Chave inválida');
    if(configuracao.publishableKey.startsWith('eyJ')) {
      const claims=JSON.parse(atob(configuracao.publishableKey.split('.')[1].replaceAll('-','+').replaceAll('_','/')));
      if(claims.role!=='anon')throw new Error('Somente chave pública é permitida');
    }
    const { createClient }=await import('./vendor/supabase.js');
    const client=createClient(configuracao.url,configuracao.publishableKey,{
      auth:{storageKey:'criativamc.auth.v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
    const controle=await iniciar(criarServicos(client,criarGateway(client,configuracao.accessUrl)));
    if(controle && document.body.dataset.pagina==='agenda') {
      const { iniciarConfetesAgenda }=await import('./agenda-efeitos.js');
      iniciarConfetesAgenda();
    }
  } catch { aviso.textContent='Não foi possível iniciar a integração. Verifique a configuração pública e a conexão.'; }
}
