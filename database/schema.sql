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
  legado jsonb,
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
  legado jsonb,
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
