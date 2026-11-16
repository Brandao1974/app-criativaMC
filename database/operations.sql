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
