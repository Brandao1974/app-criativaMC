export function criarServicos(client, gateway) {
  let geracao = 0;
  let ultimoUsuario = null;
  const listeners = new Set();
  function invalidar() {
    geracao++;
    for(const listener of listeners)listener();
  }
  client.auth.onAuthStateChange((evento, sessao) => {
    const id = sessao?.user?.id ?? null;
    if (evento === 'SIGNED_OUT' || (ultimoUsuario && ultimoUsuario !== id)) {
      invalidar();
    }
    ultimoUsuario = id;
    // Outside the SDK callback/lock: refresh is not a new authorization grant.
    if(evento==='TOKEN_REFRESHED' && id)setTimeout(()=>{void ler().catch(()=>{});},0);
  });
  async function ler() {
    const versao = geracao;
    const { data, error } = await client.rpc('ler_estado');
    if (error) {
      if(error.code==='42501' || error.code==='PGRST301' || error.status===401)invalidar();
      throw error;
    }
    if (versao !== geracao) throw new Error('Sessão mudou. Entre novamente.');
    return data;
  }
  return {
    aoSair(fn) { listeners.add(fn); },
    async entrar(usuario, password) {
      if(!gateway)throw new Error('Gateway de acesso não configurado.');
      const tokens=await gateway('login',{usuario,senha:password});
      const { error } = await client.auth.setSession(tokens);
      if (error) throw error;
      try { return await ler(); }
      catch (error) { await client.auth.signOut({ scope: 'local' }); throw error; }
    },
    async ativar(usuario,codigo,senha) { return gateway('ativar',{usuario,codigo,senha}); },
    async administrar(acao,dados={}) {return gateway(acao,dados,true);},
    async sessao() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) return null;
      ultimoUsuario = data.session.user.id;
      return ler();
    },
    ler,
    async lerAlltech(usuario) {
      const versao=geracao;
      const {data,error}=await client.rpc('alltech_ler');
      if (error) {
        if(error.code==='42501' || error.code==='PGRST301' || error.status===401) invalidar();
        throw error;
      }
      if (versao!==geracao || data.usuario_id!==usuario) throw new Error('Sessão mudou. Entre novamente.');
      return data;
    },
    async executar(acao, dados, operacao, usuarioEsperado=ultimoUsuario) {
      const versao=geracao;
      const nova = acao.startsWith('alltech_');
      const { data, error } = await client.rpc(nova?'alltech_executar':'executar_com_identidade', {
        [nova?'p_usuario':'p_usuario_esperado']:usuarioEsperado,p_acao: acao, p_dados: dados, p_operacao: operacao });
      if (error) throw error;
      if(versao!==geracao)throw new Error('Sessão mudou. Confira a operação ao entrar novamente.');
      return data;
    },
    async consultar(id,usuarioEsperado=ultimoUsuario) {
      const versao=geracao;
      const {data,error}=await client.rpc('recuperar_operacao',{p_usuario_esperado:usuarioEsperado,p_operacao:id,p_encerrar:false});
      if(error)throw error;
      if(versao!==geracao)throw new Error('Sessão mudou. Entre novamente.');
      return data;
    },
    async encerrar(id,usuarioEsperado=ultimoUsuario) {
      const versao=geracao;
      const {data,error}=await client.rpc('recuperar_operacao',{p_usuario_esperado:usuarioEsperado,p_operacao:id,p_encerrar:true});
      if(error)throw error;
      if(versao!==geracao)throw new Error('Sessão mudou. Entre novamente.');
      return data;
    },
    async sair() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }
  };
}
export function mensagemErro(error) {
  if (error?.code === '42501') return 'Acesso não autorizado para este operador.';
  if (error?.code === '40001' || error?.code === 'PT409') return 'A obra mudou em outra sessão. Recarregue antes de salvar.';
  if (error?.code === '23505') return 'Já existe uma solicitação ou operação para este registro. Recarregue.';
  if (error?.code === '23514') return 'Operação incompatível com o estado atual. Recarregue e confira os dados.';
  if (error?.status === 400 || error?.code === 'invalid_credentials') return 'Usuário, senha ou código inválidos.';
  if (error?.status === 429) return 'Muitas tentativas. Aguarde e tente novamente.';
  return 'Não foi possível concluir. Confira os campos e a conexão e tente novamente.';
}
