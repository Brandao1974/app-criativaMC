import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, migration, command, state, as, A, B, C } from './harness.mjs';
let db, obra, entrada, custo, pedido;
before(async()=> { db=await fixture(); });
after(async()=> { await db?.close(); });
const criar = (uid=A, op=randomUUID(), cliente='Fixture') => command(db,uid,'criar_obra', {cliente,valor_centavos:'100000'},op);
const lancar = (tipo,valor,uid=A) => command(db,uid,'registrar_movimento', {
  obra_id:obra,tipo,descricao:'Fixture',valor_centavos:String(valor)},randomUUID());
const solicitar = (id,uid=A) => command(db,uid,'solicitar_exclusao',{movimento_id:id,motivo:'Duplicado'},randomUUID());
const decidir = (id,decisao='aprovada',uid=B,op=randomUUID()) => command(db,uid,'decidir_exclusao',{
  solicitacao_id:id,decisao,motivo:'Conferido'},op);

test('migração reaplicável e checksum divergente bloqueado',async()=> {
  const sql=await migration();
  await db.exec(sql);
  await assert.rejects(db.exec(sql.replace('-- Included in the versioned migration.', '-- Changed.')), /checksum/i);
  await db.exec('rollback');
});
test('sem sessão, anônimo e terceiro são bloqueados; metadata não autoriza',async()=> {
  for (const uid of [null,C]) {
    await assert.rejects(state(db,uid), /autorizado/);
    await assert.rejects(criar(uid), /autorizado/);
  }
  await assert.rejects(as(db,null,()=>db.query('select public.ler_estado()'),'anon'), /permission denied/);
  await as(db,C,async()=> {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({user_metadata:{lugar:'gustavo'}})]);
    assert.equal((await db.query('select * from public.obras')).rows.length,0);
  });
});
test('criação idempotente e base compartilhada',async()=> {
  const op=randomUUID();
  const a=await criar(A,op); obra=a.id;
  assert.deepEqual(await criar(A,op),a);
  await assert.rejects(criar(A,op,'Outro'),/idempotente/);
  assert.equal((await state(db,B)).obras[0].id,obra);
  assert.equal((await state(db)).eventos.length,1);
  assert.equal((await state(db)).obras[0].criado_por,A);
});
test('entrada/despesa e saldo exato; valor inválido e campos forjados recusados',async()=> {
  entrada=(await lancar('entrada',100000)).id;
  custo=(await lancar('custo',30000,B)).id;
  assert.equal((await state(db)).saldo_centavos,'70000');
  for (const valor of ['0','-1','1.5','NaN','1000000000000']) await assert.rejects(lancar('entrada',valor));
  await assert.rejects(command(db,A,'registrar_movimento',{
    obra_id:obra,tipo:'entrada',descricao:'Forjado',valor_centavos:'1',autor_id:B}),/Campo não permitido/);
  assert.equal((await state(db)).saldo_centavos,'70000');
});
test('pedido não afeta saldo, pendência única e autoaprovação/rejeição bloqueadas',async()=> {
  pedido=(await solicitar(custo)).id;
  assert.equal((await state(db)).saldo_centavos,'70000');
  await assert.rejects(solicitar(custo,B),/duplicate key/);
  await assert.rejects(decidir(pedido,'aprovada',A),/outro operador/);
  await assert.rejects(decidir(pedido,'rejeitada',A),/outro operador/);
  assert.equal((await state(db)).decisoes.length,0);
});
test('aprovação atômica, estorno integral e retries sem duplicação',async()=> {
  const op=randomUUID();
  const r=await decidir(pedido,'aprovada',B,op);
  assert.deepEqual(await decidir(pedido,'aprovada',B,op),r);
  await decidir(pedido); // Same semantic decision, new operation id.
  const s=await state(db,B);
  assert.equal(s.saldo_centavos,'100000');
  assert.equal(s.movimentos.length,3);
  const reversao=s.movimentos.find(m=>m.estorna_id===custo);
  assert.equal(reversao.valor_centavos,'30000');
  assert.equal(reversao.tipo,'entrada');
  assert.equal(s.resumos[0].custos_centavos,'0');
  assert.equal(s.resumos[0].entradas_centavos,'100000');
  await assert.rejects(decidir(pedido,'rejeitada'),/já decidida/);
  await assert.rejects(solicitar(custo),/revertido/);
  await assert.rejects(solicitar(reversao.id),/estorno/);
});
test('rejeição inversa, motivo obrigatório e rollback sem efeito parcial',async()=> {
  const p=(await solicitar(entrada,B)).id;
  const n=(await state(db)).movimentos.length;
  await assert.rejects(command(db,A,'decidir_exclusao',{solicitacao_id:p,decisao:'aprovada',motivo:'x'}));
  const falha=await state(db);
  assert.equal(falha.movimentos.length,n);
  assert.equal(falha.solicitacoes.find(s=>s.id===p).estado,'pendente');
  await decidir(p,'rejeitada',A);
  assert.equal((await state(db)).saldo_centavos,'100000');
});
test('atualização CAS, evento de agendamento e retry depois da mudança',async()=> {
  const dados={id:obra,versao:'1',status:'Agendada',data_execucao:'2026-11-20'};
  const op=randomUUID();
  await command(db,A,'atualizar_obra',dados,op);
  await command(db,A,'atualizar_obra',dados,op);
  assert.equal((await state(db)).obras[0].versao,'2');
  assert.equal((await state(db)).eventos.length,2);
  await assert.rejects(command(db,B,'atualizar_obra',dados), /mudou/);
  await assert.rejects(command(db,B,'atualizar_obra',{...dados,versao:null}), /mudou/);
});
test('DML e rotinas administrativas inacessíveis ao cliente',async()=> {
  for (const tabela of ['profiles','app_membros','obras','obra_status_eventos','obra_movimentos','exclusao_solicitacoes','exclusao_decisoes','auditoria_eventos','legado_eventos']) {
    for (const operacao of [`delete from public.${tabela}`,`update public.${tabela} set ${tabela==='profiles'?'nome=nome':tabela==='app_membros'?'ativo=ativo':tabela==='exclusao_decisoes'?'motivo=motivo':tabela==='auditoria_eventos'?'acao=acao':tabela==='legado_eventos'?'ordem=ordem':tabela==='obra_status_eventos'?'status=status':'id=id'}`]) {
      await assert.rejects(as(db,A,()=>db.exec(operacao)),/permission denied/);
    }
  }
  await assert.rejects(as(db,A,()=>db.query('insert into public.profiles(id,nome) values ($1,$2)',[randomUUID(),'Forjado'])),/permission denied/);
  await assert.rejects(as(db,A,()=>db.query('select private.importar_obra($1,$2,$3,$4,$5)',[randomUUID(),'x','a'.repeat(64),'{}','{}'])),/permission denied/);
});
test('triggers defendem inclusive escrita administrativa inconsistente',async()=> {
  // Admin bypasses RLS; immutable triggers still reject edits.
  await assert.rejects(db.query('update public.obra_movimentos set valor_centavos=1 where id=$1',[entrada]),/imutável/);
  await assert.rejects(db.query(`insert into public.obra_movimentos(obra_id,tipo,descricao,valor_centavos,estorna_id,autor_id,operacao_id)
    values($1,'custo','Estorno inválido',1,$2,$3,$4)`,[obra,entrada,B,randomUUID()]),/integral/);
  // A correct numerical reversal without a decision must fail at commit.
  await assert.rejects(as(db,B,()=>db.query(`insert into public.obra_movimentos(obra_id,tipo,descricao,valor_centavos,estorna_id,autor_id,operacao_id)
    values($1,'custo','Sem decisão',100000,$2,$3,$4)`,[obra,entrada,B,randomUUID()]),'postgres'), /Estorno sem decisão/);
});
test('desativação elimina acesso mesmo com claim anterior',async()=> {
  await db.query('update public.app_membros set ativo=false where usuario_id=$1',[B]);
  await assert.rejects(state(db,B),/autorizado/);
  await assert.rejects(criar(B),/autorizado/);
  await db.query('update public.app_membros set ativo=true where usuario_id=$1',[B]);
});
test('RLS em todas as tabelas e nenhum definer público',async()=> {
  const tables=await db.query("select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname in ('public','private') and relkind='r'");
  assert.ok(tables.rows.every(r=>r.relrowsecurity));
  const defs=await db.query("select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and prosecdef");
  assert.equal(defs.rows.length,0);
});
test('vetor financeiro obrigatório, 10 mil centavos e agregado acima de Number seguro',async()=> {
  const outra=(await criar()).id;
  for(const [tipo,valor] of [['entrada','150000'],['entrada','250050'],['custo','80000'],['custo','120075']]) {
    await command(db,A,'registrar_movimento',{obra_id:outra,tipo,descricao:'Vetor',valor_centavos:valor});
  }
  assert.equal((await state(db)).resumos.find(r=>r.obra_id===outra).saldo_centavos,'199975');
  const centavos=(await criar()).id, grande=(await criar()).id;
  await as(db,A,async()=>{
    for(const [id,valor] of [[centavos,1],[grande,999999999999]]) {
      await db.query(`insert into public.obra_movimentos(obra_id,tipo,descricao,valor_centavos,autor_id,operacao_id)
        select $1,'entrada','Carga sintética',$2,$3,gen_random_uuid() from generate_series(1,10000)`,[id,valor,A]);
    }
  },'postgres');
  const r=await as(db,A,async()=> (await db.query("select public.ler_estado()->'resumos' as r")).rows[0].r);
  assert.equal(r.find(r=>r.obra_id===centavos).saldo_centavos,'10000');
  assert.equal(r.find(r=>r.obra_id===grande).saldo_centavos,'9999999999990000');
});
