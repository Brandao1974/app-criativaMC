import { elemento, dataTexto } from './ui.js';
import { formatarBRL, textoParaCentavos } from './dinheiro.js';

function opcao(valor,texto) {
  const el=elemento('option',texto);
  el.value=valor;
  return el;
}

export function preencherUF(select) {
  for (const uf of 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')) {
    select.append(opcao(uf,uf));
  }
}

function botao(texto, tipo='button') {
  const el=elemento('button',texto);
  el.type=tipo;
  return el;
}

function campo(form, nome, rotulo, opcoes={}) {
  const label=elemento('label',rotulo);
  const controle=elemento(opcoes.itens?'select':'input');
  controle.name=nome;
  if (opcoes.itens) for (const [id,texto] of opcoes.itens) controle.append(opcao(id,texto));
  else controle.type=opcoes.tipo || 'text';
  for (const atributo of ['required','min','max','maxLength','step']) {
    if (atributo in opcoes) controle[atributo]=opcoes[atributo];
  }
  controle.value=opcoes.valor ?? '';
  label.append(controle);
  form.append(label);
  return controle;
}

const dinheiro=valor=>formatarBRL(valor);
const valores=[
  ['contratado','Valor contratado'],['entradas','Entradas recebidas'],['custos','Custos operacionais'],
  ['resultado','Resultado apurado'],['adiantamentos','Adiantamentos'],['caixa','Caixa disponível']
];

function demonstrativo(container, financeiro) {
  const dl=elemento('dl',undefined,'alltech-valores');
  for (const [chave,rotulo] of valores) {
    const item=elemento('div');
    item.append(elemento('dt',rotulo),elemento('dd',dinheiro(financeiro[chave])));
    dl.append(item);
  }
  container.append(dl);
}

function pessoa(p) {
  const item=elemento('article',undefined,'alltech-item');
  item.append(elemento('strong',p.nome),
    elemento('p','Participação: '+dinheiro(p.participacao)),
    elemento('p','Adiantado: '+dinheiro(p.adiantado)),
    elemento('p','Saldo individual: '+dinheiro(p.saldo)));
  return item;
}

export function criarPainelAlltech({executar,envolver,obraAtual}) {
  const id=document.body.dataset.pagina;
  const raiz=document.getElementById('alltech-'+id);
  if (!raiz) return;
  let estado, obraEscolhida;
  function formulario(container,chave,rotulo,acao,montar,dados,versao) {
    const form=elemento('form',undefined,'obra-form');
    form.dataset.alltechForm=chave;
    if (versao!==undefined) form.dataset.versao=String(versao);
    montar(form);
    form.append(botao(rotulo,'submit'));
    form.addEventListener('submit',evento=>{
      evento.preventDefault();
      const dadosFormulario=Object.fromEntries(new document.defaultView.FormData(form));
      envolver(async()=>{
        if (form.dataset.desatualizado==='sim') throw new Error('Dados alterados em outra sessão. Descarte o rascunho e confira a versão atual antes de reenviar.');
        if (await executar(acao,dados(dadosFormulario))) desenhar(chave);
      });
    });
    container.append(form);
  }
  function confirmar(rotulo,acao,dados) {
    const b=botao(rotulo);
    b.addEventListener('click',()=>envolver(async()=>{
      const motivo=window.prompt('Informe o motivo (mínimo de 3 caracteres).');
      if (motivo===null) return;
      if (motivo.trim().length<3) throw new Error('Informe um motivo com pelo menos 3 caracteres.');
      await executar(acao,{...dados,motivo:motivo.trim()});
    }));
    return b;
  }
  const obraNome=id=>estado.obras.find(o=>o.id===id)?.cliente || 'Sem obra vinculada';
  const autor=id=>estado.perfis.find(p=>p.id===id)?.nome || 'Operador não identificado';
  function selecionarObra() {
    if (!estado.obras.some(o=>o.id===obraEscolhida)) obraEscolhida=estado.obras[0]?.id;
    if (!obraEscolhida) {
      raiz.append(elemento('p','Cadastre uma obra para começar.'));
      return;
    }
    const seletor=campo(raiz,'obra','Obra',{itens:estado.obras.map(o=>[o.id,o.cliente]),valor:obraEscolhida});
    seletor.addEventListener('change',()=>{
      obraEscolhida=seletor.value;
      desenhar(null,false);
    });
    return estado.alltech.financeiro.find(f=>f.obra_id===obraEscolhida);
  }
  function adiantamentos(f) {
    formulario(raiz,'adiantar','Registrar adiantamento','alltech_adiantar',form=>{
      campo(form,'participante_id','Participante',{itens:f.participantes.map(p=>[p.id,p.nome]),valor:f.participantes[0].id});
      campo(form,'valor','Valor (R$)',{tipo:'number',step:'0.01',min:'0.01',required:true});
      campo(form,'data','Data',{tipo:'date',required:true,valor:estado.hoje});
      campo(form,'observacao','Observação',{maxLength:1000});
    },({valor,...d})=>({...d,obra_id:f.obra_id,valor_centavos:textoParaCentavos(valor)}));
    raiz.append(elemento('h2','Saldos individuais'),...f.participantes.map(pessoa));
    raiz.append(elemento('h2','Histórico de adiantamentos'));
    const registros=estado.alltech.adiantamentos.filter(a=>a.obra_id===f.obra_id);
    if (!registros.length) raiz.append(elemento('p','Nenhum adiantamento registrado nesta obra.'));
    for (const a of registros) {
      const item=elemento('article',undefined,'alltech-item');
      item.append(elemento('strong',a.participante+' · '+dinheiro(a.centavos)),
        elemento('p',dataTexto(a.data)+' · '+autor(a.autor_id)),elemento('p',a.observacao));
      const pedido=a.estornos.find(e=>e.decisao!=='rejeitada');
      for (const e of a.estornos) {
        item.append(elemento('p','Pedido de '+autor(e.solicitante)+' · '+dataTexto(e.solicitado_em)+' · '+e.motivo));
        if (e.decisao) item.append(elemento('p',(e.decisao==='aprovada'?'Estorno integral aprovado':'Estorno rejeitado')+
          ' por '+autor(e.decisor)+' · '+dataTexto(e.decidido_em)+' · '+e.justificativa));
      }
      if (!pedido) item.append(confirmar('Solicitar estorno','alltech_solicitar_estorno',{adiantamento_id:a.id}));
      else if (!pedido.decisao && pedido.solicitante!==estado.usuario_id) {
        for (const [rotulo,decisao] of [['Aprovar estorno','aprovada'],['Rejeitar estorno','rejeitada']]) {
          item.append(confirmar(rotulo,'alltech_decidir_estorno',{solicitacao_id:pedido.id,decisao}));
        }
      } else if (!pedido.decisao) item.append(elemento('p','Aguardando outro operador.'));
      raiz.append(item);
    }
  }
  function participacoes(f) {
    const liquidacao=estado.alltech.liquidacoes.find(l=>l.obra_id===f.obra_id);
    raiz.append(elemento('h2','Financeiro atual'));
    demonstrativo(raiz,f);
    raiz.append(...f.participantes.map(pessoa));
    if (liquidacao) {
      raiz.append(elemento('h2','Demonstrativo liquidado'),
        elemento('p',dataTexto(liquidacao.registrado_em)+' · '+autor(liquidacao.autor_id)));
      demonstrativo(raiz,liquidacao.demonstrativo);
      raiz.append(...liquidacao.demonstrativo.participantes.map(pessoa));
    } else {
      raiz.append(elemento('h2','Percentuais'));
      raiz.append(elemento('p','Para os três operadores, informe pesos relativos sobre o restante. Para os adicionais, informe pontos-base sobre o lucro (100 pontos = 1%).'));
      const base={obra_id:f.obra_id,versao:f.versao};
      formulario(raiz,'percentuais','Salvar percentuais','alltech_percentuais',form=>{
        for (const p of f.participantes) campo(form,p.id,p.nome+(p.operador?' · peso':' · pontos-base'),
          {tipo:'number',min:0,max:10000,step:1,required:true,valor:p.peso});
      },d=>({...base,pesos:Object.fromEntries(Object.entries(d).map(([k,v])=>[k,Number(v)]))}),f.versao);
      formulario(raiz,'participante','Adicionar participante','alltech_participante',form=>{
        campo(form,'nome','Nome do adicional',{required:true,maxLength:120});
        campo(form,'peso','Percentual em pontos-base',{tipo:'number',min:0,max:10000,step:1,required:true});
      },d=>({...base,nome:d.nome,peso:Number(d.peso)}),f.versao);
      const liquidar=botao('Registrar liquidação');
      liquidar.addEventListener('click',()=>envolver(async()=>{
        if (window.confirm('Registrar a liquidação e fixar os percentuais desta obra neste demonstrativo?')) {
          await executar('alltech_liquidar',{...base,demonstrativo:f});
        }
      }));
      raiz.append(liquidar);
    }
    const historico=estado.alltech.percentuais.filter(p=>p.obra_id===f.obra_id);
    if (!historico.length) return;
    const detalhes=elemento('details');
    detalhes.append(elemento('summary','Histórico de percentuais'));
    for (const v of historico) {
      const item=elemento('article',undefined,'alltech-item');
      item.append(elemento('strong','Versão '+v.versao+' · '+autor(v.autor_id)+' · '+dataTexto(v.registrado_em)));
      for (const p of f.participantes.filter(x=>x.id in v.pesos)) {
        item.append(elemento('p',p.nome+' · '+v.pesos[p.id]+(p.operador?' de peso':' pontos-base')));
      }
      detalhes.append(item);
    }
    raiz.append(detalhes);
  }
  function agenda() {
    raiz.append(elemento('h2','Compromissos'));
    formulario(raiz,'agenda','Cadastrar compromisso','alltech_agendar',form=>{
      campo(form,'descricao','Descrição',{required:true,maxLength:500});
      campo(form,'obra_id','Obra vinculada',{itens:[['','Sem vínculo'],...estado.obras.map(o=>[o.id,o.cliente])]});
      campo(form,'data','Data',{tipo:'date'});
      campo(form,'horario','Horário',{tipo:'time'});
    },d=>({...d,obra_id:d.obra_id||null,data:d.data||null,horario:d.horario||null}));
    if (!estado.alltech.agenda.length) raiz.append(elemento('p','Nenhum compromisso cadastrado.'));
    for (const a of estado.alltech.agenda) {
      const item=elemento('article',undefined,'alltech-item');
      item.append(elemento('strong',a.descricao),elemento('p',obraNome(a.obra_id)),
        elemento('p',[a.data?dataTexto(a.data):'Sem data',a.horario?.slice(0,5),a.concluido_em?'Concluído':'Pendente'].filter(Boolean).join(' · ')));
      if (!a.concluido_em) {
        const concluir=botao('Concluir compromisso');
        concluir.addEventListener('click',()=>envolver(()=>executar('alltech_concluir',{id:a.id})));
        item.append(concluir);
      } else item.append(elemento('p','Concluído por '+autor(a.concluido_por)+' · '+dataTexto(a.concluido_em)));
      raiz.append(item);
    }
  }
  function detalhe() {
    const obra=obraAtual();
    const f=estado.alltech.financeiro.find(o=>o.obra_id===obra.id);
    if (!f) return;
    demonstrativo(raiz,f);
    const local=estado.alltech.localizacoes[obra.id];
    formulario(raiz,'localizacao','Salvar localização estruturada','alltech_localizacao',form=>{
      const uf=campo(form,'uf','UF',{itens:[['','Selecione']]});
      preencherUF(uf);
      uf.value=local?.uf || '';
      campo(form,'cidade','Cidade',{valor:local?.cidade,maxLength:120});
    },d=>({...d,obra_id:obra.id,versao:local?.versao ?? 0}),local?.versao ?? 0);
  }
  function caixa() {
    const totais=Object.fromEntries(valores.map(([chave])=>[chave,
      estado.alltech.financeiro.reduce((s,f)=>s+BigInt(f[chave]),0n)]));
    demonstrativo(raiz,totais);
  }
  function desenhar(ignorar, preservar=true) {
    const rascunhos=new Map();
    if (preservar) for (const form of raiz.querySelectorAll('form')) {
      if (form.dataset.alltechForm!==ignorar && form.dataset.alterado==='sim') {
        rascunhos.set(form.dataset.alltechForm,{
          valores:[...form.elements].filter(e=>e.name).map(e=>[e.name,e.value]),
          versao:form.dataset.versaoOriginal ?? form.dataset.versao
        });
      }
    }
    raiz.replaceChildren();
    if (id==='agenda') agenda();
    else if (id==='detalhe') detalhe();
    else if (id==='caixa') caixa();
    else {
      const f=selecionarObra();
      if (f) (id==='adiantamentos'?adiantamentos:participacoes)(f);
    }
    for (const form of raiz.querySelectorAll('form')) {
      const rascunho=rascunhos.get(form.dataset.alltechForm);
      if (rascunho) {
        for (const [nome,valor] of rascunho.valores) {
          const controle=form.elements.namedItem(nome);
          if (controle) controle.value=valor;
        }
        form.dataset.alterado='sim';
        if (rascunho.versao!==form.dataset.versao) {
          form.dataset.desatualizado='sim';
          form.dataset.versaoOriginal=rascunho.versao;
          const aviso=elemento('p','Os dados mudaram em outra sessão. Confira a nova versão antes de salvar.');
          const descartar=botao('Descartar rascunho e conferir versão atual');
          descartar.addEventListener('click',()=>desenhar(form.dataset.alltechForm));
          form.append(aviso,descartar);
        }
      }
      form.addEventListener('input',()=>{form.dataset.alterado='sim';});
    }
  }
  return {
    renderizar(novo) {
      if (!novo.alltech) return;
      estado=novo;
      desenhar();
    }
  };
}
