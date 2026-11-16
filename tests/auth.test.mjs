import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServicos } from '../js/servicos.js';
function cliente({sessao={user:{id:'a'}},erroLogin=null,erroRpc=null}={}) {
  const calls=[];let listener;
  return {calls,emit:(...args)=>listener(...args),
    auth:{onAuthStateChange:fn=>{listener=fn;},getSession:async()=>({data:{session:sessao},error:null}),
      setSession:async()=>({error:null}),
      signOut:async()=>{calls.push('sair');listener('SIGNED_OUT',null);return {error:null};}},
    gateway:async(action,b)=>{calls.push({usuario:b.usuario,senha:b.senha});if(erroLogin)throw erroLogin;return {access_token:'fixture',refresh_token:'fixture'};},
    rpc:async nome=>{calls.push(nome);return {data:{usuario_id:'a'},error:erroRpc};}};
}
const services=c=>criarServicos(c,c.gateway);
test('auth: credenciais encaminhadas ao gateway; sessão SDK e membro validados',async()=>{
  const c=cliente();const s=services(c);
  await s.entrar('a@example.test','teste-sintetico');
  assert.deepEqual(c.calls,[{usuario:'a@example.test',senha:'teste-sintetico'},'ler_estado']);
});
test('auth: senha inválida não consulta dados; terceiro autenticado perde sessão local',async()=>{
  const c=cliente({erroLogin:{code:'invalid_credentials'}});
  await assert.rejects(services(c).entrar('x@example.test','errada'));
  assert.equal(c.calls.length,1);
  const terceiro=cliente({erroRpc:{code:'42501'}});
  await assert.rejects(services(terceiro).entrar('x@example.test','teste'));
  assert.equal(terceiro.calls.at(-1),'sair');
});
test('auth: sem sessão não carrega financeiro; logout notifica limpeza',async()=>{
  const c=cliente({sessao:null});const s=criarServicos(c);let limpo=false;s.aoSair(()=>{limpo=true;});
  assert.equal(await s.sessao(),null);assert.deepEqual(c.calls,[]);
  await s.sair();assert.equal(limpo,true);
});
test('auth: troca de usuário invalida resposta iniciada com identidade anterior',async()=>{
  const c=cliente();const s=criarServicos(c);
  await s.sessao();let resolver;
  c.rpc=()=>new Promise(r=>{resolver=r;});
  const pendente=s.ler();
  c.emit('SIGNED_IN',{user:{id:'b'}});
  resolver({data:{usuario_id:'a'},error:null});
  await assert.rejects(pendente,/Sessão mudou/);
});
test('refresh da mesma identidade revalida autorização sem limpar sessão válida',async()=>{
  const c=cliente();const s=criarServicos(c);let limpezas=0;s.aoSair(()=>{limpezas++;});
  await s.sessao();const antes=c.calls.filter(x=>x==='ler_estado').length;
  c.emit('TOKEN_REFRESHED',{user:{id:'a'}});
  await new Promise(r=>setTimeout(r,15));
  assert.equal(c.calls.filter(x=>x==='ler_estado').length,antes+1);assert.equal(limpezas,0);
});
test('refresh não mantém acesso de operador desativado; falha de rede não vira logout',async()=>{
  const c=cliente();const s=criarServicos(c);let limpezas=0;s.aoSair(()=>{limpezas++;});
  await s.sessao();c.rpc=async()=>({data:null,error:{code:'42501'}});
  c.emit('TOKEN_REFRESHED',{user:{id:'a'}});await new Promise(r=>setTimeout(r,15));
  assert.equal(limpezas,1);
  const rede=cliente();const sr=criarServicos(rede);let saiu=false;sr.aoSair(()=>{saiu=true;});
  await sr.sessao();rede.rpc=async()=>({data:null,error:{message:'network'}});
  await assert.rejects(sr.ler());assert.equal(saiu,false);
});
test('resposta de escrita após troca de usuário não é tratada como confirmação',async()=>{
  const c=cliente();const s=criarServicos(c);await s.sessao();let resolver;
  c.rpc=()=>new Promise(r=>{resolver=r;});
  const resposta=s.executar('criar_obra',{},'uuid-fixture');
  c.emit('SIGNED_IN',{user:{id:'b'}});resolver({data:{id:'fixture'},error:null});
  await assert.rejects(resposta,/Sessão mudou/);
});
