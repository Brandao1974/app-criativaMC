import { formatarBRL, textoParaCentavos, valorGrafico } from './dinheiro.js';
import { elemento, linhas, dataTexto } from './ui.js';
import { mensagemErro } from './servicos.js';
import { Chart } from './vendor/chart.js';
import { criarRecuperacao } from './recuperacao.js';

export async function iniciar(servicos) {
  const pagina = document.body.dataset.pagina;
  const $ = id => document.getElementById(id);
  const aviso = $('app-mensagem');
  const privados = [...document.querySelectorAll('[data-private]')];
  const recuperacao=criarRecuperacao(servicos,window.localStorage,window.navigator?.locks);
  let estado = null, ocupado = false, encerrado = false, grafico = null;
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
  async function recarregar() {
    const novo = await servicos.ler();
    if (encerrado) return;
    estado = novo;
    renderizar();
  }
  async function executar(acao, dados) {
    const usuario=estado.usuario_id;
    const resposta=await recuperacao.executar(usuario,acao,dados);
    await recarregar();
    await recuperacao.confirmar(usuario,resposta.id);
    mensagem(resposta.recuperada?'Tentativa anterior localizada no servidor. Confira o resultado antes de iniciar uma nova operação.':'Operação concluída. Saldos atualizados.');
  }
  function limparFormulario(acao) {
    const ids=acao==='criar_obra'?['cliente','descricao','localizacao','responsavel-loja','valor']:
      acao==='registrar_movimento'?['descricao-entrada','valor-entrada','descricao-custo','valor-custo','tipo']:[];
    for(const id of ids)if($(id)?.tagName==='INPUT')$(id).value='';
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
    limparFormulario(anterior.acao);
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
    const botoes = [...document.querySelectorAll('button')];
    botoes.forEach(b => { b.disabled = true; });
    try { mensagem('Processando…'); await fn(); }
    catch (erro) { mensagem(erro instanceof Error && !erro.code ? erro.message : mensagemErro(erro), true); }
    finally {
      ocupado = false;
      document.body.dataset.ocupado = 'false';
      botoes.forEach(b => { b.disabled = false; });
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
  function renderizar() {
    if (!estado || encerrado) return;
    texto('usuario-logado',`Usuário: ${nome(estado.usuario_id)}`);
    if (pagina === 'dashboard') {
      texto('total-obras',`Total de Obras: ${estado.obras.length}`);
      texto('caixa-total',`Caixa: ${formatarBRL(estado.saldo_centavos)}`);
      texto('lucro-total',`Resultado: ${formatarBRL(estado.saldo_centavos)}`);
      texto('obras-andamento',`Obras em andamento: ${estado.obras.filter(o=>o.status!=='Finalizada').length}`);
      // Existing pie chart, now bundled locally at a pinned version.
      const canvas=$('grafico');
      try {
        const valores=estado.obras.map(o=>valorGrafico(estado.resumos.find(r=>r.obra_id===o.id)?.entradas_centavos ?? '0'));
        grafico?.destroy();
        grafico = new Chart(canvas.getContext('2d'), {
          type:'pie',data:{labels:estado.obras.map(o=>o.cliente),datasets:[{data:valores,
            backgroundColor:['#145b7d','#1b7f78','#ffd166','#ff6b6b','#9b5de5','#4cc9f0']}]},
          options:{responsive:true,plugins:{legend:{position:'bottom'}}}
        });
        if(!grafico.ctx)throw new Error('Contexto do gráfico indisponível');
      } catch { texto('grafico-aviso','Gráfico indisponível. Os indicadores financeiros continuam disponíveis.'); }
    }
    if (pagina === 'obras') lista('lista',estado.obras,o=> {
      const card=linhas('obra-item',[o.cliente,o.localizacao || o.descricao || 'Sem localização informada',`Status: ${o.status}`]);
      card.tabIndex=0; card.setAttribute('role','link');
      card.addEventListener('click',()=>abrir(o.id));
      card.addEventListener('keydown',e=>{if(e.key==='Enter')abrir(o.id);});
      return card;
    });
    if (pagina === 'detalhe') {
      const o=obraAtual();
      const resumo=estado.resumos.find(r=>r.obra_id===o.id);
      for (const [id,valor] of Object.entries({cliente:o.cliente,descricao:o.descricao || 'Sem descrição informada',status:`Status: ${o.status}`,
        valor:formatarBRL(o.valor_centavos),localizacao:o.localizacao || 'Não informada','responsavel-cliente':o.responsavel_cliente || 'Não informado',
        'usuario-criador':o.legado ? `Legado não verificado: ${o.legado.usuarioCriador || o.legado.responsavel || 'não informado'}` : nome(o.criado_por),
        lucro:formatarBRL(resumo.saldo_centavos),'resumo-custos':formatarBRL(resumo.custos_centavos),
        'total-entradas':`Total Entradas: ${formatarBRL(resumo.entradas_centavos)}`,'total-custos':`Total Custos: ${formatarBRL(resumo.custos_centavos)}`,
        'data-agendada':o.data_execucao ? `Data Agendada: ${dataTexto(o.data_execucao)}` : ''})) texto(id,valor);
      $('novo-status').value=o.status;
      $('data-execucao').value=o.data_execucao || '';
      const movimentos=estado.movimentos.filter(m=>m.obra_id===o.id);
      lista('entradas',movimentos.filter(m=>m.tipo==='entrada'),cardMovimento);
      lista('custos',movimentos.filter(m=>m.tipo==='custo'),cardMovimento);
      const eventos=estado.eventos.filter(e=>e.obra_id===o.id).toReversed();
      lista('historico',eventos,e=>linhas('historico-item',[e.status,`${nome(e.autor_id)} — ${dataTexto(e.ocorrido_em)}`,e.data_execucao ? `Execução: ${dataTexto(e.data_execucao)}` : '']));
      for (const e of estado.legado_eventos.filter(e=>e.obra_id===o.id)) $('historico').append(linhas('historico-item',[
        'Histórico legado não verificado',String(e.bruto.status || ''),`${e.bruto.usuario || ''} — ${e.bruto.data || ''}`]));
    }
    if (pagina === 'caixa') {
      texto('valor-caixa',`Valor em Caixa: ${formatarBRL(estado.saldo_centavos)}`);
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
    irObras:()=>{window.location.href='obras.html';},irCaixa:()=>{window.location.href='caixa.html';},irAgenda:()=>{window.location.href='agenda.html';},
    voltarDashboard:()=>{window.location.href='dashboard.html';},voltar:()=>{window.location.href='obras.html';},
    logout:async()=>{await servicos.sair();limpar();ir('login.html');},
    atualizar:async()=>{if(!await conferirAnterior(true)){await recarregar();mensagem('Dados atualizados.');}},
    criarObra:async()=>{
      if (!campo('cliente')) throw new Error('Informe o cliente.');
      await executar('criar_obra',{cliente:campo('cliente'),descricao:campo('descricao'),localizacao:campo('localizacao'),responsavel_cliente:campo('responsavel-loja'),valor_centavos:textoParaCentavos(campo('valor'),{zero:true})});
      for (const id of ['cliente','descricao','localizacao','responsavel-loja','valor']) $(id).value='';
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
    await executar('registrar_movimento',{obra_id:obraAtual().id,tipo,descricao,
      categoria:tipo==='custo'?campo('tipo'):null,valor_centavos:textoParaCentavos(campo(`valor-${sufixo}`))});
    $(`descricao-${sufixo}`).value=''; $(`valor-${sufixo}`).value='';
    if(tipo==='custo')$('tipo').value='';
  }
  for (const b of document.querySelectorAll('[data-action]')) b.addEventListener('click',()=>envolver(acoes[b.dataset.action]));
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
    estado=await servicos.sessao();
    if (!estado) { ir('login.html'); return; }
    if (encerrado) return;
    if (pagina==='index') { ir('dashboard.html'); return; }
    renderizar();
    if(pagina==='dashboard') {
      const {iniciarAdministracao}=await import('./administracao.js');
      await iniciarAdministracao(servicos,estado.usuario_id);
    }
    privados.forEach(el=>{el.hidden=false;});
    if(!await conferirAnterior())mensagem('');
  } catch(erro) { mensagem(mensagemErro(erro),true); }
  return { recarregar, limpar };
}

