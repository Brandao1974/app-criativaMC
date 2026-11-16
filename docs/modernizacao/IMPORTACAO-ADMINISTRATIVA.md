# Procedimento administrativo — rodada corretiva

Esta etapa foi executada apenas com fixtures sintéticas em PostgreSQL local
descartável. Dados reais, contas reais e qualquer execução remota continuam
proibidos sem autorização específica. Os SQL abaixo são modelos operacionais,
não comandos já aplicados a ambientes reais.

## Identidade e privilégio

O navegador usa somente Auth individual e chave pública. Não recebe credencial
PostgreSQL, service_role, grant de importação, DML direto ou acesso à allowlist.

A importação exige login PostgreSQL dedicado, temporário e NOINHERIT. Um DBA
associa esse `session_user` a um ator individual já autorizado em profiles e
app_membros, com prazo de validade na tabela privada importacao_operadores.
`SET ROLE`, `auth.uid()` e claims enviadas pelo cliente não escolhem esse ator.
As rotinas privadas definer revalidam o login original, prazo, atividade e
vínculo em cada chamada. Não são RPCs públicas; private não deve ser exposto.

Privilégios do login: CONNECT no banco alvo, USAGE em private e EXECUTE apenas
em identidade_importacao, importar_obra e conferir_importacao. Sem papel
authenticated, sem SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB e sem DML/SELECT nas
tabelas de negócio/allowlist. Os testes nativos comprovam a execução por uma
conexão real desse login, a atribuição correta mesmo com claim forjada e o
bloqueio por expiração. Também testam um login de API distinto, com papel
authenticated e claim válida, que não consegue assumir a identidade importadora.

Exemplo para preparação futura por DBA, depois da autorização e com nomes,
UUID e prazo reais revisados (não copiar literalmente):

```sql
create role criativa_import_temporario login noinherit nosuperuser nobypassrls
  nocreatedb nocreaterole noreplication valid until 'DATA-HORA-APROVADA';
-- Definir senha por mecanismo interativo seguro do DBA, como \password no psql.
grant connect on database BANCO_EXCLUSIVO to criativa_import_temporario;
grant usage on schema private to criativa_import_temporario;
grant execute on function private.identidade_importacao(),
  private.importar_obra(uuid,text,text,jsonb,jsonb),
  private.conferir_importacao(text,jsonb) to criativa_import_temporario;
insert into private.importacao_operadores(login_name,ator_id,valido_ate)
values('criativa_import_temporario','UUID-DO-OPERADOR','DATA-HORA-APROVADA');
```

Não conceder esse papel ao authenticator, authenticated ou anon. Não conceder
acesso por metadados Auth. `login_importador` registra o principal no lote;
importado_por registra o ator; o relatório final registra quem conferiu e quando.
Lotes anteriores à segunda migração mantêm principal nulo, sem inventar autoria.

## Execução segura

1. Congelar a fonte aprovada e preservar bytes/hash do backup fora do Git.
   Identificar origem canônica e não juntar exportações divergentes por suposição.
2. Gerar o plano offline com scripts/importar-legado.mjs. Revisar contagens,
   centavos, caixa legado, pendências e quarentena. O aplicador recusa quarentena
   ou lote vazio; não cria ajustes, assinaturas ou timestamps históricos fictícios.
3. Disponibilizar janela de manutenção. A aplicação adquire lock compartilhado
   de manutenção; o aplicador mantém o lock exclusivo durante todo o lote.
   Gravações concorrentes aguardam; não intercalam com a importação.
4. Usar conexão PostgreSQL dedicada por variável de ambiente privada
   LOCAL_IMPORT_PG_URL; nunca parâmetro de página/config.js nem string de
   conexão em arquivo versionado ou histórico com senha. O aplicador desta
   etapa recusa qualquer host fora de loopback.
5. Executar, somente na instância local isolada aprovada:

```powershell
node scripts/aplicar-importacao-local.mjs BACKUP.json PLANO.json --confirmar-local
```

6. O aplicador recalcula SHA-256 dos bytes, reproduz o conversor e compara o
   plano integral antes de conectar qualquer identidade financeira ao banco.
   Consulta identidade_importacao, importa e reconcilia na mesma transação.
   Divergência ou erro em qualquer obra provoca rollback do lote inteiro.
7. Se houver queda de conexão no commit, reconectar com a mesma identidade e
   reaplicar o MESMO backup/plano/origem. Chaves e conteúdo no servidor impedem
   duplicação. Não gerar outra origem para contornar conflito.
8. Conferir relatório final: contagens, entradas, custos e saldo precisam bater
   exatamente com o plano. Divergência do caixa escalar permanece registrada no
   plano; não é corrigida com lançamento artificial.
9. DBA encerra a janela: desativa/remove a allowlist, revoga os três EXECUTEs,
   revoga USAGE, coloca o login em NOLOGIN e encerra conexões residuais, se
   necessário. Verificar a revogação antes de descartar o login. Expiração da
   allowlist também bloqueia conexões já abertas em chamadas posteriores.

Backup, plano, logs e recibo ficam privados. A ferramenta não concede nem
revoga privilégios, não cria contas e não seleciona atores por nome. Esse
provisionamento é responsabilidade do DBA e exige autorização própria para
ambiente real. Nenhuma dessas etapas reais foi executada nesta rodada.
