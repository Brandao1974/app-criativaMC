-- Generated from database/*.sql; do not edit this copy.
-- Local implementation only; remote execution requires separate approval.
begin;
create schema if not exists private;
create table if not exists private.schema_versions(version text primary key, checksum text not null);
alter table private.schema_versions enable row level security;
revoke all on private.schema_versions from public, anon, authenticated;
do $migration$
declare ddl text := $migration_body$create schema if not exists private;

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

-- Included in the versioned migration. All privileged code stays in private.
create table private.operacoes (
  autor_id uuid not null references public.profiles(id) on delete restrict,
  id uuid not null,
  acao text not null,
  dados jsonb not null,
  resultado jsonb not null,
  primary key (autor_id, id)
);
create table public.legado_eventos (
  id bigint generated always as identity primary key,
  obra_id uuid not null references public.obras(id) on delete restrict,
  ordem integer not null,
  bruto jsonb not null,
  importado_por uuid not null references public.profiles(id) on delete restrict,
  importado_em timestamptz not null default now()
);

create function private.exigir_membro() returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare v_id uuid := auth.uid();
begin
  -- Lock membership through the transaction; deactivation cannot race a write.
  perform 1 from public.app_membros where usuario_id = v_id and ativo for share;
  if not found then raise exception 'Operador não autorizado' using errcode = '42501'; end if;
  return v_id;
end $fn$;

create function private.membro_ativo() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null and exists
    (select 1 from public.app_membros where usuario_id = auth.uid() and ativo);
$fn$;

create function private.imutavel() returns trigger
language plpgsql set search_path = '' as $fn$
begin raise exception 'Registro imutável' using errcode = '23514'; end $fn$;

create function private.validar_movimento() returns trigger
language plpgsql set search_path = '' as $fn$
declare original public.obra_movimentos;
begin
  if new.estorna_id is not null then
    select * into strict original from public.obra_movimentos where id = new.estorna_id for update;
    if original.estorna_id is not null or original.obra_id <> new.obra_id
      or original.tipo = new.tipo or original.valor_centavos <> new.valor_centavos then
      raise exception 'Estorno deve ser integral, oposto e da mesma obra' using errcode = '23514';
    end if;
  end if;
  if new.corrige_id is not null then
    select * into strict original from public.obra_movimentos where id = new.corrige_id for update;
    if original.estorna_id is not null or original.obra_id <> new.obra_id
      or not exists (select 1 from public.obra_movimentos where estorna_id = original.id) then
      raise exception 'Correção exige original revertido da mesma obra' using errcode = '23514';
    end if;
  end if;
  return new;
end $fn$;

create function private.validar_pedido_update() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if (to_jsonb(new) - 'estado') <> (to_jsonb(old) - 'estado')
    or old.estado <> 'pendente' or new.estado not in ('aprovada','rejeitada') then
    raise exception 'Transição de solicitação inválida' using errcode = '23514';
  end if;
  return new;
end $fn$;

-- Deferred cross-table invariant in BOTH directions: orphan estorno, terminal
-- request without decision and mismatched decision all fail at COMMIT.
create function private.conferir_decisao() returns trigger
language plpgsql set search_path = '' as $fn$
declare pedido public.exclusao_solicitacoes; decisao public.exclusao_decisoes;
  mov public.obra_movimentos; estorno public.obra_movimentos; v_pedido uuid;
begin
  if tg_table_name = 'obra_movimentos' then
    if new.estorna_id is null then return null; end if;
    select solicitacao_id into v_pedido from public.exclusao_decisoes where estorno_id = new.id;
    if not found then raise exception 'Estorno sem decisão' using errcode = '23514'; end if;
  elsif tg_table_name = 'exclusao_decisoes' then v_pedido := new.solicitacao_id;
  else v_pedido := new.id;
  end if;
  select * into strict pedido from public.exclusao_solicitacoes where id = v_pedido;
  select * into decisao from public.exclusao_decisoes where solicitacao_id = v_pedido;
  if pedido.estado = 'pendente' then
    if decisao.solicitacao_id is not null then raise exception 'Pedido pendente com decisão' using errcode = '23514'; end if;
    return null;
  end if;
  if decisao.solicitacao_id is null or decisao.decisao <> pedido.estado then
    raise exception 'Estado sem decisão coerente' using errcode = '23514';
  end if;
  if not exists (select 1 from public.app_membros a join public.app_membros b on a.lugar <> b.lugar
      where a.usuario_id = pedido.solicitante_id and b.usuario_id = decisao.decisor_id) then
    raise exception 'Decisão exige o outro operador' using errcode = '23514';
  end if;
  if decisao.decisao = 'aprovada' then
    select * into strict mov from public.obra_movimentos where id = pedido.movimento_id;
    select * into strict estorno from public.obra_movimentos where id = decisao.estorno_id;
    if estorno.estorna_id is distinct from mov.id or estorno.obra_id <> mov.obra_id
      or estorno.tipo = mov.tipo or estorno.valor_centavos <> mov.valor_centavos
      or estorno.autor_id <> decisao.decisor_id then
      raise exception 'Decisão e estorno incompatíveis' using errcode = '23514';
    end if;
  end if;
  return null;
end $fn$;

create function private.auditar() returns trigger
language plpgsql set search_path = '' as $fn$
declare anterior jsonb; posterior jsonb;
begin
  if tg_op = 'UPDATE' then anterior := to_jsonb(old); end if;
  posterior := to_jsonb(new);
  insert into public.auditoria_eventos(autor_id, acao, entidade, entidade_id, antes, depois)
  values (auth.uid(), tg_op, tg_table_name,
    coalesce(posterior->>'id', posterior->>'solicitacao_id'), anterior, posterior);
  return new;
end $fn$;

create function private.status_evento() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then
    if new.legado is not null then return new; end if;
  elsif new.status = old.status and new.data_execucao is not distinct from old.data_execucao then
    return new;
  end if;
  insert into public.obra_status_eventos(obra_id, status, data_execucao, autor_id)
  values (new.id, new.status, new.data_execucao, auth.uid());
  return new;
end $fn$;

create trigger movimento_validar before insert on public.obra_movimentos for each row execute function private.validar_movimento();
create trigger movimento_imutavel before update or delete on public.obra_movimentos for each row execute function private.imutavel();
create trigger evento_imutavel before update or delete on public.obra_status_eventos for each row execute function private.imutavel();
create trigger legado_imutavel before update or delete on public.legado_eventos for each row execute function private.imutavel();
create trigger decisao_imutavel before update or delete on public.exclusao_decisoes for each row execute function private.imutavel();
create trigger auditoria_imutavel before update or delete on public.auditoria_eventos for each row execute function private.imutavel();
create trigger pedido_update before update on public.exclusao_solicitacoes for each row execute function private.validar_pedido_update();
create trigger pedido_delete before delete on public.exclusao_solicitacoes for each row execute function private.imutavel();
create trigger obra_delete before delete on public.obras for each row execute function private.imutavel();
create trigger obra_status after insert or update on public.obras for each row execute function private.status_evento();
create trigger obra_auditar after insert or update on public.obras for each row execute function private.auditar();
create trigger movimento_auditar after insert on public.obra_movimentos for each row execute function private.auditar();
create trigger pedido_auditar after insert or update on public.exclusao_solicitacoes for each row execute function private.auditar();
create trigger decisao_auditar after insert on public.exclusao_decisoes for each row execute function private.auditar();
create constraint trigger estorno_decisao after insert on public.obra_movimentos deferrable initially deferred
  for each row execute function private.conferir_decisao();
create constraint trigger decisao_coerente after insert on public.exclusao_decisoes deferrable initially deferred
  for each row execute function private.conferir_decisao();
create constraint trigger pedido_coerente after insert or update on public.exclusao_solicitacoes deferrable initially deferred
  for each row execute function private.conferir_decisao();

-- One entry point, explicit action and key allowlists; no SQL from the client.
create function private.executar(p_acao text, p_dados jsonb, p_operacao uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare ator uuid; anterior private.operacoes; permitidos text[]; r jsonb;
  obra public.obras; mov public.obra_movimentos; pedido public.exclusao_solicitacoes;
  decisao public.exclusao_decisoes; novo_id uuid; alvo uuid;
begin
  ator := private.exigir_membro();
  if p_operacao is null or p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'Operação e objeto são obrigatórios' using errcode = '22023';
  end if;
  -- Serializes a retry even when the first attempt has not committed yet.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(ator::text || p_operacao::text, 0));
  select * into anterior from private.operacoes where autor_id = ator and id = p_operacao;
  if found then
    if anterior.acao <> p_acao or anterior.dados <> p_dados then
      raise exception 'Chave idempotente reutilizada com outro conteúdo' using errcode = '22023';
    end if;
    return anterior.resultado;
  end if;
  case p_acao
    when 'criar_obra' then permitidos := array['cliente','descricao','localizacao','responsavel_cliente','valor_centavos'];
    when 'atualizar_obra' then permitidos := array['id','versao','status','data_execucao'];
    when 'registrar_movimento' then permitidos := array['obra_id','tipo','categoria','descricao','valor_centavos','corrige_id'];
    when 'solicitar_exclusao' then permitidos := array['movimento_id','motivo'];
    when 'decidir_exclusao' then permitidos := array['solicitacao_id','decisao','motivo'];
    else raise exception 'Ação inválida' using errcode = '22023';
  end case;
  if exists (select 1 from jsonb_object_keys(p_dados) k where not (k = any(permitidos))) then
    raise exception 'Campo não permitido' using errcode = '22023';
  end if;
  if p_acao = 'criar_obra' then
    insert into public.obras(cliente, descricao, localizacao, responsavel_cliente, valor_centavos,
      status, criado_por, atualizado_por)
    values (p_dados->>'cliente', p_dados->>'descricao', p_dados->>'localizacao',
      p_dados->>'responsavel_cliente', (p_dados->>'valor_centavos')::bigint, 'Negociacao', ator, ator)
    returning id into novo_id;
  elsif p_acao = 'atualizar_obra' then
    select * into strict obra from public.obras where id = (p_dados->>'id')::uuid for update;
    if obra.versao is distinct from (p_dados->>'versao')::bigint then
      raise exception 'Obra mudou; recarregue antes de salvar' using errcode = '40001';
    end if;
    update public.obras set status = coalesce(p_dados->>'status', status),
      data_execucao = case when p_dados ? 'data_execucao' then (p_dados->>'data_execucao')::date else data_execucao end,
      atualizado_por = ator, atualizado_em = now(), versao = versao + 1 where id = obra.id;
    novo_id := obra.id;
  elsif p_acao = 'registrar_movimento' then
    insert into public.obra_movimentos(obra_id, tipo, categoria, descricao, valor_centavos, corrige_id, autor_id, operacao_id)
    values ((p_dados->>'obra_id')::uuid, p_dados->>'tipo', p_dados->>'categoria', p_dados->>'descricao',
      (p_dados->>'valor_centavos')::bigint, (p_dados->>'corrige_id')::uuid, ator, p_operacao)
    returning id into novo_id;
  elsif p_acao = 'solicitar_exclusao' then
    select * into strict mov from public.obra_movimentos where id = (p_dados->>'movimento_id')::uuid for update;
    if mov.estorna_id is not null or exists (select 1 from public.obra_movimentos where estorna_id = mov.id) then
      raise exception 'Movimento já revertido ou estorno' using errcode = '23514';
    end if;
    insert into public.exclusao_solicitacoes(movimento_id, solicitante_id, motivo, operacao_id)
    values (mov.id, ator, p_dados->>'motivo', p_operacao) returning id into novo_id;
  else
    -- Read target without lock, then consistent order original -> request.
    select movimento_id into strict alvo from public.exclusao_solicitacoes where id = (p_dados->>'solicitacao_id')::uuid;
    select * into strict mov from public.obra_movimentos where id = alvo for update;
    select * into strict pedido from public.exclusao_solicitacoes where id = (p_dados->>'solicitacao_id')::uuid for update;
    if pedido.solicitante_id = ator or not exists (
      select 1 from public.app_membros a join public.app_membros b on a.lugar <> b.lugar
      where a.usuario_id = pedido.solicitante_id and a.ativo and b.usuario_id = ator and b.ativo
    ) then raise exception 'Somente o outro operador pode decidir' using errcode = '42501'; end if;
    if pedido.estado <> 'pendente' then
      select * into strict decisao from public.exclusao_decisoes where solicitacao_id = pedido.id;
      if decisao.decisor_id <> ator or decisao.decisao is distinct from p_dados->>'decisao'
        or decisao.motivo is distinct from p_dados->>'motivo' then
        raise exception 'Solicitação já decidida' using errcode = '23514';
      end if;
      novo_id := pedido.id;
    else
      if p_dados->>'decisao' = 'aprovada' then
        insert into public.obra_movimentos(obra_id, tipo, categoria, descricao, valor_centavos, estorna_id, autor_id, operacao_id)
        values (mov.obra_id, case when mov.tipo = 'entrada' then 'custo' else 'entrada' end,
          mov.categoria, 'Estorno integral', mov.valor_centavos, mov.id, ator, p_operacao)
        returning id into novo_id;
      else novo_id := null;
      end if;
      insert into public.exclusao_decisoes(solicitacao_id, solicitante_id, decisor_id, decisao, motivo, estorno_id)
      values (pedido.id, pedido.solicitante_id, ator, p_dados->>'decisao', p_dados->>'motivo', novo_id);
      update public.exclusao_solicitacoes set estado = p_dados->>'decisao' where id = pedido.id;
      novo_id := pedido.id;
    end if;
  end if;
  r := jsonb_build_object('id', novo_id);
  insert into private.operacoes values (ator, p_operacao, p_acao, p_dados, r);
  return r;
end $fn$;

create function public.executar(p_acao text, p_dados jsonb, p_operacao uuid) returns jsonb
language sql security invoker set search_path = '' as $fn$
  select private.executar(p_acao, p_dados, p_operacao);
$fn$;

-- Administrative, NOT granted to authenticated, NOT exposed as a public RPC.
-- Each accepted obra and its children are imported in a single transaction.
-- Source JSON/hash must be verified by the local offline tool before calling.
create function private.importar_obra(p_origem uuid, p_chave text, p_sha256 text,
  p_conteudo jsonb, p_bruto jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $fn$
declare ator uuid; registro private.importacao_registros; lote uuid;
  obra_id uuid; item jsonb; ordem integer := 0;
begin
  ator := private.exigir_membro();
  if p_origem is null or p_chave is null or length(p_chave) = 0
    or p_sha256 !~ '^[0-9a-f]{64}$' or p_bruto is null then
    raise exception 'Manifesto inválido' using errcode = '22023';
  end if;
  if jsonb_typeof(p_conteudo->'movimentos') is distinct from 'array'
    or jsonb_array_length(p_conteudo->'movimentos') <>
      coalesce(jsonb_array_length(p_bruto->'entradas'),0) + coalesce(jsonb_array_length(p_bruto->'custos'),0) then
    raise exception 'Movimentos convertidos incompletos' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_origem::text || p_chave,0));
  select * into registro from private.importacao_registros
    where origem_id = p_origem and entidade = 'obra' and chave_origem = p_chave;
  if found then
    if registro.bruto <> p_bruto or registro.hash_conteudo <>
      encode(sha256(convert_to(jsonb_build_object('convertido',p_conteudo,'bruto',p_bruto)::text,'UTF8')),'hex') then
      raise exception 'Origem já importada com conteúdo diferente' using errcode = '22023';
    end if;
    return registro.destino_id::uuid;
  end if;
  insert into private.importacao_lotes(origem_id,sha256,importado_por,versao_conversor,relatorio)
  values(p_origem,p_sha256,ator,'1',jsonb_build_object('estado','parcial','origem','legado não verificado'))
  on conflict (sha256) do nothing;
  select id into strict lote from private.importacao_lotes where sha256 = p_sha256 and origem_id = p_origem;
  insert into public.obras(cliente,descricao,localizacao,responsavel_cliente,valor_centavos,status,
    data_execucao,criado_por,atualizado_por,legado)
  values(p_conteudo->>'cliente',p_conteudo->>'descricao',p_conteudo->>'localizacao',p_conteudo->>'responsavel_cliente',
    (p_conteudo->>'valor_centavos')::bigint,p_conteudo->>'status',(p_conteudo->>'data_execucao')::date,ator,ator,p_bruto)
  returning id into obra_id;
  for item in select value from jsonb_array_elements(p_conteudo->'movimentos') loop
    insert into public.obra_movimentos(obra_id,tipo,categoria,descricao,valor_centavos,autor_id,operacao_id,legado)
    values(obra_id,item->>'tipo',item->>'categoria',item->>'descricao',(item->>'valor_centavos')::bigint,
      ator,gen_random_uuid(),item->'bruto');
  end loop;
  for item in select value from jsonb_array_elements(p_bruto->'historico') loop
    insert into public.legado_eventos(obra_id,ordem,bruto,importado_por) values(obra_id,ordem,item,ator);
    ordem := ordem + 1;
  end loop;
  insert into private.importacao_registros(origem_id,entidade,chave_origem,lote_id,destino_id,hash_conteudo,bruto,estado)
  values(p_origem,'obra',p_chave,lote,obra_id::text,
    encode(sha256(convert_to(jsonb_build_object('convertido',p_conteudo,'bruto',p_bruto)::text,'UTF8')),'hex'),p_bruto,'importado');
  return obra_id;
end $fn$;
revoke all on function private.importar_obra(uuid,text,text,jsonb,jsonb) from public, anon, authenticated;

create function private.conferir_importacao(p_sha256 text, p_esperado jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $fn$
declare lote uuid; observado jsonb;
begin
  perform private.exigir_membro();
  select id into strict lote from private.importacao_lotes where sha256 = p_sha256 for update;
  with obras as (
    select destino_id::uuid id from private.importacao_registros
    where lote_id = lote and entidade = 'obra' and estado = 'importado'
  ), movimentos as (
    select m.* from public.obra_movimentos m join obras o on o.id = m.obra_id
    where m.legado is not null
  )
  select jsonb_build_object(
    'obras_validas',(select count(*) from obras),
    'movimentos',(select count(*) from movimentos),
    'eventos',(select count(*) from public.legado_eventos e join obras o on o.id = e.obra_id),
    'entradas_centavos',coalesce((select sum(valor_centavos) from movimentos where tipo='entrada'),0)::text,
    'custos_centavos',coalesce((select sum(valor_centavos) from movimentos where tipo='custo'),0)::text,
    'saldo_centavos',coalesce((select sum(case when tipo='entrada' then valor_centavos else -valor_centavos end) from movimentos),0)::text
  ) into observado;
  if observado is distinct from p_esperado then
    raise exception 'Reconciliação da importação divergiu' using errcode = '23514';
  end if;
  update private.importacao_lotes set relatorio = jsonb_build_object('estado','conferido','totais',observado) where id = lote;
  return observado;
end $fn$;
revoke all on function private.conferir_importacao(text,jsonb) from public, anon, authenticated;

create view public.vw_obra_resumo with (security_invoker = true) as
select o.id as obra_id,
  coalesce(sum(case
    when m.estorna_id is null and m.tipo = 'entrada' then m.valor_centavos
    when m.estorna_id is not null and m.tipo = 'custo' then -m.valor_centavos
    else 0 end),0)::text as entradas_centavos,
  coalesce(sum(case
    when m.estorna_id is null and m.tipo = 'custo' then m.valor_centavos
    when m.estorna_id is not null and m.tipo = 'entrada' then -m.valor_centavos
    else 0 end),0)::text as custos_centavos,
  coalesce(sum(case when m.tipo = 'entrada' then m.valor_centavos
    else -m.valor_centavos end),0)::text as saldo_centavos
from public.obras o left join public.obra_movimentos m on m.obra_id = o.id group by o.id;

create view public.vw_caixa with (security_invoker = true) as
select coalesce(sum(case when tipo = 'entrada' then valor_centavos else -valor_centavos end),0)::text as saldo_centavos
from public.obra_movimentos;

-- A single statement reads a consistent snapshot; bigint values always go over
-- JSON as decimal strings, including monetary aggregates and version counters.
create function public.ler_estado() returns jsonb
language plpgsql security invoker set search_path = '' as $fn$
declare resultado jsonb;
begin
  if not private.membro_ativo() then raise exception 'Operador não autorizado' using errcode = '42501'; end if;
  select jsonb_build_object(
    'usuario_id', auth.uid(),
    'hoje', (now() at time zone 'America/Sao_Paulo')::date,
    'obras', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object(
      'valor_centavos',o.valor_centavos::text,'versao',o.versao::text) order by o.criado_em,o.id) from public.obras o),'[]'::jsonb),
    'movimentos', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('valor_centavos',m.valor_centavos::text)
      order by m.ocorrido_em,m.id) from public.obra_movimentos m),'[]'::jsonb),
    'eventos',coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object('id',e.id::text) order by e.id) from public.obra_status_eventos e),'[]'::jsonb),
    'legado_eventos',coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object('id',e.id::text) order by e.ordem,e.id) from public.legado_eventos e),'[]'::jsonb),
    'solicitacoes',coalesce((select jsonb_agg(s order by s.solicitado_em,s.id) from public.exclusao_solicitacoes s),'[]'::jsonb),
    'decisoes',coalesce((select jsonb_agg(d order by d.decidido_em,d.solicitacao_id) from public.exclusao_decisoes d),'[]'::jsonb),
    'perfis',coalesce((select jsonb_agg(p order by p.id) from public.profiles p),'[]'::jsonb),
    'resumos',coalesce((select jsonb_agg(r order by r.obra_id) from public.vw_obra_resumo r),'[]'::jsonb),
    'saldo_centavos',(select saldo_centavos from public.vw_caixa)
  ) into resultado;
  return resultado;
end $fn$;

-- Defaults of Supabase installations can vary: revoke explicitly, then allow
-- read only. No INSERT/UPDATE/DELETE grants or policies for authenticated.
revoke create on schema public from public, anon, authenticated;
do $block$
declare t text;
begin
  foreach t in array array['profiles','app_membros','obras','obra_status_eventos','obra_movimentos',
    'exclusao_solicitacoes','exclusao_decisoes','auditoria_eventos','legado_eventos'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy membro_le on public.%I for select to authenticated using ((select private.membro_ativo()))',t);
  end loop;
  foreach t in array array['operacoes','importacao_lotes','importacao_registros'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public, anon, authenticated',t);
  end loop;
end $block$;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.executar(text,jsonb,uuid), public.ler_estado() from public, anon, authenticated;
grant execute on function private.membro_ativo(), private.executar(text,jsonb,uuid) to authenticated;
grant execute on function public.executar(text,jsonb,uuid), public.ler_estado() to authenticated;
revoke all on public.vw_obra_resumo, public.vw_caixa from public, anon, authenticated;
grant select on public.vw_obra_resumo, public.vw_caixa to authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

-- Foreign keys used in checks and operational lookups.
create index obras_autor on public.obras(criado_por);
create index obras_atualizador on public.obras(atualizado_por);
create index movimentos_autor on public.obra_movimentos(autor_id);
create index movimentos_correcao on public.obra_movimentos(corrige_id) where corrige_id is not null;
create index eventos_autor on public.obra_status_eventos(autor_id);
create index pedidos_autor on public.exclusao_solicitacoes(solicitante_id);
create index decisoes_solicitante on public.exclusao_decisoes(solicitante_id);
create index decisoes_autor on public.exclusao_decisoes(decisor_id);
create index auditoria_autor on public.auditoria_eventos(autor_id);
create index legado_obra on public.legado_eventos(obra_id,ordem);
create index legado_autor on public.legado_eventos(importado_por);
create index lotes_autor on private.importacao_lotes(importado_por);
create index registros_lote on private.importacao_registros(lote_id,origem_id);
$migration_body$; existing text;
begin
  perform pg_advisory_xact_lock(194762913);
  select checksum into existing from private.schema_versions where version = 'collaborative_ledger_v1';
  if found then
    if existing <> md5(ddl) then raise exception 'Migration checksum mismatch'; end if;
    return;
  end if;
  execute ddl;
  insert into private.schema_versions values ('collaborative_ledger_v1',md5(ddl));
end $migration$;
commit;
