# Conclusão local — acesso e distribuição

16/11/2026 UTC (15/11/2026 no horário de São Paulo).
Implementação local concluída e validada. A publicação e a implantação remota
**não foram executadas**. Nenhuma conta/dado real foi criado/importado.

## Resultado

- Diretório fechado: Ildebrando, Edson e Ivan. Sem cadastro aberto/quarto usuário.
  Gustavo é negado mesmo com JWT Auth e vínculo legado ativo; autoria preservada.
- Administração exclusiva pelo UUID original de Ildebrando, provisionado por CLI
  de instalação. Não há bootstrap público nem promoção por metadado/código.
- Login por username/senha: gateway privado resolve alias; Supabase Auth verifica
  e armazena senhas, JWTs e refresh. Cliente Admin separado do cliente de login,
  sem persistência/refresh automático no servidor. Nenhum hash de senha próprio.
- Primeiro acesso individual com CSPRNG de 256 bits, HMAC, 15 minutos, máximo
  de cinco tentativas, consumo durável único, reemissão revogando convite anterior.
  Código só é exibido uma vez para entrega privada, sem persistência no navegador.
- Admissão ligada a `auth.sessions`, UUID e geração. Bloqueio é negado primeiro
  no banco. Reativação exige login novo e não revive JWT/refresh anterior.
- Mudança de senha no Auth incrementa somente uma revisão numérica, invalida
  prontidão/admissões e é auditada. Não copia o hash. Conclusão de ativação exige
  exatamente uma alteração desde o consumo: duas alterações ou resposta incerta
  não abrem acesso. Código consumido nunca redefine senha novamente.
- CORS de origens exatas, erros genéricos, limite persistido entre instâncias,
  limite de corpo, respostas `no-store`, sem logs de credenciais. Endpoints
  administrativos verificam Auth real e administração no banco a cada ação.
- Obras/financeiro compartilhados, ledger/auditoria, idempotência, recuperação
  por UUID e segunda pessoa para exclusão preservados, inclusive para Ildebrando.
  Testados os seis pares ordenados, autoaprovação negada, estorno integral único.

## Arquivos principais

| Arquivo | Implementação |
|---|---|
| `database/identity.sql` | Diretório, admin singleton, sessões, revisão de credencial, códigos, estados, limites, autorização, instalação/recuperação, RLS/ACL e importador v3 |
| `scripts/build-identity.mjs` | Gera v3 e substitui as verificações legadas nas funções financeiras, preservando as demais regras |
| `supabase/migrations/20261116020905_three_operator_access.sql` | Migração v3 transacional/versionada, reaplicação protegida por checksum |
| `server/access.mjs` | Login, ativação, operações administrativas e sincronização Auth idempotente |
| `server/http.mjs`, `server/handler.mjs`, `server/start.mjs` | Adaptadores Node/Fetch; alternativa de servidor HTTPS por proxy |
| `supabase/functions/acesso/index.ts`, `deno.json`, `deno.lock` | Função Edge preparada, versões/integridades fixadas, testada em Deno real local |
| `supabase/config.toml` | Signup/anônimo desativados e entrypoint da função sem bootstrap público |
| `scripts/instalar-administrador.mjs` | Instalação/recuperação offline com lock, UUID original e auditoria |
| `js/acesso.js`, `servicos.js`, `bootstrap.js` | Gateway público e sessão SDK; configuração incompleta não abre operação |
| `login.html`, `js/app.js`, `js/administracao.js` | Usuário/senha, primeiro acesso e gestão de operadores, sem redesign |
| `sw.js`, `scripts/preparar-distribuicao.mjs` | Versão por hash e pacote público por allowlist, sem servidor/SQL/segredos |
| `tests/native/access.test.mjs` | 30 cenários aprovados e oito verificações adicionais |
| `tests/harness.mjs`, `auth.test.mjs`, `ui.test.mjs` | Fixação histórica v1/v2; adaptação da integração de login e limpeza de senha |

Índice verificável de linhas: `LINHAS-ACESSOS.json` (gerado sobre os arquivos
finais). Fontes v1/v2 e seus dois arquivos de migração permanecem com os hashes
originais registrados em `BASELINE-54-ACESSOS.json`.

## Testes executados

| Comando | Resultado final | Evidência |
|---|---|---|
| `npm run build` | Sucesso; três migrações, vendors e versão PWA gerados | `BUILD-ACESSO.txt` |
| `npm test` | 39 aprovados, 0 falhas, 0 ignorados | `TESTES-ACESSO-LOCAL.txt` |
| `npm run test:native:isolated` | 8 aprovados, 0 falhas, 0 ignorados | `TESTES-ACESSO-REGRESSAO-PG.txt` |
| `npm run test:auth:isolated` | 7 aprovados, 0 falhas, 0 ignorados | `TESTES-ACESSO-REGRESSAO-AUTH.txt` |
| `npm run test:access:isolated` | 38 aprovados, 0 falhas, 0 ignorados | `TESTES-ACESSO-NATIVO.txt` |
| Deno 2.9.6 `check --cached-only` | Sucesso | `TESTES-ACESSO-DENO.txt` |
| Preparação de distribuição | Artefato estático local e manifesto SHA-256; sem publicação | `DISTRIBUICAO-LOCAL.txt` |

**Total: 92 testes aprovados.** Os 54 anteriores continuam executados, sem
remoção/skip de casos nem enfraquecimento das asserções financeiras. São regressão
histórica v1/v2: não são apresentados como comprovação isolada de v3.

Alterações de harness: `migration({latest:false})` fixa v1/v2 para os casos
históricos; a suíte v3 solicita explicitamente as três migrações. O teste Auth
de frontend agora injeta o gateway, em vez de enviar e-mail diretamente ao SDK.
O teste de duas tentativas preenche novamente a senha, pois a UI agora a limpa
mesmo após falha. Os arquivos financeiros/importação e as duas suítes nativas
anteriores mantêm seus conteúdos e asserções.

Stack: PostgreSQL nativo **17.11**, Auth/GoTrue **2.197.0** (adaptação de socket
Windows documentada anteriormente), PostgREST **14.1**, SDK **2.119.0** e Deno
**2.9.6**. Instâncias descartáveis em loopback, conexões independentes e fixtures
sintéticas. Senhas/códigos/chaves de teste são aleatórios e não constam nos logs.
Não houve Docker nem Supabase hospedado. A disponibilidade de `session_id`,
`auth.sessions` e `not_after` foi conferida no Auth real dessa stack.

Os 30 cenários AC01–AC30 do plano estão implementados. Adicionais:

- AC31: formulários DOM de primeiro acesso/login → gateway HTTP → SDK →
  Auth/PostgREST reais, sem e-mail digitado e com limpeza dos campos secretos.
- AC32: financeiro v3 em conexões independentes, UUID concorrente e decisões
  concorrentes de Ivan/Ildebrando produzem somente um estorno exato.
- AC33: importação sintética v3 idempotente; Gustavo não serve como importador.
- AC34: duas alterações de senha e alteração tardia/externa falham com acesso negado.
- AC35: replay de bloqueio antigo não bane usuário reativado posteriormente.
- AC36: adaptador Edge, CORS, preflight, administração real e limite de corpo.
- AC37: cinco tentativas esgotam somente convite; código novo continua utilizável.
- AC38: entrypoint TypeScript executa em processo **Deno real**, com papel
  `app_gateway`, banco/Auth locais, login aceito e administração negada a Edson.

Correções durante validação: teste de logout global passou a renovar sua fixture
Ivan antes dos casos seguintes; proteção de revisão de credencial acrescentada
para senha atrasada; sincronização Auth passou a usar estado atual no replay de
operação antiga. O build exigiu leitura fora do sandbox para o esbuild resolver
dependências; a execução local autorizada concluiu com sucesso.

## Instalação e pendências de distribuição

Procedimento completo: `INSTALACAO-E-DISTRIBUICAO.md`. A recuperação exige acesso
administrativo ao projeto, conferência inequívoca do UUID original e registra
`RECUPERACAO_OFFLINE` com `session_user`; não cria administrador substituto.

Não existe impedimento técnico local conhecido após esses testes. O aplicativo
**ainda não está disponível para uso real**: o próximo passo depende de
autorização específica para configurar o projeto Supabase alvo, aplicar as três
migrações, fornecer secrets somente no servidor, instalar Ildebrando e publicar
o frontend. A configuração pública permanece vazia por esse motivo.

Antes de liberar uso real, ainda são necessários:

1. Smoke test no Supabase/Edge hospedado efetivo (políticas, trigger Auth,
   sessão/refresh, permissões e conexão TLS/pooler em modo sessão).
2. Verificação em navegador/dispositivos reais dos três operadores, HTTPS,
   CORS da origem definitiva e atualização de uma PWA já instalada. O fluxo DOM
   foi automatizado localmente, mas não equivale a essa homologação de aparelhos.
3. Confirmar destino de publicação e realizar instalação/distribuição com os
   códigos privados de uso único. Nenhuma credencial deve ser enviada por Git.

Build, testes e preparação de pacote não executam push, deploy ou importação.
O commit solicitado reúne a modernização local anterior e a camada de acesso
validada nesta rodada; seu hash é informado na entrega após a gravação no Git.
