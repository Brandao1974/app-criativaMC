import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, state, command, as, A, B } from './harness.mjs';
import { criarRecuperacao } from '../js/recuperacao.js';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { bootstrap } from './harness.mjs';
let db;
before(async()=>{db=await fixture();});
after(async()=>{await db?.close();});
const sqlrpc=(uid,nome,id)=>as(db,uid,async()=> (await db.query(`select public.${nome}($1) as r`,[id])).rows[0].r);
test('correção: único sucessor; uma nova correção exige aprovar estorno do sucessor',async()=>{
  const obra=(await command(db,A,'criar_obra',{cliente:'Cadeia',valor_centavos:'10000'})).id;
  const lancar=(valor,corrige_id)=>command(db,A,'registrar_movimento',{
    obra_id:obra,tipo:'custo',descricao:'Correção',valor_centavos:valor,...(corrige_id?{corrige_id}:{})});
  const original=(await lancar('10000')).id;
  await assert.rejects(lancar('20000',original),/original revertido/);
  async function reverter(id) {
    const p=(await command(db,A,'solicitar_exclusao',{movimento_id:id,motivo:'Valor incorreto'})).id;
    await command(db,B,'decidir_exclusao',{solicitacao_id:p,decisao:'aprovada',motivo:'Conferido'});
  }
  await reverter(original);
  await assert.rejects(command(db,A,'registrar_movimento',{obra_id:obra,tipo:'entrada',descricao:'Natureza diferente',valor_centavos:'20000',corrige_id:original}),/Correção exige/);
  const primeiro=(await lancar('20000',original)).id;
  await assert.rejects(lancar('30000',original),/duplicate key/);
  await assert.rejects(lancar('15000',primeiro),/original revertido/);
  await reverter(primeiro);
  await lancar('15000',primeiro);
  assert.equal((await state(db)).resumos.find(r=>r.obra_id===obra).saldo_centavos,'-15000');
});

function ambiente(uid,exec) {
  const memoria=new Map();let fila=Promise.resolve();
  const storage={getItem:k=>memoria.get(k)??null,setItem:(k,v)=>memoria.set(k,v),removeItem:k=>memoria.delete(k)};
  const locks={request(_key,fn){const proxima=fila.then(fn);fila=proxima.catch(()=>{});return proxima;}};
  const servicos={executar:exec,consultar:id=>sqlrpc(uid,'consultar_operacao',id),encerrar:id=>sqlrpc(uid,'encerrar_operacao',id)};
  return {memoria,storage,locks,servicos,nova:()=>criarRecuperacao(servicos,storage,locks)};
}
test('rede incerta após COMMIT: reload recupera ID, não repete e não persiste payload',async()=>{
  let chamadas=0;
  const a=ambiente(A,async(acao,dados,id)=>{chamadas++;await command(db,A,acao,dados,id);throw new Error('Resposta perdida');});
  const dados={cliente:'Cliente confidencial fixture',valor_centavos:'987654'};
  await assert.rejects(a.nova().executar(A,'criar_obra',dados),/Resposta perdida/);
  const persistido=[...a.memoria.values()][0];
  assert.deepEqual(Object.keys(JSON.parse(persistido)).sort(),['acao','id','versao']);
  assert.ok(!persistido.includes('987654')&&!persistido.includes('confidencial'));
  const nova=a.nova();const recuperado=await nova.recuperar(A);assert.equal(recuperado.estado,'concluida');
  const r=await nova.executar(A,'criar_obra',dados);assert.equal(r.recuperada,true);assert.equal(chamadas,1);
  await nova.confirmar(A,r.id);assert.equal(a.memoria.size,0);
});
test('rede perdida antes do envio: reload reutiliza UUID; outra ação é bloqueada',async()=>{
  const ids=[];let falhar=true;
  const a=ambiente(A,async(acao,dados,id)=>{ids.push(id);if(falhar)throw new Error('Sem rede');return command(db,A,acao,dados,id);});
  const dados={cliente:'Retry',valor_centavos:'1'};
  await assert.rejects(a.nova().executar(A,'criar_obra',dados));
  assert.equal((await a.nova().recuperar(A)).estado,'ausente');
  await assert.rejects(a.nova().executar(A,'registrar_movimento',{}),/tentativa anterior/);
  falhar=false;await a.nova().executar(A,'criar_obra',dados);assert.equal(ids[0],ids[1]);
});
test('encerramento grava tombstone e impede requisição atrasada',async()=>{
  const a=ambiente(B,async()=>{throw new Error('Sem rede');});
  await assert.rejects(a.nova().executar(B,'criar_obra',{cliente:'Tardia',valor_centavos:'1'}));
  const p=JSON.parse([...a.memoria.values()][0]);
  assert.equal((await a.nova().encerrar(B)).estado,'cancelada');
  await assert.rejects(command(db,B,'criar_obra',{cliente:'Tardia',valor_centavos:'1'},p.id),/idempotente/);
  assert.equal((await sqlrpc(A,'consultar_operacao',p.id)).estado,'ausente');
});
test('duas abas usam o mesmo registro e falha do armazenamento impede envio',async()=>{
  let chamadas=0;
  const a=ambiente(B,async(...args)=>{chamadas++;return command(db,B,...args);});
  const r=await Promise.all([a.nova().executar(B,'criar_obra',{cliente:'Duas abas',valor_centavos:'1'}),a.nova().executar(B,'criar_obra',{cliente:'Duas abas',valor_centavos:'1'})]);
  assert.equal(r[0].id,r[1].id);assert.equal(chamadas,1);
  a.storage.getItem=()=>null;a.storage.setItem=()=>{throw new Error('Storage bloqueado');};
  await assert.rejects(a.nova().executar(B,'criar_obra',{cliente:'Não enviar',valor_centavos:'1'}),/Storage bloqueado/);
  assert.equal(chamadas,1);
});
test('regressão v1: múltiplas correções eram possíveis; upgrade recusa duplicatas sem apagar dados',async()=>{
  const antigo=new PGlite();
  try{
    await antigo.exec(bootstrap);
    const dir=new URL('../supabase/migrations/',import.meta.url);
    const files=await readdir(dir);
    await antigo.exec(await readFile(new URL(files.find(f=>f.endsWith('_collaborative_ledger.sql')),dir),'utf8'));
    await antigo.exec(`insert into auth.users values('${A}'),('${B}');
      insert into public.profiles(id,nome) values('${A}','Gustavo'),('${B}','Ivan');
      insert into public.app_membros(usuario_id,lugar) values('${A}','gustavo'),('${B}','ivan');`);
    const obra=(await command(antigo,A,'criar_obra',{cliente:'Regressão',valor_centavos:'10000'})).id;
    const base={obra_id:obra,tipo:'custo',descricao:'Fixture',valor_centavos:'10000'};
    const original=(await command(antigo,A,'registrar_movimento',base)).id;
    const p=(await command(antigo,A,'solicitar_exclusao',{movimento_id:original,motivo:'Corrigir fixture'})).id;
    await command(antigo,B,'decidir_exclusao',{solicitacao_id:p,decisao:'aprovada',motivo:'Conferido'});
    await command(antigo,A,'registrar_movimento',{...base,corrige_id:original});
    await command(antigo,B,'registrar_movimento',{...base,corrige_id:original});
    assert.equal((await state(antigo)).movimentos.filter(m=>m.corrige_id===original).length,2);
    await assert.rejects(antigo.exec(await readFile(new URL(files.find(f=>f.endsWith('_corrective_review.sql')),dir),'utf8')),/unique index/);
    await antigo.exec('rollback');
    assert.equal((await state(antigo)).movimentos.filter(m=>m.corrige_id===original).length,2);
  }finally{await antigo.close();}
});
