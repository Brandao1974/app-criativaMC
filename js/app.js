import { formatarBRL, textoParaCentavos, valorGrafico } from './dinheiro.js';
import { elemento, linhas, dataTexto } from './ui.js';
import { mensagemErro } from './servicos.js';
import { Chart } from './vendor/chart.js';
import { criarPainelAlltech, preencherUF } from './alltech.js';
import { criarRecuperacao } from './recuperacao.js';

export async function iniciar(servicos) {
  const pagina = document.body.dataset.pagina;
  const $ = id => document.getElementById(id);
  const aviso = $('app-mensagem');
  const privados = [...document.querySelectorAll('[data-private]')];
  const recuperacao=criarRecuperacao(servicos,window.localStorage,window.navigator?.locks);
  let estado = null, ocupado = false, encerrado = false, grafico = null;
  let painel;
  const ir = destino => window.location.replace(destino);
  const nome = id => estado?.perfis.find(p => p.id === id)?.nome || 'Não identificado';
  const texto = (id, valor) => { if ($(id)) $(id).textContent = valor; };
  function mensagem(valor, erro = false) {
    aviso.textContent = valor;
    aviso.dataset.erro = String(erro);
  }
  function limpar() {
    encerrado = true;
    estado = null;
    grafico?.destroy(); grafico = null;
    for (const el of privados) { el.hidden = true; el.replaceChildren(); }
  }
  servicos.aoSair(() => {
    if (pagina === 'login') { estado = null; return; }
    limpar(); ir('login.html');
  });
  async function complementar(base) {
    if (!base || !servicos.lerAlltech || !document.body.hasAttribute('data-alltech')) return base;
    return {...base,alltech:await servicos.lerAlltech(base.usuario_id)};
  }
  async function recarregar() {
    const novo = await complementar(await servicos.ler());
    if (encerrado) return;
    const anterior = estado;
    estado = novo;
    renderizar(anterior);
  }
  async function executar(acao, dados) {
    const usuario=estado.usuario_id;
    const resposta=await recuperacao.executar(usuario,acao,dados);
    await recarregar();
    await recuperacao.confirmar(usuario,resposta.id);
    mensagem(resposta.recuperada?'Tentativa anterior localizada no servidor. Confira o resultado antes de iniciar uma nova operação.':'Operação concluída. Saldos atualizados.');
    return !resposta.recuperada && !encerrado;
  }
  async function conferirAnterior(encerramento=false) {
    const usuario=estado.usuario_id;
    let anterior=await recuperacao.recuperar(usuario);
    if(!anterior)return false;
    if(anterior.estado==='ausente' && encerramento && window.confirm('A tentativa anterior ainda não consta como concluída. Encerrá-la no servidor? Uma mensagem atrasada com o mesmo identificador será bloqueada.')) {
      anterior=await recuperacao.encerrar(usuario);
    }
    if(anterior.estado==='ausente') {
      mensagem('Há uma tentativa sem confirmação. Refaça a mesma ação com os dados conferidos para reutilizar seu identificador, ou use Atualizar dados para encerrá-la.',true);
      return true;
    }
    await recarregar();
    await recuperacao.confirmar(usuario,anterior.id);
    mensagem(anterior.estado==='cancelada'?'Tentativa encerrada no servidor. Nenhum envio atrasado com esse identificador será aplicado.':'Operação anterior confirmada no servidor. Confira os dados atualizados antes de repetir qualquer lançamento.');
    return true;
  }
  function campo(id) { return $(id)?.value.trim() ?? ''; }
  function obraAtual() {
    const id = new URLSearchParams(window.location.search).get('id');
    const obra = estado.obras.find(o => o.id === id);
    if (!obra) throw new Error('Obra não encontrada. Volte à lista de obras.');
    return obra;
  }
  function abrir(id) { window.location.href = `obras-detalhe.html?id=${encodeURIComponent(id)}`; }
  function botao(textoBotao, acao, classe = '') {
    const b = elemento('button', textoBotao, classe);
    b.type = 'button';
    b.addEventListener('click', () => envolver(acao));
    return b;
  }
  async function envolver(fn) {
    if (ocupado || encerrado) return;
    ocupado = true;
    document.body.dataset.ocupado = 'true';
    const controles = [...document.querySelectorAll('button:enabled, form input:enabled, form select:enabled, form textarea:enabled')];
    controles.forEach(c => { c.disabled = true; });
    try { mensagem('Processando…'); await fn(); }
    catch (erro) { mensagem(erro instanceof Error && !erro.code ? erro.message : mensagemErro(erro), true); }
    finally {
      ocupado = false;
      document.body.dataset.ocupado = 'false';
      controles.forEach(c => { c.disabled = false; });
    }
  }
  function lista(id, itens, render) {
    if (!$(id)) return;
    $(id).replaceChildren(...itens.map(render));
    if (!itens.length) $(id).append(elemento('p','Nenhum registro encontrado.','historico-vazio'));
  }
  function cardMovimento(m) {
    const revertido = estado.movimentos.find(r => r.estorna_id === m.id);
    const pedido = estado.solicitacoes.filter(s => s.movimento_id === m.id).at(-1);
    const decisao = pedido && estado.decisoes.find(d => d.solicitacao_id === pedido.id);
    const div = linhas('obra-item movimentacao-item',[
      m.categoria || (m.tipo === 'entrada' ? 'Entrada' : 'Custo'), m.descricao,
      formatarBRL(m.valor_centavos),
      m.legado ? `Legado não verificado: ${m.legado.usuario || 'autor não informado'} — ${m.legado.data || 'data não informada'}` : `${nome(m.autor_id)} — ${dataTexto(m.ocorrido_em)}`,
      m.estorna_id ? `Estorno integral de ${m.estorna_id}` : revertido ? 'Revertido após aprovação' : 'Lançamento ativo'
    ]);
    if (pedido) {
      div.append(elemento('p', `${pedido.estado}: ${nome(pedido.solicitante_id)} solicitou em ${dataTexto(pedido.solicitado_em)} — ${pedido.motivo}`));
      if (decisao) div.append(elemento('p', `${nome(decisao.decisor_id)} decidiu em ${dataTexto(decisao.decidido_em)} — ${decisao.motivo}`));
    }
    const antiga = m.legado?.deleteRequest;
    if (antiga?.gustavo || antiga?.ivan) div.append(elemento('p','Há assinatura legada não verificada. Solicitação autenticada deve ser confirmada novamente.'));
    if (m.estorna_id || revertido) return div;
    if (pedido?.estado === 'pendente') {
      if (pedido.solicitante_id === estado.usuario_id) div.append(elemento('p','Aguardando decisão do outro operador.'));
      else for (const [rotulo,decisao] of [['Aprovar exclusão','aprovada'],['Rejeitar exclusão','rejeitada']]) {
        div.append(botao(rotulo,async()=> {
          const motivo = window.prompt('Justificativa da decisão (mínimo 3 caracteres):');
          if (motivo === null) { mensagem('Operação cancelada.'); return; }
          if (motivo.trim().length < 3) throw new Error('Informe uma justificativa com pelo menos 3 caracteres.');
          await executar('decidir_exclusao',{solicitacao_id:pedido.id,decisao,motivo:motivo.trim()});
        },'botao-exclusao'));
      }
    } else div.append(botao('Solicitar exclusão',async()=> {
      const motivo = window.prompt('Motivo da solicitação (mínimo 3 caracteres):');
      if (motivo === null) { mensagem('Operação cancelada.'); return; }
      if (motivo.trim().length < 3) throw new Error('Informe um motivo com pelo menos 3 caracteres.');
      await executar('solicitar_exclusao',{movimento_id:m.id,motivo:motivo.trim()});
    },'botao-exclusao'));
    return div;
  }
  function renderizarObras() {
    if (!estado) return;
    const normalizar = valor => valor.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
    const busca = normalizar(campo('filtro-obra'));
    const data = campo('filtro-data');
    const uf = campo('filtro-uf'), cidade = normalizar(campo('filtro-cidade'));
    const obras = estado.obras.filter(o =>
      (!uf || estado.alltech?.localizacoes[o.id]?.uf===uf) &&
      (!cidade || normalizar(estado.alltech?.localizacoes[o.id]?.cidade || '').includes(cidade)) &&
      (!data || o.data_execucao === data) &&
      (!busca || normalizar(o.cliente).includes(busca) || normalizar(o.localizacao || '').includes(busca)));
    lista('lista',obras,o=>{
      const card = elemento('a',null,'obra-item obra-link');
      card.href = `obras-detalhe.html?id=${encodeURIComponent(o.id)}`;
      const local=estado.alltech?.localizacoes[o.id];
      const estruturada=[local?.cidade,local?.uf].filter(Boolean).join(' / ');
      card.append(elemento('strong',o.cliente),
        elemento('span',[o.localizacao,estruturada].filter(Boolean).join(' · ') || 'Sem localização informada'),
        elemento('span',o.data_execucao ? `${o.status} · ${dataTexto(o.data_execucao)}` : o.status));
      return card;
    });
  }
  function renderizarGrafico() {
    const area = $('grafico-area');
    grafico?.destroy();
    grafico = null;
    area.hidden = true;
    texto('grafico-aviso','');
    try {
      const entradas = estado.obras.map(o=>({
        cliente:o.cliente,
        valor:valorGrafico(estado.resumos.find(r=>r.obra_id===o.id)?.entradas_centavos ?? '0')
      })).filter(o=>o.valor>0);
      if (!entradas.length) {
        texto('grafico-aviso','Nenhuma entrada registrada para exibir.');
        return;
      }
      area.hidden = false;
      grafico = new Chart($('grafico').getContext('2d'), {
        type:'pie',data:{labels:entradas.map(o=>o.cliente),datasets:[{data:entradas.map(o=>o.valor),
          backgroundColor:['#145b7d','#1b7f78','#ffd166','#ff6b6b','#9b5de5','#4cc9f0']}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}
      });
      if (!grafico.ctx) throw new Error('Contexto do gráfico indisponível');
    } catch {
      grafico?.destroy();
      grafico = null;
      area.hidden = true;
      texto('grafico-aviso','Gráfico indisponível. Os indicadores financeiros continuam disponíveis.');
    }
  }
  function renderizar(anterior) {
    if (!estado || encerrado) return;
    texto('usuario-logado',`Usuário: ${nome(estado.usuario_id)}`);
    painel?.renderizar(estado);
    if (pagina === 'dashboard') {
      texto('total-obras',String(estado.obras.length));
      texto('caixa-total',formatarBRL(estado.alltech?.financeiro.reduce((s,f)=>s+BigInt(f.caixa),0n) ?? estado.saldo_centavos));
      texto('lucro-total',formatarBRL(estado.saldo_centavos));
      texto('obras-andamento',String(estado.obras.filter(o=>o.status!=='Finalizada').length));
      renderizarGrafico();
    }
    if (pagina === 'obras') renderizarObras();
    if (pagina === 'detalhe') {
      const o=obraAtual();
      const resumo=estado.resumos.find(r=>r.obra_id===o.id);
      texto('obra-resumo', [o.cliente, o.localizacao || 'Localização não informada',
        o.data_execucao ? dataTexto(o.data_execucao) : 'Sem data de execução'].join(' · '));
      for (const [id,valor] of Object.entries({descricao:o.descricao || 'Sem descrição informada',status:`Status: ${o.status}`,
        valor:formatarBRL(o.valor_centavos),'responsavel-cliente':o.responsavel_cliente || 'Não informado',
        'usuario-criador':o.legado ? `Legado não verificado: ${o.legado.usuarioCriador || o.legado.responsavel || 'não informado'}` : nome(o.criado_por),
        lucro:formatarBRL(resumo.saldo_centavos),
        'total-entradas':formatarBRL(resumo.entradas_centavos),'total-custos':formatarBRL(resumo.custos_centavos)})) texto(id,valor);
      const obraAnterior = anterior?.obras.find(registro => registro.id === o.id);
      if (!obraAnterior || $('novo-status').value === obraAnterior.status) $('novo-status').value = o.status;
      if (!obraAnterior || $('data-execucao').value === (obraAnterior.data_execucao || '')) $('data-execucao').value = o.data_execucao || '';
      const movimentos=estado.movimentos.filter(m=>m.obra_id===o.id);
      lista('entradas',movimentos.filter(m=>m.tipo==='entrada'),cardMovimento);
      lista('custos',movimentos.filter(m=>m.tipo==='custo'),cardMovimento);
      const eventos=estado.eventos.filter(e=>e.obra_id===o.id).toReversed();
      lista('historico',eventos,e=>linhas('historico-item',[e.status,`${nome(e.autor_id)} — ${dataTexto(e.ocorrido_em)}`,e.data_execucao ? `Execução: ${dataTexto(e.data_execucao)}` : '']));
      for (const e of estado.legado_eventos.filter(e=>e.obra_id===o.id)) $('historico').append(linhas('historico-item',[
        'Histórico legado não verificado',String(e.bruto.status || ''),`${e.bruto.usuario || ''} — ${e.bruto.data || ''}`]));
    }
    if (pagina === 'caixa') {
      texto('valor-caixa',`Valor em Caixa: ${formatarBRL(estado.alltech?.financeiro.reduce((s,f)=>s+BigInt(f.caixa),0n) ?? estado.saldo_centavos)}`);
      lista('lista-caixa',estado.movimentos.toReversed(),m=>linhas(`obra-item movimentacao-caixa ${m.tipo==='entrada'?'entrada-item':'saida-item'}`,[
        `${m.estorna_id?'Estorno — ':''}${m.tipo==='entrada'?'Entrada':'Saída'}`,
        estado.obras.find(o=>o.id===m.obra_id)?.cliente || '',formatarBRL(m.valor_centavos),
        m.legado ? `Data legada: ${m.legado.data || 'não informada'}` : dataTexto(m.ocorrido_em)]));
    }
    if (pagina === 'agenda') {
      const obras=estado.obras.filter(o=>o.data_execucao).sort((a,b)=>a.data_execucao.localeCompare(b.data_execucao));
      const proxima=obras.find(o=>o.status!=='Finalizada' && o.data_execucao>=estado.hoje);
      texto('agenda-total',String(obras.length));
      texto('agenda-proxima',proxima ? dataTexto(proxima.data_execucao) : 'Sem data');
      lista('lista-agenda',obras,o=> {
        const atraso=o.status!=='Finalizada' && o.data_execucao<estado.hoje;
        const card=linhas('agenda-card',[o.cliente,`${o.status}${atraso?' — Atrasada':''}`,`Execução em ${dataTexto(o.data_execucao)}`,`Responsável: ${o.responsavel_cliente || 'Não informado'}`]);
        card.tabIndex=0; card.setAttribute('role','link');
        card.addEventListener('click',()=>abrir(o.id));
        card.addEventListener('keydown',e=>{if(e.key==='Enter')abrir(o.id);});
        return card;
      });
    }
  }
  const acoes = {
    voltarDashboard:()=>{window.location.href='dashboard.html';},
    logout:async()=>{await servicos.sair();limpar();ir('login.html');},
    atualizar:async()=>{if(!await conferirAnterior(true)){await recarregar();mensagem('Dados atualizados.');}},
    criarObra:async()=>{
      if (!campo('cliente')) throw new Error('Informe o cliente.');
      const dados={cliente:campo('cliente'),descricao:campo('descricao'),localizacao:campo('localizacao'),responsavel_cliente:campo('responsavel-loja'),valor_centavos:textoParaCentavos(campo('valor'),{zero:true})};
      const uf=campo('cadastro-uf'),cidade=campo('cadastro-cidade');
      const gravada=uf||cidade ? await executar('alltech_criar_obra',{...dados,uf,cidade}) : await executar('criar_obra',dados);
      if (!gravada) return;
      document.querySelector('[data-submit="criarObra"]').reset();
      ir('dashboard.html?obra=cadastrada');
    },
    alterarStatus:async()=>{const o=obraAtual();await executar('atualizar_obra',{id:o.id,versao:o.versao,status:campo('novo-status')});},
    agendarObra:async()=>{
      const o=obraAtual();if(!campo('data-execucao'))throw new Error('Informe a data de execução.');
      await executar('atualizar_obra',{id:o.id,versao:o.versao,status:'Agendada',data_execucao:campo('data-execucao')});
    },
    adicionarEntrada:()=>adicionar('entrada'),adicionarCusto:()=>adicionar('custo')
  };
  async function adicionar(tipo) {
    const sufixo=tipo==='entrada'?'entrada':'custo';
    const descricao=campo(`descricao-${sufixo}`);
    if (!descricao || (tipo==='custo' && !campo('tipo'))) throw new Error('Informe descrição e tipo do custo, quando aplicável.');
    const gravado = await executar('registrar_movimento',{obra_id:obraAtual().id,tipo,descricao,
      categoria:tipo==='custo'?campo('tipo'):null,valor_centavos:textoParaCentavos(campo(`valor-${sufixo}`))});
    if (!gravado) return;
    const secao = $(tipo === 'entrada' ? 'nova-entrada' : 'novo-custo');
    secao.querySelector('form').reset();
    secao.open = false;
    secao.querySelector('summary').focus();
  }
  for (const b of document.querySelectorAll('[data-action]:not([type="submit"])')) {
    b.addEventListener('click',()=>envolver(acoes[b.dataset.action]));
  }
  for (const form of document.querySelectorAll('[data-submit]')) {
    form.addEventListener('submit',evento=>{
      evento.preventDefault();
      envolver(acoes[form.dataset.submit]);
    });
  }
  for(const select of document.querySelectorAll('[data-uf]')) preencherUF(select);
  painel=criarPainelAlltech({executar,envolver,obraAtual});
  if (pagina === 'obras') {
    $('filtro-uf')?.addEventListener('change',renderizarObras);
    $('filtro-cidade')?.addEventListener('input',renderizarObras);
    $('filtro-obra').addEventListener('input',renderizarObras);
    $('filtro-data').addEventListener('change',renderizarObras);
  }
  if (pagina === 'login') {
    $('form-login').addEventListener('submit',e=>{
      e.preventDefault();
      envolver(async()=>{
        if (!campo('usuario') || !$('senha').value) throw new Error('Informe usuário e senha.');
        try { await servicos.entrar(campo('usuario'),$('senha').value); }
        finally { $('senha').value=''; }
        ir('dashboard.html');
      });
    });
    $('form-ativacao')?.addEventListener('submit',e=>{
      e.preventDefault();envolver(async()=>{
        try {await servicos.ativar(campo('ativacao-usuario'),campo('ativacao-codigo'),$('ativacao-senha').value);}
        finally {$('ativacao-senha').value='';$('ativacao-codigo').value='';}
        mensagem('Senha definida. Entre com seu usuário e senha pessoal.');
      });
    });
    mensagem('');
    return;
  }
  mensagem('Carregando sessão…');
  try {
    estado=await complementar(await servicos.sessao());
    if (!estado) { ir('login.html'); return; }
    if (encerrado) return;
    if (pagina==='index') { ir('dashboard.html'); return; }
    renderizar();
    if(pagina==='dashboard') {
      const {iniciarAdministracao}=await import('./administracao.js');
      await iniciarAdministracao(servicos,estado.usuario_id);
    }
    privados.forEach(el=>{el.hidden=false;});
    if(!await conferirAnterior()) {
      const cadastrada = pagina === 'dashboard' && new URLSearchParams(window.location.search).get('obra') === 'cadastrada';
      if (cadastrada) window.history?.replaceState(null,'','dashboard.html');
      mensagem(cadastrada ? 'Obra cadastrada com sucesso.' : '');
    }
  } catch(erro) { mensagem(mensagemErro(erro),true); }
  return { recarregar, limpar };
}

