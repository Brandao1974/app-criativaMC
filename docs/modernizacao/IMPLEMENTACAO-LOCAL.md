# Entrega da implementação local

15/11/2026 — branch `codex/modernizacao-supabase`.
Autorização utilizada: implementação e testes locais após revisão de Zyra.
Nenhum projeto remoto foi criado/modificado; nenhuma conta ou dado real foi
utilizado. Sem commit, push, merge ou publicação. O app publicado não foi afetado.

## Arquivos implementados

| Grupo | Arquivos | Conteúdo |
|---|---|---|
| Migração completa | `supabase/migrations/20261115194547_collaborative_ledger.sql` | DDL, funções, triggers, constraints, índices, views, RLS/grants e versionamento/checksum em transação |
| Fontes SQL | `database/schema.sql`, `operations.sql`, `import.sql`, `access.sql` | Modelo compartilhado; comandos atômicos; importação administrativa; exposição mínima |
| Integração | `js/bootstrap.js`, `config.js`, `servicos.js`, `app.js`, `ui.js`, `dinheiro.js` | SDK Auth, sessão/guard, leitura consistente, operações idempotentes e renderização segura |
| Páginas | os sete HTMLs existentes e pequeno acréscimo em `css/style.css` | Layout/cards/navegação preservados; e-mail/senha em form; estados de carga/erro e Atualizar dados; remoção de handlers inline |
| Compatibilidade | `js/auth.js`, `obras.js`, `dashboard.js`, `caixa.js`, `agenda.js` | Entradas antigas encaminham ao bootstrap; não contêm credenciais nem financeiro em localStorage |
| PWA/visuais | `sw.js`, `js/pwa.js`, `js/agenda-efeitos.js`, `js/vendor/` | Build coerente, cache apenas do shell, Chart.js/Supabase locais com versão fixa, confetes preservados |
| Migração do legado | `js/importacao.js`, `scripts/importar-legado.mjs` | Conversor puro e dry-run offline, quarentena, totais, preservação do bruto e hash da fonte |
| Ferramentas | `scripts/build-migration.mjs`, `vendor.mjs`, `build-pwa.mjs`, `serve.mjs` | Build local reproduzível, hash PWA e servidor de prévia com exposição limitada |
| Dependências | `package.json`, `package-lock.json`, `.gitignore` | Versões fixadas e exclusão de artefatos privados/node_modules |
| Testes | `tests/database.test.mjs`, `import.test.mjs`, `auth.test.mjs`, `ui.test.mjs`, `pwa.test.mjs`, `harness.mjs` | Banco isolado, serviços, importação, DOM e cache |
| Testes adicionais | `tests/native/concurrency.test.mjs`, `auth-api.test.mjs` | Conexões PostgreSQL independentes e SDK/GoTrue/PostgREST reais em loopback |
| Uso | `README.md` | Comandos, configuração, contratos, isolamento e limites |

Os documentos da primeira entrega foram preservados como histórico da proposta.
Este documento descreve a implementação atual. O reproducer do defeito antigo
passou a ler o commit legado fixo `157f8f6`, pois o frontend atual foi substituído.

## Garantias implementadas no banco

Gustavo e Ivan têm UUIDs distintos em dois lugares fixos de `app_membros`.
Ambos veem as mesmas linhas. Autenticação sem vínculo ativo não autoriza acesso,
inclusive quando nome/user_metadata são forjados. Perfis não armazenam senhas.

Escritas diretas de clientes são revogadas. `public.executar()` é invoker e
encaminha para implementação privada definer que revalida a identidade/vínculo
e aplica allowlist de ações/campos. `search_path` fixo, objetos qualificados e
EXECUTE revogado de PUBLIC/anon. `private` não deve ser exposto na Data API.

Solicitar não muda o saldo. Aprovar/rejeitar exige UUID e lugar diferentes do
solicitante. Aprovação gera estorno integral da mesma obra, com tipo oposto;
original não desaparece. Estado, decisão, estorno e auditoria confirmam juntos
ou fazem rollback juntos. Índice permanente impede segundo estorno. Constraint
deferred verifica o elo cruzado e impede estorno sem decisão no commit.

Operações têm chave idempotente por ator e payload JSONB. Mesma chave/conteúdo
retorna o resultado anterior; mudança de conteúdo falha. Locks no original e no
pedido têm ordem consistente; retry de decisão equivalente não reverte duas vezes.
Atualização de obra usa versão esperada, impedindo sobrescrita silenciosa.
Correção referencia original já revertido; não reescreve valor de lançamento.

Valores de linhas usam bigint; totais são calculados no SQL e transportados
como strings decimais. O cliente usa BigInt para exibição exata. Reversão de
custo reduz custos líquidos, sem inflar receitas operacionais.

Importação administrativa não tem grant para authenticated. Uma obra e seus
filhos entram atomicamente; identidade é por origem/chave, independente do
operador. Conteúdo diferente na mesma identidade exige revisão. Hash da fonte
e manifesto são preservados; reconciliação compara contagens e valores antes
de marcar o lote conferido. Nenhuma importação real foi feita.

Autoria/data originais, histórico e booleanos do legado permanecem evidência
não verificada, separados do ator/instante de importação. Não fabricam decisões
Auth. Pendência antiga exige confirmação por nova solicitação. O conversor não
adivinha `1.234`, não ajusta caixa e põe a obra inteira em quarentena se um filho
financeiro for inválido, evitando saldo parcialmente importado.

## Testes executados e resultados

Ambiente: Node 22.19.0, Supabase CLI 3.1.0 (somente geração de arquivo local),
PGlite 0.5.16 em memória, jsdom 26.1.0. SDK Supabase 2.119.0; Chart.js 4.5.1.
Não foram encontrados psql/postgres/initdb/Docker nos locais/PATH consultados.

`npm test`: **29 aprovados, 0 falhas, 0 ignorados**.
Saída: [TESTES-LOCAIS.txt](TESTES-LOCAIS.txt).

- 13 casos de banco: reaplicação/checksum, acesso compartilhado, bloqueio de
  terceiros/metadados, precisão/valores inválidos, pendência sem efeito financeiro,
  autoaprovação/rejeição própria, aprovação/retry, rejeição inversa, rollback,
  versão concorrente, DML/função administrativa bloqueados, triggers, desativação
  e catálogo de RLS/funções. Incluem vetor 199975, 10 mil centavos e total
  9999999999990000 transportado sem perda. Cada caso pode conter várias asserções.
- 5 casos de conversão/importação: parser estrito, formato além de Number,
  preservação do bruto/categoria/pendências, quarentena, repetição entre operadores,
  reconciliação SQL e rollback/retomada de obra com filho inválido.
- 4 casos de Auth com SDK simulado: encaminhamento de credenciais, erro de senha,
  autorização pelo banco, logout, ausência de sessão e resposta em voo invalidada
  ao trocar de identidade. Não são logins reais no GoTrue.
- 6 casos DOM: sete HTMLs, criação/XSS, entrada/custo/pedido/aprovação entre
  operadores com SQL real embarcado, status/agenda/histórico, saldo entre telas,
  limpeza no logout, login/form/index e nova tentativa após acesso negado.
  jsdom não renderiza pixels/canvas: foi testada a degradação do gráfico sem
  contexto gráfico, não sua aparência final.
- 1 caso PWA em VM: todos os arquivos do shell existem, atualização não ativa
  sozinha, caches alheios preservados e Auth/API fora da interceptação.

Também executados:

- `node --check` nos scripts da aplicação: sem erros.
- `git diff --check`: sem erro de whitespace (apenas aviso de conversão LF/CRLF).
- Bundle local gerado com esbuild; versão PWA derivada dos arquivos do shell.
- Servidor de prévia: login/bootstrap/bundle retornaram 200; database/, .local/
  e node_modules/ retornaram 404. Isso não substitui testes visuais de navegador.
- Reproducer histórico confirmou a divergência antiga de caixa e a exportação
  sintética sem alterar storage. Nenhum armazenamento real foi lido.

## Testes preparados, mas pendentes

`npm run test:postgres`: **7 ignorados por ausência dos ambientes/fixtures;
0 aprovados, 0 falhas**. Saída: [TESTES-PENDENTES.txt](TESTES-PENDENTES.txt).

1. Três testes PostgreSQL nativo: duas conexões criando com a mesma chave;
   pedidos e aprovar/rejeitar concorrentes; duas aprovações simultâneas.
   Exigem LOCAL_PG_URL loopback. Não alegar que PGlite serializado prova locks.
2. Quatro testes SDK + GoTrue/PostgREST: senha inválida, dois logins e mesma
   base, terceiro/DML direto bloqueados, logout e acesso anônimo recusado.
   Exigem stack Supabase local isolado e três fixtures `.test` já provisionadas.
   Variáveis estão no cabeçalho de tests/native/auth-api.test.mjs. Não criam contas.

Também pendentes: refresh/expiração e revogação reais; comportamento HTTP exato
de PostgREST/advisors; CSP, Chart.js, PWA e atualização em múltiplas abas em
navegador real; revisão visual/responsiva e dispositivos dos operadores.
Recuperação de senha/SMTP não faz parte da tela legada e ainda não foi implementada.

## Decisões e limites para avançar

- Não há decisão bloqueando os testes já preparados: rodar concorrência nativa
  requer disponibilizar uma instância PostgreSQL local descartável.
- URL/chave pública em config.js continuam vazias. Para testar Auth real,
  preparar stack Supabase **local isolada**, fixtures e vínculo dos operadores.
  Nenhum projeto remoto foi selecionado/reutilizado.
- Validar visualmente as sete telas e o PWA antes de qualquer liberação. Os
  testes DOM são funcionais e não constituem comparação visual de screenshots.
- O snapshot de leitura contém a base inteira para manter simplicidade e
  consistência do app atual; volumes muito maiores exigirão paginação por tela.
- O identificador de retry fica em memória enquanto a página permanece aberta;
  em resultado de rede incerto, repetir nessa página preserva a UUID. Depois de
  recarregar/fechar, conferir o extrato antes de repetir o lançamento como novo.
- Auditoria de sucesso é transacional; tentativas negadas dependem de logs de
  Auth/API/servidor. Não são gravadas como sucesso após rollback.
- Antes de dados reais: confirmar origem canônica, exportações/hash, quarentena,
  autoria legada não verificada e reconciliação. Sem ajustes artificiais.
- Projeto remoto, contas reais, importação, commit/push e publicação continuam
  sujeitos a autorização futura e não foram executados.
