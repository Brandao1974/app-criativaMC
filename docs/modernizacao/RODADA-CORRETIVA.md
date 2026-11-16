# Rodada corretiva — resultado

15/11/2026, America/Sao_Paulo. Branch `codex/modernizacao-supabase`.
Escopo: os cinco pontos da revisão estática de Zyra. Nenhum recurso remoto,
dado real, conta real, commit, push ou publicação. Somente fixtures locais.

**Resultado final: 54 testes aprovados, zero falhas e zero testes ignorados nas
três execuções finais.** Os processos temporários foram encerrados.

## Alterações e linhas

Referência da comparação: ZIP enviado à Zyra, SHA-256
`8817c9c09e48da4406f8389ae579eb2222d90789107058cdc9d28988a22de0b0`.
Comparação byte a byte confirmou que os sete HTMLs, CSS e migração SQL v1
permanecem iguais àquele pacote. Não houve alteração estética.

| Arquivo e linhas atuais | Alteração |
|---|---|
| database/corrective.sql:3 | Índice único permanente de corrige_id |
| database/corrective.sql:5 | Validação de correção da mesma natureza/obra e original já revertido |
| database/corrective.sql:33 | Lock compartilhado de manutenção nas operações normais |
| database/corrective.sql:121 | Principal PostgreSQL registrado nos lotes |
| database/corrective.sql:122 | Allowlist privada e temporária para importação |
| database/corrective.sql:131 | Identidade importadora obtida do session_user; prazo, vínculo e atividade obrigatórios |
| database/corrective.sql:154 | Rotinas administrativas definer restritas; identidade para auditoria definida pelo servidor e claim anterior restaurada |
| database/corrective.sql:246 | Consulta transacional de UUID e resultado, sem retornar payload financeiro |
| database/corrective.sql:261 | Encerramento durável que impede requisição tardia |
| database/corrective.sql:293 e :303 | Escrita/recuperação vinculadas à identidade esperada; troca de conta não troca o ator da tentativa |
| supabase/migrations/20261116003827_corrective_review.sql:1 | Segunda migração completa, transacional e com checksum; v1 permanece intacta |
| scripts/aplicar-importacao-local.mjs:7, :16 e :33 | Verificação do backup/plano, execução/reconciliação em uma transação e CLI restrita a loopback |
| js/recuperacao.js:1–44 | Diário mínimo de tentativas, recuperação após reload e exclusão mútua entre abas por Web Locks |
| js/app.js:12, :37–64, :207 e :251 | Integração com a recuperação, consulta/encerramento pelo botão existente e limpeza do formulário confirmado |
| js/servicos.js:5–24 e :44–63 | Revalidação após refresh, invalidação de dados sem autorização, proteção de respostas após troca de conta e RPCs vinculadas ao ator |
| sw.js:1 e lista SHELL | Novo hash de build e inclusão de recuperacao.js; sem mudança visual |
| tests/harness.mjs:15–23 | Aplicação das duas migrações e fixture administrativa explícita |
| tests/corrective.test.mjs:1–99 | Regressão v1, cadeia de correções, rede incerta, reload, tombstone, abas e storage bloqueado |
| tests/auth.test.mjs:39–61 | Refresh, revogação e resposta de escrita após troca de usuário |
| tests/ui.test.mjs:10–23 e :110–125 | Storage/locks de teste e reload com resposta perdida |
| tests/native/concurrency.test.mjs:86–168 | Login administrativo real, mínimo privilégio, rollback do lote, expiração, correções/cancelamento concorrentes e janela de manutenção |
| tests/native/auth-api.test.mjs:36–118 | Base compartilhada não vazia, private fora da API, refresh/expiração/revogação e operações HTTP concorrentes |
| scripts/local-postgres.mjs:1–39; scripts/test-native.mjs:1–16 | PostgreSQL nativo descartável com ciclo de vida explícito e bind em loopback |
| scripts/test-auth-local.mjs:1–106; scripts/preparar-auth-local.ps1:1–38 | Stack Auth/PostgREST local, ferramentas fixadas e fixtures `.test` |
| scripts/build-corrective.mjs:1–7 | Geração da segunda migração preservando a primeira |
| package.json:9–11 e :20; package-lock.json | Comandos locais e PostgreSQL nativo fixado em embedded-postgres 17.11.0-beta.19 |

Índice completo dos intervalos: [LINHAS-CORRETIVA.json](LINHAS-CORRETIVA.json).
Diff do código contra o pacote revisado: [RODADA-CORRETIVA.patch](RODADA-CORRETIVA.patch).
README foi atualizado com os comandos e os limites desta rodada.

## 1. Importação administrativa

Procedimento completo: [IMPORTACAO-ADMINISTRATIVA.md](IMPORTACAO-ADMINISTRATIVA.md).
Login PostgreSQL dedicado/temporário, NOINHERIT e sem DML, associado por DBA
a um ator autorizado. Recebe somente USAGE e três EXECUTEs privados. A identidade
vem do login original da conexão, não de JWT/SET ROLE. O navegador nunca recebe
credencial administrativa nem acesso às rotinas de importação.

O aplicador valida os bytes/hash, reproduz o plano e recusa alteração/quarentena.
Importação e conferência do lote inteiro ocorrem na mesma transação, sob lock
exclusivo de manutenção. Escritas normais aguardam. Uma divergência na segunda
obra desfaz também a primeira: isso foi testado em conexão nativa real.
Expiração e revogação são verificadas no servidor, inclusive em conexão aberta.

O login original é registrado em login_importador e na conferência. Lotes
anteriores mantêm esse campo nulo; não foi inventada identidade histórica.
Nenhuma execução com dados reais foi feita; o aplicador atual recusa hosts remotos.

## 2. Regra de correção proposta e implementada localmente

**Uma única substituição direta por lançamento, para sempre.** Ela exige que o
original já tenha sido estornado integralmente com aprovação do outro operador,
pertence à mesma obra e mantém a natureza entrada/custo. Para corrigir novamente,
solicita-se e aprova-se o estorno do substituto; o próximo lançamento aponta
para esse substituto. Forma-se uma cadeia auditável, sem ramificações.

Foi reproduzido que a v1 aceitava duas correções do mesmo original. A v2 impede
isso por índice único, inclusive com duas conexões concorrentes. Se uma base v1
já contiver duplicatas, a migração falha e preserva os registros; não apaga ou
reescreve dinheiro para forçar o upgrade. A resolução desse caso exigirá revisão
e autorização específicas. Não existe base remota implantada por este trabalho.

## 3. Resultado de rede incerto

Antes do envio, persiste-se apenas `{versao,id,acao}`, por ator. Não se guardam
valor, descrição, obra, payload ou fingerprint financeiro. Web Locks serializa
o acesso ao diário entre abas. Falha de storage/locks impede o envio.

Após reload, consulta-se o servidor pelo mesmo UUID, aguardando eventual transação
em andamento. Se já confirmou, atualiza-se a tela, limpam-se os campos e só então
remove-se o recibo. Não há reenvio automático nem nova UUID para a mesma tentativa.
Se ainda estiver ausente, o operador pode reintroduzir os dados conferidos usando
a mesma ação/UUID ou encerrar a tentativa pelo botão Atualizar dados. O servidor
grava um tombstone; uma requisição atrasada não poderá produzir efeito depois.

O payload não é recuperável do navegador: em tentativa ainda não recebida,
reintrodução dos dados é deliberada. A remoção manual do armazenamento perde o
recibo; nesse caso é obrigatório conferir o extrato antes de lançar novamente.
Não se promete proteção após o usuário apagar deliberadamente o identificador.

Escrita, consulta e encerramento usados pela UI validam também o UUID de usuário
esperado contra auth.uid(), impedindo atribuição errada durante troca de conta.

## 4. Testes efetivamente executados

| Execução final | Resultado | Evidência |
|---|---|---|
| node --test --test-reporter=spec tests/*.test.mjs | 39 aprovados, 0 falhas, 0 ignorados | [TESTES-CORRETIVA-LOCAL.txt](TESTES-CORRETIVA-LOCAL.txt) |
| npm run test:native:isolated | 8 aprovados, 0 falhas, 0 ignorados | [TESTES-CORRETIVA-NATIVO.txt](TESTES-CORRETIVA-NATIVO.txt) |
| npm run test:auth:isolated | 7 aprovados, 0 falhas, 0 ignorados | [TESTES-CORRETIVA-AUTH.txt](TESTES-CORRETIVA-AUTH.txt) |

PostgreSQL nativo 17.11 em Windows, conexões independentes, porta aleatória em
127.0.0.1, autenticação SCRAM e dados em diretório único .local/. Nenhum serviço
do sistema ou usuário do Windows criado. O banco foi parado ao terminar.

Auth real foi disponibilizado sem Docker: fonte GoTrue v2.197.0 compilada com
Go portátil oficial 1.27.4; PostgREST oficial 14.1; proxy local apenas para os
prefixos Auth/REST; três usuários sintéticos `.test` por execução. Sem SMTP,
OAuth externo, configuração do navegador ou recurso remoto. Credenciais/chaves
temporárias ficaram nos processos de teste; config.js continua vazio.

**Limite do ambiente:** GoTrue v2.197.0 usa SO_REUSEPORT Unix. A cópia temporária
recebeu somente adaptação para net.ListenConfig padrão no Windows, removendo
essa opção; nenhuma lógica de autenticação foi modificada. Patch exato:
[GOTRUE-WINDOWS-TEST.patch](GOTRUE-WINDOWS-TEST.patch).
PostgREST 16.5 encerrou com código nativo 3 neste ambiente; adotou-se o binário
oficial 14.1, que executou os testes. Não se afirma compatibilidade testada com
16.5 nem equivalência integral ao ambiente cloud/stack Docker oficial.

Os testes reais cobriram login inválido/válido, duas identidades e mesma obra,
terceiro sem vínculo, DML negado via HTTP, schema private não exposto, logout,
refresh de sessão, revogação de vínculo mesmo com JWT renovado, invalidação pelo
serviço da UI, JWT expirado recusado e refresh válido/revogado. Testaram também
UUID concorrente pela API, bloqueio de autoaprovação e aprovação pelo outro,
além da identidade esperada nas RPCs da UI.

## 5. Pendências e decisões

- Revisão desta regra de cadeia linear e da nova migração por Zyra antes de
  qualquer avanço remoto. Duplicatas preexistentes, se encontradas, não serão
  resolvidas automaticamente.
- Repetir o gate em runtime oficial Linux/container e configuração alvo antes
  de implantação; a stack Windows mínima tem a adaptação de socket descrita.
- Validação em navegador real com duas abas, interrupção de rede/PWA e dispositivos
  dos operadores continua pendente. Os testes de UI/recuperação foram feitos
  em DOM e storage/locks controlados; concorrência de banco e HTTP foi real.
- Configuração cloud, SMTP, dados reais e qualquer operação remota permanecem
  fora da autorização. Não houve alterações estéticas, push ou publicação.

Fontes das ferramentas: [Go](https://go.dev/dl/),
[Auth v2.197.0](https://github.com/supabase/auth/tree/v2.197.0),
[PostgREST v14.1](https://github.com/PostgREST/postgrest/releases/tag/v14.1),
[embedded-postgres](https://github.com/leinelissen/embedded-postgres).
O preparador fixa checksums; o do Go veio do catálogo oficial, os dos ZIPs
GitHub foram calculados após obtenção por HTTPS dos artefatos oficiais.
