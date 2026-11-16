# app-criativaMC — implementação local da modernização

PWA de obras com financeiro compartilhado entre Ildebrando, Edson e Ivan.
Somente Ildebrando administra usuários; Gustavo não recebe acesso.

**Versão atual v3:** [instalação segura e distribuição](docs/modernizacao/INSTALACAO-E-DISTRIBUICAO.md).
O plano de três operadores foi implementado localmente. As descrições v1/v2
abaixo são históricas: a autoridade atual é `public.operadores`, com admissão
de sessão real do Auth e geração de acesso. A migração v3 substitui as consultas
legadas a `app_membros` e mantém o financeiro e o histórico.
O código desta branch ainda não foi publicado. Não execute migrações remotas
ou importações reais sem autorização específica.

Rodada corretiva: [procedimento administrativo](docs/modernizacao/IMPORTACAO-ADMINISTRATIVA.md)
e [relatório corretivo](docs/modernizacao/RODADA-CORRETIVA.md). A segunda migração
preserva o SQL v1 já revisado. A recuperação de tentativas usa somente UUID/tipo
da ação no armazenamento do navegador; valores e payloads ficam no servidor.

## Executar a verificação local

Requisitos: Node 22.19+ e npm. Dependências têm versões fixadas e lockfile.

```powershell
npm ci
npm run build
npm test
npm run test:native:isolated
npm run test:auth:isolated
npm run test:access:isolated
node scripts/preparar-distribuicao.mjs
npm run serve
```

`npm test` usa PostgreSQL embarcado PGlite em memória com dados sintéticos.
Não se conecta ao Supabase. O schema Auth do teste é um stub de `auth.uid()` e
papéis PostgreSQL; não equivale a executar o serviço Auth/GoTrue.

`npm run serve` oferece apenas os arquivos públicos do app em
`http://127.0.0.1:4173`. Não serve database/, tests/, node_modules/ nem .local/.
A configuração em `js/config.js` está vazia por intenção; a página mostra essa
pendência e não permite operações. Nenhuma credencial antiga é utilizada.

## Banco

A migração gerada está em
`supabase/migrations/20261115194547_collaborative_ledger.sql`.
Fontes v1: `database/schema.sql`, `operations.sql`, `import.sql`, `access.sql`.
Correções adicionais: `database/corrective.sql`, gerando
`supabase/migrations/20261116003827_corrective_review.sql` por
`node scripts/build-corrective.mjs`. Aplicar as migrações em ordem.
`node scripts/build-migration.mjs` regenera a cópia enquanto esta versão ainda
não foi aplicada a ambiente persistente. Depois disso, alterações exigem NOVA
migração criada pela CLI; não editar o conteúdo de uma versão aplicada.

O SQL completo é transacional, registra versão/checksum, ignora reaplicação do
mesmo conteúdo e recusa o mesmo número com conteúdo diferente. Não serve para
converter bancos já criados com os quatro SQL privados do OpenBot; destina-se
ao projeto exclusivo novo, cuja criação permanece não autorizada nesta etapa.
Não usa owner_id. v1/v2 tinham dois lugares em `app_membros`; v3 usa diretório
fechado dos três operadores e preserva a tabela antiga somente como histórico.

Operações expostas:

- `ler_estado()` retorna um snapshot compartilhado consistente e dinheiro textual.
- `executar(p_acao, p_dados, p_operacao)` aceita somente ações/campos permitidos.
- Ações: criar_obra, atualizar_obra, registrar_movimento, solicitar_exclusao,
  decidir_exclusao. registrar_movimento admite corrige_id de original já revertido.
- Operador fornece uma UUID de operação para retry; mesma UUID com payload
  diferente falha. Autor, data, decisão e valor de estorno não são livres.
- A aprovação só pelo outro lugar ativo gera um estorno integral, junto da
  decisão, do estado do pedido e da auditoria na mesma transação.
- Tabelas expostas têm RLS e apenas SELECT para authenticated; não há DML direto.
  Funções públicas são invoker, implementações privilegiadas ficam em private.
- Originais, estornos, decisões, eventos e auditoria não são editáveis/apagáveis.
  Constraints deferred conferem o elo entre pedido, decisão, original e reversão.

Não expor o schema private na Data API. Provisionamento futuro deve criar as
duas contas Auth e associar seus UUIDs a profiles/app_membros administrativamente;
não há autocadastro/autorização por user_metadata. Sem contas reais nesta entrega.

## Concorrência nativa

O wrapper PostgreSQL nativo instalado permite rodar uma instância isolada,
sem instalar serviços: `npm run test:native:isolated`. O banco é encerrado
ao terminar; arquivos sintéticos/logs ficam em .local/ para inspeção.
A suíte também aceita uma instância local descartável já disponível por
`LOCAL_PG_URL` apontando para loopback:

```powershell
$env:LOCAL_PG_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres'
npm run test:postgres
```

Use instância local descartável e usuário com CREATEDB/CREATEROLE. A suíte cria
uma database `codex_criativa_<aleatorio>` e dois papéis com sufixo aleatório;
remove apenas esses recursos ao terminar. Recusa hosts remotos. Não apontar para
base operacional nem compartilhar credenciais nos arquivos. O teste concorrente
usa conexões independentes para criação repetida, pedidos simultâneos,
aprovar/rejeitar concorrentes e repetição da aprovação. PGlite não prova esses locks.

## Legado

`docs/modernizacao/exportar-localstorage.js` preserva strings brutas e checksum,
sem escrever no storage. Ainda não foi executado em navegador com dados reais.
O planejador offline não conecta a banco:

```powershell
node scripts/importar-legado.mjs CAMINHO-BACKUP.json UUID-ORIGEM .local/revisao
```

Isso produz plano, quarentena e totais, sem alterar o arquivo original. Origem
deve ser uma UUID canônica fixa aprovada. IDs repetidos/ausentes exigem snapshot
congelado; bases de navegadores diferentes precisam de reconciliação antes de
compartilhar identidade. Uma obra com filho inválido fica inteira em quarentena.

`private.importar_obra()` e `private.conferir_importacao()` são administrativas,
sem grants de cliente ou RPC pública. Há testes sintéticos de atomicidade,
idempotência entre operadores e reconciliação. Não há botão de importação nem
script que aplique dados reais automaticamente. Informações de autoria/data e
assinaturas locais ficam identificadas como legado não verificado, sem fabricar
eventos autenticados. Nunca incluir backups ou planos reais neste repositório.

## Frontend e PWA

As sete páginas mantêm o CSS, cards e navegação existentes. Entrada de usuário
substitui a identidade local; gateway traduz o nome para Auth. SDK cuida de sessão/refresh e seu token
é o único estado persistente de autenticação. Dados financeiros ficam somente
em memória e no banco. Não se apagam as quatro chaves antigas automaticamente.
Há botão Atualizar dados para recarregar a base do outro operador.

Textos usam DOM/textContent; handlers inline foram removidos. Chart.js e
Supabase são distribuídos localmente com versões fixadas. Confetes da agenda
foram preservados com pausa em aba oculta e preferência por movimento reduzido.
CSP limita scripts à própria origem e conexões ao Supabase/endpoint local.

`node scripts/build-pwa.mjs` calcula versão do shell por hash dos assets.
Atualizações esperam confirmação e término de operações; o cache não intercepta
Auth/API, não grava dados financeiros e não remove caches de outros apps da
origem. Sem rede, gravações falham explicitamente; não há fila offline.

Após configurar URL/chave pública em etapa autorizada, reconstruir o PWA.
Jamais inserir service_role, sb_secret ou senha em config.js. Recuperação de
administrativa é feita por CLI segura preservando UUID, conforme runbook v3.
Testes de Auth real são executados somente em ambiente local isolado.

Para a stack nativa de Auth/PostgREST no Windows, preparar as ferramentas
portáteis com `./scripts/preparar-auth-local.ps1` e executar
`npm run test:auth:isolated`. O script fixa versões/checksums e documenta a
adaptação de socket do GoTrue para Windows. Cria apenas fixtures locais `.test`.
Não configura o navegador, SMTP ou projetos remotos.

A UI usa `executar_com_identidade` e `recuperar_operacao` para impedir que uma
troca de conta atribua uma tentativa pendente ao operador errado. O registro
local contém apenas `{versao,id,acao}`; não contém valores ou payloads financeiros.
São necessários armazenamento local e Web Locks. Na indisponibilidade deles,
a gravação falha antes do envio. Em resultado incerto, Atualizar dados permite
consultar ou encerrar a tentativa; o encerramento no servidor bloqueia envio tardio.

Resultados atuais: [RODADA-CORRETIVA.md](docs/modernizacao/RODADA-CORRETIVA.md).
Histórico da primeira implementação: [IMPLEMENTACAO-LOCAL.md](docs/modernizacao/IMPLEMENTACAO-LOCAL.md).
