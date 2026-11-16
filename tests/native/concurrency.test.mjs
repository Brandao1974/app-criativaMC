// Native Postgres only. Creates and removes ONE randomly named test database
// and two randomly named test roles. Refuses non-loopback connections.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { bootstrap, migration, seed, A, B } from '../harness.mjs';
import { planejarImportacao } from '../../js/importacao.js';
import { aplicarPlano, validarPlano } from '../../scripts/aplicar-importacao-local.mjs';
import { createHash, randomBytes } from 'node:crypto';
const endereco=process.env.LOCAL_PG_URL;
let admin,config,nome,role,anon,importer,apiLogin,ready=false;
const conexoes=new Set();
before(async()=>{
  if(!endereco)return;
  const url=new URL(endereco);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Somente PostgreSQL loopback é permitido.');
  admin=new pg.Client({connectionString:endereco});await admin.connect();
  const sufixo=randomUUID().replaceAll('-','').slice(0,12);
  nome=`codex_criativa_${sufixo}`;role=`codex_auth_${sufixo}`;anon=`codex_anon_${sufixo}`;
  await admin.query(`create database ${nome}`);
  url.pathname='/'+nome;config={connectionString:url.href};
  const c=new pg.Client(config);await c.connect();
  try {
    await c.query(bootstrap.replaceAll('authenticated',role).replaceAll('anon',anon));
    await c.query((await migration()).replaceAll('authenticated',role).replaceAll('anon',anon));
    await seed({exec:sql=>c.query(sql)});ready=true;
  }finally{await c.end();}
});
after(async()=>{
  for(const c of conexoes)await c.end();
  if(admin){
    if(nome)await admin.query(`drop database if exists ${nome}`);
    if(apiLogin)await admin.query(`drop role if exists ${apiLogin}`);
    if(importer)await admin.query(`drop role if exists ${importer}`);
    if(role)await admin.query(`drop role if exists ${role}`);
    if(anon)await admin.query(`drop role if exists ${anon}`);
    await admin.end();
  }
});
async function executar(uid,acao,dados,op=randomUUID()) {
  const c=new pg.Client(config);await c.connect();conexoes.add(c);
  try {
    await c.query('begin');await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
    const r=await c.query('select public.executar($1,$2,$3) as r',[acao,dados,op]);
    await c.query('commit');return r.rows[0].r;
  }catch(e){await c.query('rollback');throw e;}
  finally{conexoes.delete(c);await c.end();}
}
async function ler() {
  const c=new pg.Client(config);await c.connect();
  try{await c.query(`set role ${role}`);await c.query("select set_config('request.jwt.claim.sub',$1,false)",[A]);return (await c.query('select public.ler_estado() as s')).rows[0].s;}
  finally{await c.end();}
}
const opcoes={skip:!endereco?'LOCAL_PG_URL não definido; PostgreSQL nativo indisponível':false};
test('conexões independentes: mesma criação e chave de operação',opcoes,async()=>{
  const op=randomUUID(),dados={cliente:'Concorrência',valor_centavos:'100000'};
  const r=await Promise.all([executar(A,'criar_obra',dados,op),executar(A,'criar_obra',dados,op)]);
  assert.equal(r[0].id,r[1].id);
  assert.equal((await ler()).obras.length,1);
});
test('conexões independentes: pedidos simultâneos e decisões concorrentes',opcoes,async()=>{
  const obra=(await executar(A,'criar_obra',{cliente:'Decisões',valor_centavos:'100000'})).id;
  const mov=(await executar(A,'registrar_movimento',{obra_id:obra,tipo:'entrada',descricao:'Recebimento',valor_centavos:'100000'})).id;
  const pedidos=await Promise.allSettled([A,B].map(uid=>executar(uid,'solicitar_exclusao',{movimento_id:mov,motivo:'Duplicado'})));
  assert.equal(pedidos.filter(r=>r.status==='fulfilled').length,1);
  const s=await ler();const pedido=s.solicitacoes.find(p=>p.movimento_id===mov);
  const decisor=pedido.solicitante_id===A?B:A;
  const decisoes=await Promise.allSettled(['aprovada','rejeitada'].map(decisao=>executar(decisor,'decidir_exclusao',{
    solicitacao_id:pedido.id,decisao,motivo:'Conferido'})));
  assert.equal(decisoes.filter(r=>r.status==='fulfilled').length,1);
  const fim=await ler();const decisao=fim.decisoes.find(d=>d.solicitacao_id===pedido.id);
  assert.equal(fim.movimentos.filter(m=>m.estorna_id===mov).length,decisao.decisao==='aprovada'?1:0);
  assert.equal(fim.resumos.find(r=>r.obra_id===obra).saldo_centavos,decisao.decisao==='aprovada'?'0':'100000');
});
test('conexões independentes: retry simultâneo de aprovação gera único estorno',opcoes,async()=>{
  const obra=(await executar(A,'criar_obra',{cliente:'Retries',valor_centavos:'100000'})).id;
  const mov=(await executar(A,'registrar_movimento',{obra_id:obra,tipo:'custo',descricao:'Custo',valor_centavos:'30000'})).id;
  const pedido=(await executar(A,'solicitar_exclusao',{movimento_id:mov,motivo:'Duplicado'})).id;
  const dados={solicitacao_id:pedido,decisao:'aprovada',motivo:'Conferido'};
  const r=await Promise.all([executar(B,'decidir_exclusao',dados),executar(B,'decidir_exclusao',dados)]);
  assert.equal(r[0].id,r[1].id);
  assert.equal((await ler()).movimentos.filter(m=>m.estorna_id===mov).length,1);
});
test('login administrativo real: mínimo privilégio e autoria pelo session_user',opcoes,async()=>{
  const dba=new pg.Client(config);await dba.connect();
  importer=role.replace('codex_auth_','codex_import_');
  const password=randomBytes(24).toString('base64url');
  await dba.query(`create role ${importer} login noinherit password ${dba.escapeLiteral(password)}`);
  await dba.query(`grant usage on schema private to ${importer};
    grant execute on function private.identidade_importacao(),private.importar_obra(uuid,text,text,jsonb,jsonb),private.conferir_importacao(text,jsonb) to ${importer};
    insert into private.importacao_operadores values('${importer}','${A}',true,now()+interval '1 hour');`);
  const url=new URL(config.connectionString);url.username=importer;url.password=password;
  const c=new pg.Client({connectionString:url.href});await c.connect();
  try{
    const source={formato:'app-criativaMC-localstorage-bruto-v1',valoresBrutos:{obras:JSON.stringify([
      {id:1,cliente:'Importação fixture',status:'Negociacao',valor:100,entradas:[{descricao:'Recebido',valor:100}],custos:[],historico:[]}
    ]),caixa:'100'}};
    const bytes=Buffer.from(JSON.stringify(source));
    const plano={...planejarImportacao(source,randomUUID()),sha256:createHash('sha256').update(bytes).digest('hex')};
    assert.throws(()=>validarPlano(Buffer.from('alterado'),plano),/SHA-256/);
    assert.throws(()=>validarPlano(bytes,{...plano,totais:{}}),/Plano difere/);
    await c.query("select set_config('request.jwt.claim.sub',$1,false)",[B]);
    const r=await aplicarPlano(c,bytes,plano);
    assert.equal(r.identidade.login,importer);assert.equal(r.identidade.ator_id,A);
    await aplicarPlano(c,bytes,plano);
    for(const sql of ['select * from public.obras','delete from public.obras','select * from private.importacao_operadores'])await assert.rejects(c.query(sql),/permission denied/);
    const s=await ler();const o=s.obras.find(o=>o.cliente==='Importação fixture');
    assert.equal(o.criado_por,A);assert.equal(s.movimentos.filter(m=>m.obra_id===o.id).length,1);
    const conflitoSource=structuredClone(source);
    const item=JSON.parse(source.valoresBrutos.obras)[0];
    conflitoSource.valoresBrutos.obras=JSON.stringify([{...item,id:2,cliente:'Rollback do lote'}, {...item,cliente:'Origem alterada'}]);
    const conflitBytes=Buffer.from(JSON.stringify(conflitoSource));
    const conflitPlano={...planejarImportacao(conflitoSource,plano.origem_id),sha256:createHash('sha256').update(conflitBytes).digest('hex')};
    await assert.rejects(aplicarPlano(c,conflitBytes,conflitPlano),/conteúdo diferente/);
    assert.equal((await ler()).obras.filter(o=>o.cliente==='Rollback do lote').length,0);
    await dba.query(`update private.importacao_operadores set valido_ate=now()-interval '1 second' where login_name='${importer}'`);
    await assert.rejects(aplicarPlano(c,bytes,plano),/administrativo.*não autorizado/);
  }finally{await c.end();await dba.end();}
});
test('API não pode simular login importador nem com claim de operador válido',opcoes,async()=>{
  const dba=new pg.Client(config);await dba.connect();
  apiLogin=role.replace('codex_auth_','codex_api_');const password=randomBytes(24).toString('base64url');
  await dba.query(`create role ${apiLogin} login noinherit password ${dba.escapeLiteral(password)};
    grant ${role} to ${apiLogin}; grant execute on function private.identidade_importacao() to ${role};`);
  const url=new URL(config.connectionString);url.username=apiLogin;url.password=password;
  const c=new pg.Client({connectionString:url.href});await c.connect();
  try{
    await c.query(`set role ${role}`);await c.query("select set_config('request.jwt.claim.sub',$1,false)",[A]);
    await assert.rejects(c.query('select private.identidade_importacao()'),/administrativo.*não autorizado/);
  }finally{await c.end();await dba.query(`revoke execute on function private.identidade_importacao() from ${role}`);await dba.end();}
});
test('correções concorrentes: só um sucessor do original revertido',opcoes,async()=>{
  const obra=(await executar(A,'criar_obra',{cliente:'Correção concorrente',valor_centavos:'10000'})).id;
  const mov=(await executar(A,'registrar_movimento',{obra_id:obra,tipo:'custo',descricao:'Original',valor_centavos:'10000'})).id;
  const pedido=(await executar(A,'solicitar_exclusao',{movimento_id:mov,motivo:'Correção'})).id;
  await executar(B,'decidir_exclusao',{solicitacao_id:pedido,decisao:'aprovada',motivo:'Conferido'});
  const r=await Promise.allSettled([A,B].map(uid=>executar(uid,'registrar_movimento',{
    obra_id:obra,tipo:'custo',descricao:'Substituto',valor_centavos:'20000',corrige_id:mov})));
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await ler()).movimentos.filter(m=>m.corrige_id===mov).length,1);
});
test('encerramento x envio concorrente: um efeito ou tombstone, nunca duplicação',opcoes,async()=>{
  const id=randomUUID();const c=new pg.Client(config);await c.connect();
  try{
    await c.query(`set role ${role}`);await c.query("select set_config('request.jwt.claim.sub',$1,false)",[A]);
    await Promise.allSettled([executar(A,'criar_obra',{cliente:'Envio atrasado',valor_centavos:'1'},id),c.query('select public.encerrar_operacao($1)',[id])]);
    const consulta=(await c.query('select public.consultar_operacao($1) as r',[id])).rows[0].r;
    const qtd=(await ler()).obras.filter(o=>o.cliente==='Envio atrasado').length;
    assert.equal(qtd,consulta.estado==='cancelada'?0:1);
  }finally{await c.end();}
});
test('janela de importação bloqueia escrita concorrente até o fim da transação',opcoes,async()=>{
  const janela=new pg.Client(config);await janela.connect();let liberada=false,escrita;
  try{
    await janela.query('begin');await janela.query('select pg_advisory_xact_lock(194762914)');
    escrita=executar(A,'criar_obra',{cliente:'Após janela',valor_centavos:'1'});
    let esperando=false;const limite=Date.now()+5000;
    while(!esperando && Date.now()<limite){
      esperando=(await admin.query("select exists(select 1 from pg_stat_activity where datname=$1 and wait_event='advisory' and query like 'select public.executar%') as espera",[nome])).rows[0].espera;
      if(!esperando)await new Promise(r=>setTimeout(r,20));
    }
    assert.equal(esperando,true,'Escrita precisa aguardar o lock de manutenção');
    await janela.query('commit');liberada=true;await escrita;
    assert.equal((await ler()).obras.filter(o=>o.cliente==='Após janela').length,1);
  }finally{if(!liberada)await janela.query('rollback');await escrita?.catch(()=>{});await janela.end();}
});
