// Optional real SDK + GoTrue/PostgREST tests, LOOPBACK ONLY, no account creation.
// Requires an isolated local Supabase stack and three pre-provisioned fixtures.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { createHmac, randomUUID } from 'node:crypto';
import { criarServicos } from '../../js/servicos.js';
const nomes=['LOCAL_SUPABASE_URL','LOCAL_SUPABASE_PUBLIC_KEY','LOCAL_QA_A_EMAIL','LOCAL_QA_A_PASSWORD',
  'LOCAL_QA_B_EMAIL','LOCAL_QA_B_PASSWORD','LOCAL_QA_C_EMAIL','LOCAL_QA_C_PASSWORD'];
const habilitado=nomes.every(n=>process.env[n]);
if(habilitado) {
  const url=new URL(process.env.LOCAL_SUPABASE_URL);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('GoTrue/PostgREST: somente loopback.');
  for(const letra of ['A','B','C'])if(!process.env[`LOCAL_QA_${letra}_EMAIL`].endsWith('.test'))throw new Error('Use somente e-mails de fixtures .test.');
}
const clientes=[];
function client() {
  const c=createClient(process.env.LOCAL_SUPABASE_URL,process.env.LOCAL_SUPABASE_PUBLIC_KEY,
    {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  clientes.push(c);return c;
}
async function entrar(letra) {
  const c=client();const {error}=await c.auth.signInWithPassword({
    email:process.env[`LOCAL_QA_${letra}_EMAIL`],password:process.env[`LOCAL_QA_${letra}_PASSWORD`]});
  assert.equal(error,null);return c;
}
after(async()=>{for(const c of clientes)await c.auth.signOut({scope:'local'});});
const opcoes={skip:!habilitado?'Stack Supabase/Auth local e fixtures não disponíveis':false};
test('GoTrue: senha incorreta não cria sessão',opcoes,async()=>{
  const c=client();const {error}=await c.auth.signInWithPassword({email:process.env.LOCAL_QA_A_EMAIL,password:'senha-sintetica-incorreta'});
  assert.ok(error);assert.equal((await c.auth.getSession()).data.session,null);
});
test('GoTrue/PostgREST: dois logins individuais veem a mesma base',opcoes,async()=>{
  const [a,b]=await Promise.all([entrar('A'),entrar('B')]);
  const criada=await a.rpc('executar',{p_acao:'criar_obra',p_dados:{cliente:'Fixture compartilhada',valor_centavos:'0'},p_operacao:randomUUID()});
  assert.equal(criada.error,null);
  const [sa,sb]=await Promise.all([a.rpc('ler_estado'),b.rpc('ler_estado')]);
  assert.equal(sa.error,null);assert.equal(sb.error,null);
  assert.notEqual(sa.data.usuario_id,sb.data.usuario_id);
  assert.deepEqual(sa.data.obras.map(o=>o.id),sb.data.obras.map(o=>o.id));
  assert.ok(sa.data.obras.some(o=>o.id===criada.data.id));
  assert.deepEqual(sa.data.movimentos.map(o=>o.id),sb.data.movimentos.map(o=>o.id));
});
test('PostgREST: terceiro bloqueado e DML direto recusado com código de privilégio',opcoes,async()=>{
  const [a,c]=await Promise.all([entrar('A'),entrar('C')]);
  assert.equal((await c.rpc('ler_estado')).error?.code,'42501');
  const r=await a.from('obra_movimentos').update({valor_centavos:'1'}).eq('id','00000000-0000-4000-8000-000000000000');
  assert.equal(r.error?.code,'42501');
  assert.equal((await a.schema('private').rpc('identidade_importacao')).error?.code,'PGRST106');
});
test('GoTrue: logout remove sessão local e consulta anônima é recusada',opcoes,async()=>{
  const a=await entrar('A');await a.auth.signOut({scope:'local'});
  assert.equal((await a.auth.getSession()).data.session,null);
  assert.ok((await a.rpc('ler_estado')).error);
});
const estendido={skip:!habilitado||!process.env.LOCAL_AUTH_PG_URL||!process.env.LOCAL_AUTH_JWT_SECRET?'Stack local completa necessária':false};
async function banco() {
  const url=new URL(process.env.LOCAL_AUTH_PG_URL);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('DB Auth somente loopback');
  const c=new pg.Client({connectionString:url.href});await c.connect();return c;
}
function expirado(usuario) {
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({sub:usuario,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)-120})).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',process.env.LOCAL_AUTH_JWT_SECRET).update(h+'.'+p).digest('base64url')}`;
}
test('GoTrue refresh real e autorização revogada mesmo com JWT renovado',estendido,async()=>{
  const a=await entrar('A');const inicial=(await a.auth.getSession()).data.session;
  const servicos=criarServicos(a);let limpezas=0;servicos.aoSair(()=>{limpezas++;});await servicos.sessao();
  assert.equal((await a.auth.refreshSession()).error,null);
  assert.equal((await a.rpc('ler_estado')).error,null);
  assert.equal(limpezas,0);
  const db=await banco();
  try{
    await db.query('update public.app_membros set ativo=false where usuario_id=$1',[inicial.user.id]);
    assert.equal((await a.auth.refreshSession()).error,null);
    assert.equal((await a.rpc('ler_estado')).error?.code,'42501');
    const limite=Date.now()+3000;
    while(!limpezas && Date.now()<limite)await new Promise(r=>setTimeout(r,10));
    assert.ok(limpezas>0,'Serviço deve invalidar dados privados após refresh com vínculo revogado');
  }finally{await db.query('update public.app_membros set ativo=true where usuario_id=$1',[inicial.user.id]);await db.end();}
});
test('PostgREST rejeita JWT expirado; SDK renova com refresh válido e recusa refresh revogado',estendido,async()=>{
  const a=await entrar('A');const s=(await a.auth.getSession()).data.session;
  const vencido=expirado(s.user.id);
  const resposta=await fetch(process.env.LOCAL_SUPABASE_URL+'/rest/v1/rpc/ler_estado',{
    method:'POST',headers:{apikey:process.env.LOCAL_SUPABASE_PUBLIC_KEY,Authorization:'Bearer '+vencido,'Content-Type':'application/json'},body:'{}'});
  assert.equal(resposta.status,401);
  const b=client();assert.equal((await b.auth.setSession({access_token:vencido,refresh_token:s.refresh_token})).error,null);
  assert.equal((await b.rpc('ler_estado')).error,null);
  const novo=(await b.auth.getSession()).data.session;
  await b.auth.signOut({scope:'global'});
  const c=client();assert.ok((await c.auth.setSession({access_token:expirado(novo.user.id),refresh_token:novo.refresh_token})).error);
  assert.equal((await c.auth.getSession()).data.session,null);
});
test('PostgREST concorrente: uma operação financeira por UUID e aprovação apenas pelo outro operador',opcoes,async()=>{
  const [a,b]=await Promise.all([entrar('A'),entrar('B')]);
  const aId=(await a.auth.getSession()).data.session.user.id;
  const bId=(await b.auth.getSession()).data.session.user.id;
  const bound={p_usuario_esperado:bId,p_acao:'criar_obra',p_dados:{cliente:'Não deve existir',valor_centavos:'1'},p_operacao:randomUUID()};
  assert.equal((await a.rpc('executar_com_identidade',bound)).error?.code,'42501');
  assert.equal((await a.rpc('recuperar_operacao',{p_usuario_esperado:bId,p_operacao:bound.p_operacao,p_encerrar:true})).error?.code,'42501');
  assert.equal((await a.rpc('executar_com_identidade',{...bound,p_usuario_esperado:aId,p_dados:{cliente:'Fixture identidade vinculada',valor_centavos:'1'}})).error,null);
  const criar=await a.rpc('executar',{p_acao:'criar_obra',p_dados:{cliente:'Fixture HTTP concorrente',valor_centavos:'10000'},p_operacao:randomUUID()});
  assert.equal(criar.error,null);
  const id=randomUUID(),dados={p_acao:'registrar_movimento',p_dados:{obra_id:criar.data.id,tipo:'entrada',descricao:'Recebimento sintético',valor_centavos:'10000'},p_operacao:id};
  const r=await Promise.all([a.rpc('executar',dados),a.rpc('executar',dados)]);
  assert.equal(r[0].error,null);assert.equal(r[1].error,null);assert.equal(r[0].data.id,r[1].data.id);
  const pedido=await a.rpc('executar',{p_acao:'solicitar_exclusao',p_dados:{movimento_id:r[0].data.id,motivo:'Duplicado fixture'},p_operacao:randomUUID()});
  assert.equal(pedido.error,null);
  const decisao={p_acao:'decidir_exclusao',p_dados:{solicitacao_id:pedido.data.id,decisao:'aprovada',motivo:'Conferido fixture'},p_operacao:randomUUID()};
  assert.equal((await a.rpc('executar',decisao)).error?.code,'42501');
  assert.equal((await b.rpc('executar',decisao)).error,null);
  const s=await b.rpc('ler_estado');assert.equal(s.error,null);
  assert.equal(s.data.movimentos.filter(m=>m.estorna_id===r[0].data.id).length,1);
  assert.equal(s.data.resumos.find(o=>o.obra_id===criar.data.id).saldo_centavos,'0');
});
