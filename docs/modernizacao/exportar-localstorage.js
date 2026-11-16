// Executar MANUALMENTE no navegador da origem que contém os dados legados.
// Não é carregado pelo aplicativo. Não importa, normaliza, grava ou apaga dados.
// O arquivo contém TODAS as chaves da origem: guardar em local privado, fora do Git.
(async () => {
  const origemEsperada = 'https://brandao1974.github.io';
  if (location.origin !== origemEsperada) {
    throw new Error('Origem incorreta. Abra o app publicado no perfil com os dados.');
  }
  const chavesAntes = Object.keys(localStorage).sort();
  const valoresBrutos = Object.fromEntries(
    chavesAntes.map(chave => [chave, localStorage.getItem(chave)])
  );
  const chavesDepois = Object.keys(localStorage).sort();
  if (JSON.stringify(chavesAntes) !== JSON.stringify(chavesDepois) ||
      chavesAntes.some(chave => localStorage.getItem(chave) !== valoresBrutos[chave])) {
    throw new Error('Dados mudaram durante a leitura. Feche outras abas e tente de novo.');
  }
  const conteudo = JSON.stringify({
    formato: 'app-criativaMC-localstorage-bruto-v1',
    exportadoEm: new Date().toISOString(),
    origem: location.origin,
    pagina: location.pathname,
    valoresBrutos
  }, null, 2);
  const bytes = new TextEncoder().encode(conteudo);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const nome = `app-criativaMC-bruto-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  function baixar(texto, arquivo, tipo) {
    const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
    const link = document.createElement('a');
    link.href = url;
    link.download = arquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  baixar(conteudo, `${nome}.json`, 'application/json;charset=utf-8');
  baixar(`${hash}  ${nome}.json\n`, `${nome}.sha256`, 'text/plain;charset=utf-8');
  console.info('Exportação solicitada. Confira os dois downloads e preserve-os fora do Git.');
})().catch(() => {
  console.error('Exportação não concluída. Confira origem, conexão segura e estabilidade das abas. Nenhum dado foi alterado.');
});
