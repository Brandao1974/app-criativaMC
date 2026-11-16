# Instalação e distribuição — versão de três operadores

Este procedimento está preparado, mas **não foi executado remotamente**.
O aplicativo publicado e as contas reais continuam intocados. A configuração
pública do repositório permanece vazia. A entrega local não significa acesso
real disponível aos integrantes: faltará autorizar a infraestrutura remota.

## Artefatos e fronteiras

- Aplicar as três migrações em ordem, no projeto exclusivo autorizado. v1/v2
  mantêm seus checksums. v3 substitui todos os helpers de autorização e os
  testes verificam ausência de `app_membros` nos caminhos financeiros/importação.
- A função `acesso` tem entrypoint em `supabase/functions/acesso/index.ts`.
  Também há gateway Node em `server/start.mjs`. Ambos usam o mesmo serviço
  `server/access.mjs`; o adaptador Fetch da função tem testes locais.
- Hospedar apenas o artefato produzido por `node scripts/preparar-distribuicao.mjs`
  no GitHub Pages. Nunca apontar um servidor de arquivos à raiz do repositório.
  O script gera somente arquivos públicos e seus hashes em `.local/`.
- Não incluir credenciais, backups, relatórios com dados reais ou planos de
  importação no Git. `.env`, chaves e `.local/` são ignorados.

## Configuração do projeto Supabase, após autorização específica

1. Confirmar o projeto alvo por organização/ID; não reutilizar projetos alheios.
   Fazer backup do alvo caso deixe de ser uma instalação vazia.
2. Aplicar migrações v1, v2 e v3. A instalação não transforma Gustavo em
   Ildebrando, não reutiliza seu UUID e não apaga sua autoria histórica.
3. Desabilitar signup público, Auth anônimo e provedores externos não usados.
   Configurar senha mínima de 12 caracteres. Os aliases `@identidade.invalid`
   são técnicos, confirmados apenas por Admin API, sem envio de e-mail.
4. Manter somente `public` na Data API; não expor `private` nem `auth`.
   Conferir grants/RLS, `auth.sessions(id,user_id,not_after)` e o trigger
   `app_credencial_alterada` no projeto alvo antes da abertura para uso.
5. Criar login PostgreSQL de runtime SCRAM com NOINHERIT, sem
   SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB; conceder somente CONNECT no banco e
   associação a `app_gateway`. A conexão deverá executar `SET ROLE app_gateway`
   como opção de inicialização (`options=-c role=app_gateway`, URL-encoded).
   Esse papel possui apenas EXECUTE nas funções privadas explicitamente listadas.
   Não usar a credencial `postgres` no gateway. Usar conexão direta ou pooler
   **em modo sessão**, com TLS validado; modo transação é incompatível com a
   serialização de banimentos por advisory lock de sessão.
6. Armazenar exclusivamente nos secrets da função: `ACCESS_DATABASE_URL`,
   `ACCESS_PUBLIC_KEY`, `ACCESS_AUTH_SECRET_KEY`, `ACCESS_PEPPER` (CSPRNG,
   mínimo 32 caracteres) e `ACCESS_ORIGINS`. `SUPABASE_URL` é o valor fornecido
   pelo ambiente da função. O segredo Auth é service_role/secret server-only.
   `ACCESS_ORIGINS` contém origens HTTPS exatas, separadas por vírgula, sem
   caminhos, `*` ou `null`. Desabilitar logs de corpos/headers no proxy/APM.
7. Publicar a função com `verify_jwt=false` conforme o TOML: login/ativação
   não têm JWT inicial; cada ação administrativa valida Auth, sessão real,
   geração e UUID administrativo. Nenhum endpoint público instala administrador.
8. Na alternativa Node, usar os nomes `SUPABASE_PUBLIC_KEY`,
   `SUPABASE_SECRET_KEY`, `ACCESS_DATABASE_URL`, `ACCESS_PEPPER`, `ACCESS_ORIGINS`
   e `SUPABASE_URL`; `npm run start:access` escuta loopback atrás de proxy HTTPS.
   Não confiar em `X-Forwarded-For` arbitrário. O limite usa o peer efetivo e
   par peer/usuário: atrás de proxy compartilhado, o limite é conservador para
   todos os operadores (60 requisições/15 min por peer; 10 por par).
9. Preencher **apenas** URL, chave pública e `accessUrl` em `js/config.js`.
   Para Edge: `https://<projeto>.supabase.co/functions/v1/acesso`.
   Para outro host HTTPS, acrescentar sua origem exata ao `connect-src` das
   páginas antes do build. Nunca inserir segredo do servidor nesse arquivo.

## Instalação de Ildebrando

Executar de terminal privado do administrador do projeto, fora do navegador,
com credencial temporária de instalação autorizada. O instalador precisa das
permissões para as funções privadas de instalação, SQL Auth de leitura e API
administrativa; não conceder essas permissões ao runtime `app_gateway`.

Configurar no ambiente desse processo `INSTALL_DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_PUBLIC_KEY`, `SUPABASE_SECRET_KEY`, `ACCESS_PEPPER`. Não fornecer
valores em argumentos, capturas de tela, histórico de comandos ou arquivos Git.

```powershell
node scripts/instalar-administrador.mjs --confirmar-instalacao
```

O CLI reserva alias estável antes da Admin API e reconcilia timeout de criação
consultando o Auth por esse alias, sem criar segunda identidade. Lock serializa
instaladores. O singleton associa exclusivamente o UUID original a Ildebrando.
Senha provisória é forte/aleatória, descartada, nunca entregue. Código é exibido
uma única vez no terminal (15 minutos); o banco recebe somente HMAC. Reexecutar
mantém o UUID e reemite código, revogando os anteriores. Remover as credenciais
temporárias do ambiente após concluir. Guardar o UUID original no inventário
administrativo privado do projeto.

Ildebrando define sua senha no primeiro acesso e entra como `ildebrando`.
Na seção Operadores do dashboard, cadastra Edson/Ivan, gera código individual
e o transmite diretamente por canal privado. Código desaparece da tela em
60 segundos, ao ocultar a aba, ao executar outra ação ou ao sair. Ele não
promove administrador nem escreve autorização/bloqueio.

## Máquina de estados e falhas

`emitida → consumida → concluida`, ou `emitida/consumida → revogada/falha`.
O resgate consome em COMMIT antes de chamar Admin API. Nunca volta para emitida.
Após sucesso da senha no Auth, a conclusão exige nonce, geração, autorização,
ausência de bloqueio e **exatamente uma** alteração de credencial desde o
consumo. Uma revisão numérica observa o trigger do Auth sem copiar senha/hash.
Mudança tardia/externa derruba prontidão e admissões; duas alterações impedem
conclusão. Se Auth ou banco responderem de forma incerta, não repetir o código:
Ildebrando emite outro. Pode haver senha alterada com acesso negado, nunca uma
suposta transação atômica entre Auth e SQL. O mesmo código não redefine senha.

Bloqueio é confirmado no banco antes de banimento Auth. Falha de sincronização
retorna `sincronizacao_auth=pendente`, mantendo acesso negado. Repetir **o mesmo
UUID de operação** sincroniza o estado atual; replay antigo não desfaz uma
reativação posterior. Reativação invalida gerações anteriores e exige login novo.

## Recuperação excepcional do administrador

Não existe página/endpoint para assumir administração. Exige acesso
administrativo ao **mesmo projeto Supabase**, identificação do responsável por
seu processo administrativo e conferência do UUID original com o inventário e
`private.administracao_app` (não confiar em nome, e-mail ou metadados recebidos).

```powershell
node scripts/instalar-administrador.mjs --confirmar-instalacao --recuperar-uuid <UUID-original-conferido>
```

O CLI recusa UUID diferente, restaura exclusivamente a conta existente de
Ildebrando, invalida sessões/convites e gera código novo. Auditoria registra
`RECUPERACAO_OFFLINE`, UUID, `session_user` e horário. Não cria admin substituto
e não transforma Edson/Ivan em administradores. Se a conta Auth original tiver
sido apagada, parar e recuperar o banco/identidade por procedimento do projeto;
não fabricar outro UUID automaticamente.

## Verificação e publicação

Executar build, 54 casos históricos e suíte v3 nativa; usar somente fixtures.
Antes do uso remoto, repetir smoke test na versão efetiva do Supabase/Edge,
confirmar CORS/origem/HTTPS e testar dispositivos dos três operadores. O runner
local usa Auth real 2.197.0, PostgreSQL 17.11 e PostgREST 14.1. O runtime Edge
hospedado e o ambiente de produção não são equivalentes a essa stack.
O entrypoint também foi executado em Deno real 2.9.6 local (AC38), sem deploy.
Para repetir AC38 no Windows, disponibilizar o executável oficial Deno 2.9.6
em `.local/tools/deno.exe`, preparar o cache com `deno check --config
supabase/functions/acesso/deno.json supabase/functions/acesso/index.ts` usando
`DENO_DIR=.local/deno-cache`, e executar a suíte isolada. O lockfile acompanha
o código. Sem esse executável, AC38 informa explicitamente a pendência.

Commit local pode ser revisado por `git show --stat HEAD`. Push, merge,
publicação Pages, secrets remotos, instalação real e importação real exigem
autorização separada. Nenhum script de build executa essas ações.
