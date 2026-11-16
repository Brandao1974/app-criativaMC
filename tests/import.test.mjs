import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { planejarImportacao } from '../js/importacao.js';
import { textoParaCentavos, formatarBRL, valorGrafico } from '../js/dinheiro.js';
import { fixture, A, B, state } from './harness.mjs';
let db;
before(async()=>{db=await fixture();});
after(async()=>{await db?.close();});
function snapshot(obras,caixa='700') { return {formato:'app-criativaMC-localstorage-bruto-v1',valoresBrutos:{obras:JSON.stringify(obras),caixa}}; }
const bruto={id:1,cliente:'Fixture',status:'Negociação',valor:1000,usuarioCriador:'Ivan',
  historico:[{status:'Negociação',usuario:'Ivan',data:'15/11/2026'}],
  entradas:[{id:2,descricao:'Recebido',valor:1000,usuario:'Ivan',data:'15/11/2026'}],
  custos:[{id:3,descricao:'Material',tipo:'Material',valor:300,usuario:'Gustavo',deleteRequest:{gustavo:true,ivan:false}}]};
async function importar(item,hash='a'.repeat(64),ator=A) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ator]);
    const r=await db.query('select private.importar_obra($1,$2,$3,$4,$5) as id',[
      item.origem_id,item.chave,hash,JSON.stringify(item.convertido),JSON.stringify(item.bruto)]);
    await db.exec('commit');return r.rows[0].id;
  }catch(e){await db.exec('rollback');throw e;}
}
test('moeda: parser estrito e totais além de Number sem arredondamento',()=>{
  assert.equal(textoParaCentavos('R$ 1.234,56'),'123456');
  assert.equal(textoParaCentavos('0.01'),'1');
  assert.equal(textoParaCentavos(1.23,{legado:true}),'123');
  for(const s of ['1.234','0.005','1e3','-1','','abc','NaN','Infinity'])assert.throws(()=>textoParaCentavos(s));
  assert.equal(formatarBRL('9007199254740993'),'R$ 90.071.992.547.409,93');
  assert.equal(formatarBRL('-1'),'-R$ 0,01');
  assert.throws(()=>valorGrafico('9007199254740993'));
});
test('dry-run preserva original, categoria, assinaturas e saldo sem inventar ajuste',()=>{
  const s=snapshot([bruto],'650'),original=JSON.stringify(s);
  const p=planejarImportacao(s,randomUUID());
  assert.equal(JSON.stringify(s),original);
  assert.equal(p.totais.saldo_centavos,'70000');
  assert.equal(p.totais.divergencia_centavos,'-5000');
  assert.equal(p.validas[0].convertido.movimentos[1].categoria,'Material');
  assert.equal(p.validas[0].convertido.movimentos[1].bruto.deleteRequest.gustavo,true);
  assert.equal(p.avisos.length,1);
});
test('quarentena por obra, sem importar parcialmente filhos inválidos',()=>{
  const p=planejarImportacao(snapshot([bruto,{...bruto,entradas:[{descricao:'Ruim',valor:'1.234'}]}]),randomUUID());
  assert.equal(p.validas.length,1);assert.equal(p.quarentena.length,1);
  assert.equal(p.totais.saldo_centavos,'70000');
  for(const mudanca of [{status:'Desconhecido'},{dataExecucao:'2026-02-30'},{historico:'inválido'},{cliente:''}]) {
    assert.equal(planejarImportacao(snapshot([{...bruto,...mudanca}]),randomUUID()).quarentena.length,1);
  }
  assert.throws(()=>planejarImportacao({formato:'app-criativaMC-localstorage-bruto-v1',valoresBrutos:{obras:'{quebrado'}},randomUUID()));
});
test('SQL: repetir fonte por outro operador não duplica; autoria legada separada',async()=>{
  const plano=planejarImportacao(snapshot([bruto]),randomUUID());
  const item=plano.validas[0];
  const id=await importar(item);
  assert.equal(await importar(item,'a'.repeat(64),B),id);
  assert.equal(await importar(item),id);
  const s=await state(db);
  assert.equal(s.obras.length,1);assert.equal(s.movimentos.length,2);
  assert.equal(s.eventos.length,0);assert.equal(s.legado_eventos.length,1);
  assert.equal(s.obras[0].criado_por,A);assert.equal(s.obras[0].legado.usuarioCriador,'Ivan');
  assert.equal(s.saldo_centavos,'70000');assert.equal(s.solicitacoes.length,0);
  const esperado={obras_validas:1,movimentos:2,eventos:1,entradas_centavos:'100000',custos_centavos:'30000',saldo_centavos:'70000'};
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);
  assert.deepEqual((await db.query('select private.conferir_importacao($1,$2) as r',['a'.repeat(64),esperado])).rows[0].r,esperado);
  await db.exec('commit');
  await assert.rejects(importar({...item,convertido:{...item.convertido,cliente:'Alterado'}}),/conteúdo diferente/);
});
test('SQL: falha em filho faz rollback da obra e manifesto; retomada limpa',async()=>{
  const item=planejarImportacao(snapshot([bruto]),randomUUID()).validas[0];
  const invalido={...item,convertido:{...item.convertido,movimentos:[...item.convertido.movimentos,{tipo:'custo',descricao:'Falha',valor_centavos:'0'}]}};
  await assert.rejects(importar(invalido,'b'.repeat(64)));
  assert.equal((await state(db)).obras.length,1);
  await importar(item,'b'.repeat(64));
  assert.equal((await state(db)).obras.length,2);
  assert.equal((await state(db)).saldo_centavos,'140000');
});
