import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { iniciar } from '../js/app.js';
import { fixture, command, state, as, A, B } from './harness.mjs';
let db;
before(async()=>{db=await fixture();});
after(async()=>{await db?.close();});
async function tela(nome,uid=A,id='',persistido={},extensao={}) {
  const html=await readFile(new URL(`../${nome}.html`,import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:`http://127.0.0.1:4173/${nome}.html${id.startsWith('?')?id:id?'?id='+id:''}`});
  globalThis.document=dom.window.document;
  for(const [k,v] of Object.entries(persistido))dom.window.localStorage.setItem(k,v);
  const destinos=[];let sair;
  globalThis.window={location:{search:id.startsWith('?')?id:id?'?id='+id:'',replace:v=>destinos.push(v)},prompt:()=> 'Conferido',confirm:()=>true,
    localStorage:dom.window.localStorage,navigator:{locks:{request:async(_key,fn)=>fn()}}};
  // jsdom has no native canvas; explicitly exercise graceful chart failure.
  dom.window.HTMLCanvasElement.prototype.getContext=()=>{throw new Error('Canvas indisponível no teste DOM');};
  const ler=async()=>({...await state(db,uid),hoje:'2026-11-15'});
  const servicos={aoSair:fn=>{sair=fn;},sessao:ler,ler,
    consultar:id=>as(db,uid,async()=> (await db.query('select public.consultar_operacao($1) as r',[id])).rows[0].r),
    encerrar:id=>as(db,uid,async()=> (await db.query('select public.encerrar_operacao($1) as r',[id])).rows[0].r),
    executar:(acao,dados,op)=>command(db,uid,acao,dados,op),entrar:async()=>{},sair:async()=>{sair();},...extensao};
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
test('dez HTMLs sem handlers inline ou scripts externos; layout principal preservado',async()=>{
  for(const pagina of ['index','login','dashboard','obra-cadastro','obras','obras-detalhe','caixa','agenda','adiantamentos','participacoes']) {
    const html=await readFile(new URL(`../${pagina}.html`,import.meta.url),'utf8');
    const d=new JSDOM(html).window.document;
    assert.ok(d.querySelector('#app-mensagem'));
    assert.ok(d.querySelector('script[type=module][src="js/bootstrap.js"]'));
    assert.equal(d.querySelectorAll('[onclick],script[src^="http"]').length,0);
    if(!['index','login'].includes(pagina))assert.ok(d.querySelector('[data-private][hidden]'));
  }
});
test('dashboard sem entradas exibe mensagem e oculta o gráfico',async()=>{
  const t=await tela('dashboard');
  assert.equal(t.$('#grafico-area').hidden,true);
  assert.match(t.$('#grafico-aviso').textContent,/Nenhuma entrada registrada/);
  assert.equal(t.$('#caixa-total').textContent,'R$ 0,00');
  t.dom.window.close();
});
let obra;
test('obras: criação por formulário e XSS é mostrado como texto',async()=>{
  let t=await tela('obra-cadastro');
  t.$('#cliente').value='<img src=x onerror=alert(1)>';
  t.$('#descricao').value='Fixture';t.$('#valor').value='1000.00';
  t.$('#localizacao').value='São José - endereço legado em texto';
  await click(t,'[data-action=criarObra]');
  assert.equal(t.$('#cliente').value,'');
  assert.deepEqual(t.destinos,['dashboard.html?obra=cadastrada']);
  t.dom.window.close();
  t=await tela('dashboard',A,'?obra=cadastrada');
  assert.match(t.$('#app-mensagem').textContent,/Obra cadastrada com sucesso/);
  assert.deepEqual([...t.dom.window.document.querySelectorAll('.portal-menu a')].map(a=>a.getAttribute('href')),
    ['obra-cadastro.html','obras.html','caixa.html','adiantamentos.html','participacoes.html','agenda.html']);
  assert.equal(t.dom.window.document.querySelectorAll('.portal-menu small').length,0);
  t.dom.window.close();
  t=await tela('obras');
  assert.match(t.$('#lista').textContent,/<img src=x/);
  assert.equal(t.$('#lista img'),null);
  obra=(await state(db)).obras[0].id;
  t.$('#filtro-obra').value='sao jose';
  t.$('#filtro-obra').dispatchEvent(new t.dom.window.Event('input'));
  assert.equal(t.$('#lista a').getAttribute('href'),`obras-detalhe.html?id=${obra}`);
  t.$('#filtro-data').value='2026-11-20';
  t.$('#filtro-data').dispatchEvent(new t.dom.window.Event('change'));
  assert.equal(t.$('#lista a'),null);
  t.dom.window.close();
});
test('detalhe: entrada, custo, pedido, aprovação pelo outro operador e totais',async()=>{
  let t=await tela('obras-detalhe',A,obra);
  assert.match(t.$('#obra-resumo').textContent,/São José.*Sem data/);
  assert.equal(t.dom.window.document.querySelectorAll('details').length,6);
  t.$('#nova-entrada').open=true;
  t.$('#descricao-entrada').value='<svg onload=alert(1)>';t.$('#valor-entrada').value='1000.00';
  await click(t,'[data-action=adicionarEntrada]');
  assert.equal(t.$('#nova-entrada').open,false);
  assert.equal(t.$('#descricao-entrada').value,'');
  t.$('#novo-custo').open=true;
  t.$('#tipo').value='Materiais e Insumos';t.$('#descricao-custo').value='Compra';t.$('#valor-custo').value='300';
  await click(t,'[data-action=adicionarCusto]');
  assert.equal(t.$('#novo-custo').open,false);
  assert.equal(t.$('#tipo').value,'');
  assert.match(t.$('#custos').textContent,/Materiais e Insumos/);
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
  let t=await tela('obra-cadastro');let chamadas=0;
  t.servicos.executar=async(acao,dados,id)=>{chamadas++;await command(db,A,acao,dados,id);throw new Error('Resposta perdida');};
  t.$('#cliente').value='Fixture resultado incerto';t.$('#valor').value='77.31';
  await click(t,'[data-action=criarObra]');
  assert.equal(t.$('#cliente').value,'Fixture resultado incerto');
  assert.deepEqual(t.destinos,[]);
  const persistido={};for(let i=0;i<t.dom.window.localStorage.length;i++){
    const key=t.dom.window.localStorage.key(i);persistido[key]=t.dom.window.localStorage.getItem(key);
  }
  assert.equal(Object.keys(persistido).length,1);
  t.dom.window.close();
  t=await tela('obra-cadastro',A,'',persistido);
  assert.match(t.$('#app-mensagem').textContent,/anterior confirmada/);
  assert.equal(t.dom.window.localStorage.length,0);assert.equal(t.$('#cliente').value,'');
  assert.equal((await state(db)).obras.filter(o=>o.cliente==='Fixture resultado incerto').length,1);
  assert.equal(chamadas,1);t.dom.window.close();
});

test('detalhe preserva categoria histórica e mantém preenchido o custo cuja gravação falhou',async()=>{
  await command(db,A,'registrar_movimento',{obra_id:obra,tipo:'custo',descricao:'Compra antiga',
    categoria:'Categoria histórica livre',valor_centavos:'100'});
  const t=await tela('obras-detalhe',A,obra);
  assert.match(t.$('#custos').textContent,/Categoria histórica livre/);
  assert.deepEqual([...t.$('#tipo').options].slice(1).map(o=>o.value),
    ['Combustível','Alimentação','Estadia','Manutenção de Veículo','Pedágio','Ferro','ACM','Materiais e Insumos','Outros']);
  t.servicos.executar=async()=>{throw new Error('Gravação indisponível');};
  t.$('#novo-custo').open=true;
  t.$('#tipo').value='Pedágio';
  t.$('#descricao-custo').value='Tarifa de teste';
  t.$('#valor-custo').value='12.50';
  await click(t,'[data-action=adicionarCusto]');
  assert.match(t.$('#app-mensagem').textContent,/Gravação indisponível/);
  assert.equal(t.$('#novo-custo').open,true);
  assert.equal(t.$('#tipo').value,'Pedágio');
  assert.equal(t.$('#descricao-custo').value,'Tarifa de teste');
  assert.equal(t.$('#valor-custo').value,'12.50');
  assert.doesNotMatch(t.$('#custos').textContent,/Tarifa de teste/);
  t.dom.window.close();
});

test('AllTech mostra saldos negativos, envia adiantamento e permite consultar compromissos',async()=>{
  const p={id:A,nome:'Participante de teste',operador:true,peso:1,participacao:'0',adiantado:'500',saldo:'-500'};
  const f={obra_id:obra,contratado:'100000',entradas:'0',custos:'0',resultado:'0',caixa:'-500',
    adiantamentos:'500',versao:0,participantes:[p]};
  const alltech={financeiro:[f],localizacoes:{},adiantamentos:[],liquidacoes:[],percentuais:[],
    agenda:[{id:A,descricao:'Visita de teste',data:null,obra_id:obra}]};
  let pedido;
  const extensao={lerAlltech:async()=>alltech,executar:async(...args)=>{pedido=args;}};
  let t=await tela('adiantamentos',A,'',{},extensao);
  assert.match(t.$('#alltech-adiantamentos').textContent,/-R\$ 5,00/);
  const form=t.$('form[data-alltech-form="adiantar"]');
  form.elements.valor.value='5.00';
  form.elements.observacao.value='Fixture';
  await click(t,'form[data-alltech-form="adiantar"] button');
  assert.equal(pedido[0],'alltech_adiantar');
  assert.deepEqual(pedido[1],{participante_id:A,data:'2026-11-15',observacao:'Fixture',obra_id:obra,valor_centavos:'500'});
  assert.equal(t.$('input[name="valor"]').value,'');
  t.dom.window.close();
  t=await tela('participacoes',A,'',{},extensao);
  assert.match(t.$('#alltech-participacoes').textContent,/Caixa disponível.*-R\$ 5,00/);
  t.dom.window.close();
  t=await tela('agenda',A,'',{},extensao);
  assert.match(t.$('#alltech-agenda').textContent,/Visita de teste.*Sem data.*Pendente/);
  await click(t,'#alltech-agenda article button');
  assert.equal(pedido[0],'alltech_concluir');
  t.dom.window.close();
});
