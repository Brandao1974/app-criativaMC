import { textoParaCentavos } from './dinheiro.js';
const STATUS=['Negociacao','Fechada','Em Producao','Agendada','Em Execucao','Finalizada'];
const normalizar=s=>({'Negociação':'Negociacao','NegociaÃ§Ã£o':'Negociacao','Em Produção':'Em Producao','Em ProduÃ§Ã£o':'Em Producao','Em Execução':'Em Execucao','Em ExecuÃ§Ã£o':'Em Execucao'}[s] || s);
function dataValida(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const d=new Date(`${data}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===data;
}
// Pure converter: input stays untouched; no database/storage/network access.
export function planejarImportacao(snapshot, origemId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(origemId)) throw new Error('Origem deve ser UUID aprovado e estável.');
  if(snapshot.formato!=='app-criativaMC-localstorage-bruto-v1' || typeof snapshot.valoresBrutos?.obras!=='string')throw new Error('Exportação bruta inválida.');
  const obras=JSON.parse(snapshot.valoresBrutos.obras);
  if(!Array.isArray(obras))throw new Error('obras deve ser uma lista.');
  const quarentena=[],validas=[],avisos=[];
  let entradas=0n,custos=0n,movimentos=0,eventos=0;
  const ids=new Map();
  obras.forEach((bruto,i)=>{
    const caminho=`obras[${i}]`;
    try {
      if(!bruto || typeof bruto!=='object' || Array.isArray(bruto))throw new Error('Obra inválida.');
      const id=bruto.id == null ? `sem-id-indice:${i}` : String(bruto.id);
      const ocorrencia=ids.get(id) || 0;ids.set(id,ocorrencia+1);
      const chave=`obra:${id}:ocorrencia:${ocorrencia}`;
      if(bruto.id == null || ocorrencia)avisos.push({caminho,motivo:'Identidade ausente/repetida; índice depende de snapshot congelado.'});
      if(typeof bruto.cliente!=='string' || !bruto.cliente.trim() || bruto.cliente.trim().length>200)throw new Error('Cliente inválido.');
      const status=normalizar(bruto.status);
      if(!STATUS.includes(status))throw new Error('Status desconhecido.');
      if(bruto.dataExecucao && !dataValida(bruto.dataExecucao))throw new Error('Data de execução inválida.');
      if(bruto.historico != null && !Array.isArray(bruto.historico))throw new Error('Histórico inválido.');
      const convertido={cliente:bruto.cliente.trim(),descricao:bruto.descricao || null,localizacao:bruto.localizacao || null,
        responsavel_cliente:bruto.responsavelCliente || null,valor_centavos:textoParaCentavos(bruto.valor,{zero:true,legado:true}),
        status,data_execucao:bruto.dataExecucao || null,movimentos:[]};
      let e=0n,c=0n;
      for(const [lista,tipo] of [['entradas','entrada'],['custos','custo']]) {
        if(bruto[lista]!=null && !Array.isArray(bruto[lista]))throw new Error(`${lista} deve ser uma lista.`);
        for(const [j,m] of (bruto[lista] || []).entries()) {
          if(!m || typeof m.descricao!=='string' || !m.descricao.trim() || m.descricao.trim().length>500)throw new Error(`${lista}[${j}]: descrição inválida.`);
          const valor_centavos=textoParaCentavos(m.valor,{legado:true});
          convertido.movimentos.push({tipo,categoria:tipo==='custo'?(m.tipo || null):null,descricao:m.descricao.trim(),valor_centavos,bruto:m});
          if(tipo==='entrada')e+=BigInt(valor_centavos);else c+=BigInt(valor_centavos);
          if(m.deleteRequest?.gustavo || m.deleteRequest?.ivan)avisos.push({caminho:`${caminho}.${lista}[${j}]`,motivo:'Assinatura legada não verificada; não aprovar automaticamente.'});
        }
      }
      // Atomic per obra: a bad child quarantines the whole obra. No partial cash.
      entradas+=e;custos+=c;movimentos+=convertido.movimentos.length;eventos+=(bruto.historico || []).length;
      validas.push({origem_id:origemId,chave,convertido,bruto});
    } catch(erro) {quarentena.push({caminho,motivo:erro.message,bruto});}
  });
  let caixa=null;
  try {
    const s=snapshot.valoresBrutos.caixa;
    const negativo=String(s).trim().startsWith('-');
    caixa=BigInt(textoParaCentavos(negativo?String(s).trim().slice(1):s,{zero:true,legado:true}))*(negativo?-1n:1n);
  }catch{avisos.push({caminho:'caixa',motivo:'Caixa escalar inválido ou ausente; preservado sem ajuste.'});}
  return {versao:'1',origem_id:origemId,validas,quarentena,avisos,
    totais:{obras_brutas:obras.length,obras_validas:validas.length,movimentos,eventos,
      entradas_centavos:String(entradas),custos_centavos:String(custos),saldo_centavos:String(entradas-custos),
      caixa_legado_centavos:caixa===null?null:String(caixa),divergencia_centavos:caixa===null?null:String(caixa-(entradas-custos))}};
}
