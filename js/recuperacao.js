const PREFIXO='criativamc.operacao.v1:';
const ACOES=new Set(['criar_obra','atualizar_obra','registrar_movimento','solicitar_exclusao','decidir_exclusao',
  'alltech_criar_obra','alltech_localizacao','alltech_participante','alltech_percentuais','alltech_liquidar',
  'alltech_adiantar','alltech_solicitar_estorno','alltech_decidir_estorno','alltech_agendar','alltech_concluir']);
// The ONLY persisted fields are an opaque operation UUID, version and action.
// No amounts, descriptions, work IDs, request bodies or payload fingerprints.
export function criarRecuperacao(servicos,storage,locks) {
  function chave(usuario) { return PREFIXO+usuario; }
  function ler(usuario) {
    const raw=storage.getItem(chave(usuario));
    if(!raw)return null;
    const p=JSON.parse(raw);
    if(p.versao!==1 || !/^[0-9a-f-]{36}$/i.test(p.id) || !ACOES.has(p.acao) ||
       Object.keys(p).some(k=>!['versao','id','acao'].includes(k)))throw new Error('Registro de recuperação inválido; confira a operação no servidor.');
    return p;
  }
  async function exclusivo(usuario,fn) {
    if(!locks?.request || !storage)throw new Error('O navegador precisa permitir armazenamento de identificadores e bloqueios para salvar com segurança.');
    return locks.request(chave(usuario),fn);
  }
  return {
    recuperar(usuario) {return exclusivo(usuario,async()=>{
      const p=ler(usuario);return p?{...p,...await servicos.consultar(p.id,usuario)}:null;
    });},
    executar(usuario,acao,dados) {return exclusivo(usuario,async()=>{
      let p=ler(usuario);
      if(p) {
        const anterior=await servicos.consultar(p.id,usuario);
        if(anterior.estado!=='ausente')return {...p,...anterior,recuperada:true};
        if(p.acao!==acao)throw new Error('Existe uma tentativa anterior sem confirmação. Use Atualizar dados para conferi-la ou encerrá-la antes de iniciar outra ação.');
      } else {
        p={versao:1,id:crypto.randomUUID(),acao};
        // Persist BEFORE sending. Storage failure must prevent the write.
        storage.setItem(chave(usuario),JSON.stringify(p));
      }
      const resultado=await servicos.executar(acao,dados,p.id,usuario);
      return {...p,estado:'concluida',resultado,recuperada:false};
    });},
    confirmar(usuario,id) {return exclusivo(usuario,async()=>{
      if(ler(usuario)?.id===id)storage.removeItem(chave(usuario));
    });},
    encerrar(usuario) {return exclusivo(usuario,async()=>{
      const p=ler(usuario);return p?{...p,...await servicos.encerrar(p.id,usuario)}:null;
    });}
  };
}
