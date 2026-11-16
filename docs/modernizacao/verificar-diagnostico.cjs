// Diagnóstico seguro: executa o código legado em VM com storage/DOM sintéticos.
// Não é teste do sistema Supabase futuro e não lê dados de navegador real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const raiz = path.resolve(__dirname, '../..');
// Pin historical evidence; the current frontend no longer runs this legacy code.
const fonte = require('node:child_process').execFileSync('git', ['show', '157f8f6:js/obras.js'], { cwd: raiz, encoding: 'utf8' });
function legado(dados) {
  const storage = new Map(Object.entries(dados));
  const contexto = vm.createContext({
    localStorage: {
      getItem: chave => storage.has(chave) ? storage.get(chave) : null,
      setItem: (chave, valor) => storage.set(chave, String(valor))
    },
    window: { location: { pathname: '/obras.html' } },
    document: { getElementById: () => null }
  });
  vm.runInContext(fonte, contexto);
  return { storage, contexto };
}
(async () => {
  const obra = {
    id: 1, cliente: 'Fixture', status: 'Negociacao', valor: 1000,
    entradas: [{ id: 10, descricao: 'Recebimento', valor: 1000, deleteRequest: {} }],
    custos: [{ id: 20, descricao: 'Material', valor: 300, deleteRequest: { gustavo: true, ivan: false } }],
    historico: []
  };
  const teste = legado({ usuarioLogado: 'Ivan', obraSelecionada: '1', obras: JSON.stringify([obra]), caixa: '700' });
  vm.runInContext('carregarDetalhe = () => {}; solicitarExclusao("custos", 20)', teste.contexto);
  const depois = JSON.parse(teste.storage.get('obras'))[0];
  assert.equal(depois.custos.length, 0);
  assert.equal(teste.storage.get('caixa'), '700');
  assert.equal(depois.entradas.reduce((s, m) => s + m.valor, 0), 1000);
  console.log('CONFIRMADO: exclusão aprovada deixa caixa em 700 e razão em 1000.');
  assert.equal(vm.runInContext('converterMoeda("1.234")', teste.contexto), 1.234);
  assert.equal(vm.runInContext('converterMoeda("-300")', teste.contexto), -300);
  console.log('CONFIRMADO: parser aceita valor negativo e interpreta 1.234 como fração.');
  const bruto = '[{"id":2,"cliente":"Fixture","status":"Negociação"}]';
  const leitura = legado({ usuarioLogado: 'Gustavo', obras: bruto });
  vm.runInContext('obterObras()', leitura.contexto);
  assert.notEqual(leitura.storage.get('obras'), bruto);
  console.log('CONFIRMADO: obterObras regrava o JSON durante leitura.');

  const dados = { obras: ' [ { "id":1, "valor":"1.234" } ] ', caixa: '700', desconhecida: '{invalido' };
  const original = JSON.stringify(dados);
  const downloads = [];
  const blobs = [];
  const exportador = fs.readFileSync(path.join(__dirname, 'exportar-localstorage.js'), 'utf8');
  await vm.runInNewContext(exportador, {
    location: { origin: 'https://brandao1974.github.io', pathname: '/app-criativaMC/login.html' },
    localStorage: new Proxy(dados, { get: (alvo, chave) => chave === 'getItem' ? k => alvo[k] ?? null : alvo[chave] }),
    crypto: webcrypto, TextEncoder, Uint8Array, Blob,
    URL: { createObjectURL: blob => { blobs.push(blob); return `blob:${blobs.length}`; }, revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }) },
    setTimeout() {}, console: { info() {}, error() { throw new Error('Exportador falhou'); } }
  });
  assert.equal(JSON.stringify(dados), original);
  assert.equal(downloads.length, 2);
  const jsonExportado = await blobs[0].text();
  const checksum = await blobs[1].text();
  assert.deepEqual(JSON.parse(jsonExportado).valoresBrutos, dados);
  const hash = require('node:crypto').createHash('sha256').update(jsonExportado).digest('hex');
  assert.equal(checksum, `${hash}  ${downloads[0]}\n`);
  console.log('VERIFICADO: exportador preserva strings/chaves desconhecidas e hash; storage intacto (VM).');
})().catch(erro => { console.error(erro); process.exitCode = 1; });
