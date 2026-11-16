# Modelo SQL revisado para aprovação

Proposta de estrutura e contratos, não migração executável de produção.
Não aplicar estes trechos no banco remoto. Funções de escrita e triggers serão
implementados e testados após parecer de Zyra e aprovação do usuário.
Os trechos SQL podem ser analisados sintaticamente, mas não garantem as regras
operacionais descritas enquanto as funções/triggers estiverem pendentes.

## Estrutura proposta

Uma base exclusiva com dois lugares de operador. `profiles` mantém identidade
histórica; `app_membros` concede acesso por UUID real. Contas não são apagadas
em cascata: bloqueio/desativação preserva autoria. Privado não será schema
exposto na Data API. Administrador provisiona perfis e membros após autorização;
criar perfil não concede vínculo. Não há autoinscrição em app_membros.

```sql
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  nome text not null check (length(btrim(nome)) between 1 and 120),
  criado_em timestamptz not null default now()
);

create table public.app_membros (
  usuario_id uuid primary key references public.profiles(id) on delete restrict,
  lugar text not null unique check (lugar in ('gustavo', 'ivan')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.obras (
  id uuid primary key default gen_random_uuid(),
  cliente text not null check (length(btrim(cliente)) between 1 and 200),
  descricao text,
  localizacao text,
  responsavel_cliente text,
  valor_centavos bigint not null check (valor_centavos between 0 and 999999999999),
  status text not null check (status in
    ('Negociacao','Fechada','Em Producao','Agendada','Em Execucao','Finalizada')),
  data_execucao date,
  criado_por uuid not null references public.profiles(id) on delete restrict,
  criado_em timestamptz not null default now(),
  atualizado_por uuid not null references public.profiles(id) on delete restrict,
  atualizado_em timestamptz not null default now(),
  versao bigint not null default 1 check (versao > 0)
);

create table public.obra_status_eventos (
  id bigint generated always as identity primary key,
  obra_id uuid not null references public.obras(id) on delete restrict,
  status text not null check (status in
    ('Negociacao','Fechada','Em Producao','Agendada','Em Execucao','Finalizada')),
  data_execucao date,
  autor_id uuid not null references public.profiles(id) on delete restrict,
  ocorrido_em timestamptz not null default now()
);

create table public.obra_movimentos (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras(id) on delete restrict,
  tipo text not null check (tipo in ('entrada','custo')),
  categoria text,
  descricao text not null check (length(btrim(descricao)) between 1 and 500),
  valor_centavos bigint not null check (valor_centavos between 1 and 999999999999),
  estorna_id uuid unique references public.obra_movimentos(id) on delete restrict,
  corrige_id uuid references public.obra_movimentos(id) on delete restrict,
  autor_id uuid not null references public.profiles(id) on delete restrict,
  ocorrido_em timestamptz not null default now(),
  operacao_id uuid not null,
  unique (autor_id, operacao_id),
  check (estorna_id is null or estorna_id <> id),
  check (corrige_id is null or corrige_id <> id),
  check (estorna_id is null or corrige_id is null)
);

create table public.exclusao_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  movimento_id uuid not null references public.obra_movimentos(id) on delete restrict,
  solicitante_id uuid not null references public.profiles(id) on delete restrict,
  motivo text not null check (length(btrim(motivo)) between 3 and 1000),
  solicitado_em timestamptz not null default now(),
  estado text not null default 'pendente' check (estado in ('pendente','aprovada','rejeitada')),
  operacao_id uuid not null,
  unique (solicitante_id, operacao_id),
  unique (id, solicitante_id)
);
create unique index exclusao_um_pedido_pendente
  on public.exclusao_solicitacoes(movimento_id) where estado = 'pendente';

create table public.exclusao_decisoes (
  solicitacao_id uuid primary key,
  solicitante_id uuid not null,
  decisor_id uuid not null references public.profiles(id) on delete restrict,
  decisao text not null check (decisao in ('aprovada','rejeitada')),
  motivo text not null check (length(btrim(motivo)) between 3 and 1000),
  decidido_em timestamptz not null default now(),
  estorno_id uuid unique references public.obra_movimentos(id) on delete restrict,
  foreign key (solicitacao_id, solicitante_id)
    references public.exclusao_solicitacoes(id, solicitante_id) on delete restrict,
  check (decisor_id <> solicitante_id),
  check ((decisao = 'aprovada') = (estorno_id is not null))
);

create table public.auditoria_eventos (
  id bigint generated always as identity primary key,
  autor_id uuid not null references public.profiles(id) on delete restrict,
  ocorrido_em timestamptz not null default now(),
  acao text not null,
  entidade text not null,
  entidade_id text not null,
  antes jsonb,
  depois jsonb
);

create table private.importacao_lotes (
  id uuid primary key default gen_random_uuid(),
  origem_id uuid not null,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  importado_por uuid not null references public.profiles(id) on delete restrict,
  importado_em timestamptz not null default now(),
  versao_conversor text not null,
  relatorio jsonb not null,
  unique (id, origem_id)
);
create table private.importacao_registros (
  origem_id uuid not null,
  entidade text not null check (entidade in ('obra','movimento','evento','pendencia')),
  chave_origem text not null,
  lote_id uuid not null,
  destino_id text,
  hash_conteudo text not null check (hash_conteudo ~ '^[0-9a-f]{64}$'),
  bruto jsonb not null,
  estado text not null check (estado in ('importado','quarentena','pendente_confirmacao')),
  primary key (origem_id, entidade, chave_origem),
  foreign key (lote_id, origem_id) references private.importacao_lotes(id, origem_id)
    on delete restrict
);

create index movimentos_obra_data on public.obra_movimentos(obra_id, ocorrido_em, id);
create index status_obra_data on public.obra_status_eventos(obra_id, ocorrido_em, id);
create index solicitacoes_movimento on public.exclusao_solicitacoes(movimento_id);
create index auditoria_entidade on public.auditoria_eventos(entidade, entidade_id, id);
```

`corrige_id` só é aceito pela operação de substituição de um original já
revertido e validado; não é campo arbitrário de formulário. Sem bypass que
permita movimento especial ser criado com valor/autor/estorna_id do cliente.

## RLS e privilégios propostos

O helper abaixo só consulta vínculo pelo uid da sessão. Não confia em nome,
metadados editáveis nem usuário fornecido por parâmetro. Definer privado evita
recursão ao proteger app_membros com política que consulta o próprio vínculo.
Não expor schema private na API nem conceder CREATE nele a clientes.

```sql
create or replace function private.membro_ativo()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.app_membros m
    where m.usuario_id = auth.uid() and m.ativo
  );
$$;
revoke all on function private.membro_ativo() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.membro_ativo() to authenticated;

alter table public.profiles enable row level security;
alter table public.app_membros enable row level security;
alter table public.obras enable row level security;
alter table public.obra_status_eventos enable row level security;
alter table public.obra_movimentos enable row level security;
alter table public.exclusao_solicitacoes enable row level security;
alter table public.exclusao_decisoes enable row level security;
alter table public.auditoria_eventos enable row level security;
alter table private.importacao_lotes enable row level security;
alter table private.importacao_registros enable row level security;

revoke all on public.profiles, public.app_membros, public.obras,
  public.obra_status_eventos, public.obra_movimentos,
  public.exclusao_solicitacoes, public.exclusao_decisoes, public.auditoria_eventos
  from public, anon, authenticated;
revoke all on private.importacao_lotes, private.importacao_registros
  from public, anon, authenticated;

grant select on public.profiles, public.app_membros, public.obras,
  public.obra_status_eventos, public.obra_movimentos,
  public.exclusao_solicitacoes, public.exclusao_decisoes, public.auditoria_eventos
  to authenticated;

create policy membros_leem on public.app_membros for select to authenticated
  using ((select private.membro_ativo()));
create policy perfis_leem on public.profiles for select to authenticated
  using ((select private.membro_ativo()));
create policy obras_leem on public.obras for select to authenticated
  using ((select private.membro_ativo()));
create policy status_leem on public.obra_status_eventos for select to authenticated
  using ((select private.membro_ativo()));
create policy movimentos_leem on public.obra_movimentos for select to authenticated
  using ((select private.membro_ativo()));
create policy pedidos_leem on public.exclusao_solicitacoes for select to authenticated
  using ((select private.membro_ativo()));
create policy decisoes_leem on public.exclusao_decisoes for select to authenticated
  using ((select private.membro_ativo()));
create policy auditoria_leem on public.auditoria_eventos for select to authenticated
  using ((select private.membro_ativo()));
```

Nenhuma política/grant de escrita ao cliente. Funções privadas de negócio
precisarão de EXECUTE somente para encaminhamento invoker autorizado, com
validação interna obrigatória mesmo em chamada direta por SQL. Aplicar
privilégios explícitos por função e revisar privilégios padrão de novas funções.
JWT de membro desativado perde acesso na próxima consulta porque vínculo é
lido no banco. Sessões Auth devem ser revogadas no desligamento; logout local
não garante invalidação imediata de access tokens já emitidos.

## Razão e indicadores

Original e reversão permanecem presentes. Sinal financeiro vem de tipo; estorno
tem tipo oposto. Na coluna de entradas/custos líquidos, a reversão subtrai do
grupo do original. Não tratar estorno de custo como nova receita.

```sql
create view public.vw_obra_resumo with (security_invoker = true) as
select o.id as obra_id,
  coalesce(sum(case
    when m.estorna_id is null and m.tipo = 'entrada' then m.valor_centavos
    when m.estorna_id is not null and m.tipo = 'custo' then -m.valor_centavos
    else 0 end), 0) as entradas_liquidas_centavos,
  coalesce(sum(case
    when m.estorna_id is null and m.tipo = 'custo' then m.valor_centavos
    when m.estorna_id is not null and m.tipo = 'entrada' then -m.valor_centavos
    else 0 end), 0) as custos_liquidos_centavos,
  coalesce(sum(case when m.tipo = 'entrada' then m.valor_centavos
    else -m.valor_centavos end), 0) as saldo_centavos
from public.obras o left join public.obra_movimentos m on m.obra_id = o.id
group by o.id;

create view public.vw_caixa with (security_invoker = true) as
select coalesce(sum(case when tipo = 'entrada' then valor_centavos
  else -valor_centavos end), 0) as saldo_centavos
from public.obra_movimentos;

revoke all on public.vw_obra_resumo, public.vw_caixa from public, anon;
grant select on public.vw_obra_resumo, public.vw_caixa to authenticated;
```

Sem filtro de excluído. Conferência deve verificar soma dos saldos por obra =
saldo direto e entradas líquidas menos custos líquidos = saldo. Agregados
numeric/bigint devem sair da API como strings decimais através de RPC de leitura
ou view de apresentação; converter com BigInt no cliente. Não confiar que soma
de vários registros fica segura em Number só porque cada registro tem teto.
Somar em SQL; conversão para Number só com verificação de faixa, inclusive gráfico.

Datas de operação novas vêm do servidor; data operacional de agenda é DATE.
Para “hoje”, usar `(now() at time zone 'America/Sao_Paulo')::date`.
Datas/textos legados ficam preservados separadamente; não fabricar precisão.

## Contratos das funções e triggers a implementar

| Operação | Entradas permitidas | Garantias da transação |
|---|---|---|
| criar_obra | campos de negócio + UUID da operação | Vínculo ativo, autor/instante do servidor, evento inicial + auditoria; retry sem duplicação |
| atualizar_obra | id, versão esperada, campos de negócio | CAS da versão; conflito não sobrescreve; status/agendamento geram evento e auditoria |
| registrar_movimento | obra, tipo, categoria, descrição, centavos, operação | Valor inteiro positivo, obra existente, autor/instante do servidor, original sem estorna_id |
| solicitar_exclusao | original, motivo, operação | Bloquear original; somente original ainda não revertido e sem pedido pendente; saldo inalterado |
| decidir_exclusao | pedido, aprovar/rejeitar, motivo | Validar lugar oposto e uid distinto; bloquear original depois pedido; verificar pendente; gravar decisão, estorno se aprovado, estado e auditoria atomicamente |
| registrar_correcao | original revertido, novos campos, operação | Referência validada; mesma obra, trilha de substituição; sem reescrever original |

Um registro privado de operações idempotentes com `(ator_id, operacao_id)` e
hash do payload será acrescentado à migração final para operações que ainda
não tenham chave própria (criar/atualizar obra). Repetição com hash diferente
deve falhar. Retry de decisão deve retornar o resultado já gravado apenas se
ator, decisão e justificativa forem idênticos; outra decisão não altera estado.

Triggers de defesa: impedir UPDATE/DELETE de movimentos, decisões, eventos e
auditoria; impedir troca de identidade/solicitante/alvo do pedido; estados só
transitam pendente → aprovada/rejeitada na rotina autorizada. Validar em INSERT
de estorno: original na mesma obra, tipo oposto, valor EXATAMENTE igual,
original não é estorno, original ainda não revertido. UNIQUE permanente em
estorna_id impede repetição mesmo após tentativas futuras. Verificar o elo
decisão ↔ pedido ↔ original ↔ estorno em constraint trigger deferred antes do
commit. Não basta ter três FKs independentes.

Permissão de escrita nas rotinas não deve ser detectada por um flag editável
de sessão enviado pelo cliente. Privilégios mínimos de papéis/rotinas delimitam
quem escreve. Nada de chave service_role no navegador, mesmo no importador.

Auditoria registra operações bem-sucedidas na transação. Falhas que fazem
rollback não sobrevivem em audit_log da mesma transação: tentativas negadas
precisam dos logs de API/Auth/servidor, sem tokens, senhas ou payload financeiro.
Não prometer auditoria persistida de falhas por um INSERT seguido de RAISE.

## Importação e evolução

As tabelas privadas guardam evidência, chaves, hash e destino de cada entidade.
O original JSON bruto continua em arquivo privado imutável, pois JSONB não
preserva os bytes originais. Datas e autores não verificáveis ficam em bruto,
separados do ator/instante de importação. Não atribuir uma ação Auth ao operador
só porque seu nome aparece no legado. O histórico importado é apresentado com
essa distinção; sem disparar eventos novos fictícios.

DDL final exige: constraints de tamanho restantes, índices de FKs conforme
plano de consulta, registro idempotente de operações, rotinas de leitura com
contrato monetário textual, triggers de integridade e migrações versionadas.
Este desenho é revisão prévia, não banco implementado nem testado.
