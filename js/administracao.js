import {elemento} from './ui.js';
// Server authorizes every action. An absent section is never a security check.
export async function iniciarAdministracao(servicos,usuarioAtual) {
 let result;try{result=await servicos.administrar('listar');}catch{return;}
 const section=elemento('section');section.dataset.private='';
 section.append(elemento('h2','Operadores'));
 const status=elemento('p');status.setAttribute('role','status');
 const code=elemento('p');code.setAttribute('role','status');
 const clear=()=>{code.textContent='';};
 document.addEventListener('visibilitychange',clear);servicos.aoSair(()=>{clear();section.remove();});
 const list=elemento('div');section.append(list,status,code);
 const refresh=async()=>{
  result=await servicos.administrar('listar');list.replaceChildren();
  for(const usuario of ['ildebrando','edson','ivan']) {
   const o=result.operadores.find(o=>o.usuario===usuario);
   const row=elemento('div');row.append(elemento('p',usuario+': '+(!o?'Não cadastrado':o.bloqueado?'Bloqueado':o.credencial_pronta?'Ativo':'Aguardando primeiro acesso')));
   const button=(label,fn)=>{const b=elemento('button',label);b.type='button';b.onclick=async()=>{
    clear();b.disabled=true;try{await fn();await refresh();}catch{status.textContent='Não foi possível concluir. Atualize e confira o estado antes de repetir.';}finally{b.disabled=false;}
   };row.append(b);};
   if(!o)button('Cadastrar',()=>servicos.administrar('cadastrar',{usuario}));
   else {
    if(o.usuario_id!==usuarioAtual)button(o.bloqueado?'Reativar':'Bloquear',()=>servicos.administrar('gerir',{usuario,acao:o.bloqueado?'reativar':'bloquear',operacao:crypto.randomUUID()}));
    if(!o.bloqueado)button('Gerar código individual',async()=>{
     const r=await servicos.administrar('codigo',{usuario});code.textContent='Entregue em privado (15 minutos; código exibido somente agora): '+r.codigo;
     setTimeout(clear,60000);
    });
   }
   list.append(row);
  }
 };
 (document.querySelector('main')||document.body).append(section);
 await refresh();
}
