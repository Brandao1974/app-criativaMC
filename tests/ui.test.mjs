import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { iniciar } from '../js/app.js';
import { fixture, command, state, as, A, B } from './harness.mjs';
let db;
before(async()=>{db=await fixture();});
after(async()=>{await db?.close();});
async function tela(nome,uid=A,id='',persistido={}) {
  const html=await readFile(new URL(`../${nome}.html`,import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:`http://127.0.0.1:4173/${nome}.html${id?'?id='+id:''}`});
  globalThis.document=dom.window.document;
  for(const [k,v] of Object.entries(persistido))dom.window.localStorage.setItem(k,v);
  const destinos=[];let sair;
  globalThis.window={location:{search:id?'?id='+id:'',replace:v=>destinos.push(v)},prompt:()=> 'Conferido',confirm:()=>true,
    localStorage:dom.window.localStorage,navigator:{locks:{request:async(_key,fn)=>fn()}}};
  // jsdom has no native canvas; explicitly exercise graceful chart failure.
  dom.window.HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas indisponível no teste DOM');};
  const ler=async()=>({...await state(db,uid),hoje:'2026-11-15'});
  const servicos={aoSair:fn=>{sair=fn;},sessao:ler,ler,
    consultar:id=>as(db,uid,async()=> (await db.query('select public.consultar_operacao($1) as r',[id])).rows[0].r),
    encerrar:id=>as(db,uid,async()=> (await db.query('select public.encerrar_operacao($1) as r',[id])).rows[0].r),
    executar:(acao,dados,op)=>command(db,uid,acao,dados,op),entrar:async()=>{},sair:async()=>{sair();}};
  const controle=await iniciar(servicos);
  return {dom,servicos,destinos,controle,$:s=>dom.window.document.querySelector(s)};
}
async function click(t,seletor) {
  t.$(seletor).click();
  const limite=Date.now()+5000;
  while(t.dom.window.document.body.dataset.ocupado==='true') {
    if(Date.now()>limite)throw new Error('UI não terminou a ação');
    await new Promise(r=>setTimeout(r,5));
  }
}
test('sete HTMLs sem handlers inline ou scripts externos; layout principal preservado',async()=>{
  for(const pagina of ['index','login','dashboard','obras','obras-detalhe','caixa','agenda']) {
    const html=await readFile(new URL(`../${pagina}.html`,import.meta.url),'utf8');
    const d=new JSDOM(html).window.document;
    assert.ok(d.querySelector('#app-mensagem'));
    assert.ok(d.querySelector('script[type=module][src="js/bootstrap.js"]'));
    assert.equal(d.querySelectorAll('[onclick],script[src^="http"]').length,0);
    if(!['index','login'].includes(pagina))assert.ok(d.querySelector('[data-private][hidden]'));
  }
});
let obra;
test('obras: criação por formulário e XSS é mostrado como texto',async()=>{
  const t=await tela('obras');
  t.$('#cliente').value='<img src=x onerror=alert(1)>';
  t.$('#descricao').value='Fixture';t.$('#valor').value='1000.00';
  await click(t,'[data-action=criarObra]');
  assert.match(t.$('#lista').textContent,/<img src=x/);
  assert.equal(t.$('#lista img'),null);
  obra=(await state(db)).obras[0].id;
  t.dom.window.close();
});
test('detalhe: entrada, custo, pedido, aprovação pelo outro operador e totais',async()=>{
  let t=await tela('obras-detalhe',A,obra);
  t.$('#descricao-entrada').value='<svg onload=alert(1)>';t.$('#valor-entrada').value='1000.00';
  await click(t,'[data-action=adicionarEntrada]');
  t.$('#tipo').value='Material';t.$('#descricao-custo').value='Compra';t.$('#valor-custo').value='300';
  await click(t,'[data-action=adicionarCusto]');
  assert.equal(t.$('#lucro').textContent,'R$ 700,00');
  assert.equal(t.$('#entradas svg'),null);
  await click(t,'#custos button');
  assert.match(t.$('#custos').textContent,/Aguardando decisão/);
  assert.equal(t.$('#custos button'),null);
  t.dom.window.close();
  t=await tela('obras-detalhe',B,obra);
  assert.equal(t.$('#custos button').textContent,'Aprovar exclusão');
  await click(t,'#custos button');
  assert.equal(t.$('#lucro').textContent,'R$ 1.000,00');
  assert.match(t.$('#custos').textContent,/Revertido após aprovação/);
  assert.match(t.$('#entradas').textContent,/Estorno integral/);
  t.$('#data-execucao').value='2026-11-20';
  await click(t,'[data-action=agendarObra]');
  assert.match(t.$('#historico').textContent,/Agendada/);
  t.dom.window.close();
});
test('dashboard, caixa e agenda usam o mesmo saldo e data; logout limpa DOM',async()=>{
  let t=await tela('dashboard');
  assert.match(t.$('#caixa-total').textContent,/1.000,00/);t.dom.window.close();
  t=await tela('caixa');assert.match(t.$('#valor-caixa').textContent,/1.000,00/);
  assert.equal(t.dom.window.document.querySelectorAll('#lista-caixa .movimentacao-caixa').length,3);t.dom.window.close();
  t=await tela('agenda');assert.equal(t.$('#agenda-proxima').textContent,'20/11/2026');t.dom.window.close();
  t=await tela('dashboard');await click(t,'[data-action=logout]');
  assert.equal(t.$('[data-private]').hidden,true);assert.equal(t.$('[data-private]').textContent,'');
  assert.ok(t.destinos.includes('login.html'));t.dom.window.close();
});
test('login envia com Enter/form e index decide pela sessão',async()=>{
  const t=await tela('login');let credenciais;
  t.servicos.entrar=async(...args)=>{credenciais=args;};
  t.$('#usuario').value='gustavo@example.test';t.$('#senha').value='sintetica';
  t.$('#form-login').dispatchEvent(new t.dom.window.Event('submit',{cancelable:true,bubbles:true}));
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(credenciais,['gustavo@example.test','sintetica']);assert.ok(t.destinos.includes('dashboard.html'));
  t.dom.window.close();
  const index=await tela('index');assert.ok(index.destinos.includes('dashboard.html'));index.dom.window.close();
});
test('login continua utilizável após sessão não autorizada ser encerrada',async()=>{
  const t=await tela('login');let tentativas=0;
  t.servicos.entrar=async()=>{tentativas++;if(tentativas===1){await t.servicos.sair();throw new Error('Não autorizado');}};
  t.$('#usuario').value='fixture@example.test';t.$('#senha').value='sintetica';
  for(let i=0;i<2;i++){
    t.$('#senha').value='sintetica'; // Credentials are now cleared after each attempt.
    t.$('#form-login').dispatchEvent(new t.dom.window.Event('submit',{cancelable:true,bubbles:true}));
    await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(tentativas,2);assert.ok(t.destinos.includes('dashboard.html'));t.dom.window.close();
});
test('reload após resposta perdida confirma a operação anterior sem novo lançamento',async()=>{
  let t=await tela('obras');let chamadas=0;
  t.servicos.executar=async(acao,dados,id)=>{chamadas++;await command(db,A,acao,dados,id);throw new Error('Resposta perdida');};
  t.$('#cliente').value='Fixture resultado incerto';t.$('#valor').value='77.31';
  await click(t,'[data-action=criarObra]');
  const persistido={};for(let i=0;i<t.dom.window.localStorage.length;i++){
    const key=t.dom.window.localStorage.key(i);persistido[key]=t.dom.window.localStorage.getItem(key);
  }
  assert.equal(Object.keys(persistido).length,1);
  t.dom.window.close();
  t=await tela('obras',A,'',persistido);
  assert.match(t.$('#app-mensagem').textContent,/anterior confirmada/);
  assert.equal(t.dom.window.localStorage.length,0);assert.equal(t.$('#cliente').value,'');
  assert.equal((await state(db)).obras.filter(o=>o.cliente==='Fixture resultado incerto').length,1);
  assert.equal(chamadas,1);t.dom.window.close();
});
