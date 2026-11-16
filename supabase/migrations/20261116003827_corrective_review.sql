-- Generated from database/corrective.sql.
begin;
do $migration$
declare ddl text := $corrective_body$-- Correction round: preserve reviewed v1; apply as a separate migration.
-- One successor forever; further corrections form a new approved chain.
create unique index movimentos_uma_correcao on public.obra_movimentos(corrige_id)
  where corrige_id is not null;
create or replace function private.validar_movimento() returns trigger
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
      or original.tipo <> new.tipo
      or not exists (select 1 from public.obra_movimentos where estorna_id = original.id) then
      raise exception 'Correção exige original revertido da mesma obra' using errcode = '23514';
    end if;
  end if;
  return new;
end $fn$;
create or replace function private.executar(p_acao text, p_dados jsonb, p_operacao uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare ator uuid; anterior private.operacoes; permitidos text[]; r jsonb;
  obra public.obras; mov public.obra_movimentos; pedido public.exclusao_solicitacoes;
  decisao public.exclusao_decisoes; novo_id uuid; alvo uuid;
begin
  ator := private.exigir_membro();
  perform pg_catalog.pg_advisory_xact_lock_shared(194762914);
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

-- The importer identity comes from the original database login, NEVER a JWT
-- supplied by a browser or SET ROLE. Only a DBA can provision this allowlist.
alter table private.importacao_lotes add column login_importador name;
create table private.importacao_operadores (
  login_name name primary key,
  ator_id uuid not null references public.profiles(id) on delete restrict,
  ativo boolean not null default true,
  valido_ate timestamptz not null
);
alter table private.importacao_operadores enable row level security;
revoke all on private.importacao_operadores from public, anon, authenticated;

create function private.exigir_importador() returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare ator uuid;
begin
  select i.ator_id into ator from private.importacao_operadores i
    join public.app_membros m on m.usuario_id=i.ator_id
    where i.login_name=session_user and i.ativo and i.valido_ate>statement_timestamp() and m.ativo
    for share of i,m;
  if not found then raise exception 'Login administrativo de importação não autorizado' using errcode='42501'; end if;
  return ator;
end $fn$;
revoke all on function private.exigir_importador() from public,anon,authenticated;
create function private.identidade_importacao() returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare ator uuid;
begin
  ator:=private.exigir_importador();
  return jsonb_build_object('login',session_user,'ator_id',ator);
end $fn$;
revoke all on function private.identidade_importacao() from public,anon,authenticated;
-- Administrative, NOT granted to authenticated, NOT exposed as a public RPC.
-- Each accepted obra and its children are imported in a single transaction.
-- Source JSON/hash must be verified by the local offline tool before calling.
create or replace function private.importar_obra(p_origem uuid, p_chave text, p_sha256 text,
  p_conteudo jsonb, p_bruto jsonb) returns uuid
language plpgsql security definer set search_path = '' as $fn$
declare ator uuid; registro private.importacao_registros; lote uuid;
  obra_id uuid; item jsonb; ordem integer := 0; claim_anterior text;
begin
  ator := private.exigir_importador();
  perform pg_catalog.pg_advisory_xact_lock(194762914);
  claim_anterior := current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',ator::text,true);
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
    perform set_config('request.jwt.claim.sub',coalesce(claim_anterior,''),true);
    return registro.destino_id::uuid;
  end if;
  insert into private.importacao_lotes(origem_id,sha256,importado_por,login_importador,versao_conversor,relatorio)
  values(p_origem,p_sha256,ator,session_user,'1',jsonb_build_object('estado','parcial','origem','legado não verificado'))
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
  perform set_config('request.jwt.claim.sub',coalesce(claim_anterior,''),true);
  return obra_id;
end $fn$;
revoke all on function private.importar_obra(uuid,text,text,jsonb,jsonb) from public, anon, authenticated;

create or replace function private.conferir_importacao(p_sha256 text, p_esperado jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare lote uuid; observado jsonb; claim_anterior text; ator uuid;
begin
  ator := private.exigir_importador();
  perform pg_catalog.pg_advisory_xact_lock(194762914);
  claim_anterior := current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',ator::text,true);
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
  update private.importacao_lotes set relatorio = jsonb_build_object('estado','conferido','totais',observado,
    'conferido_por',session_user,'conferido_em',now()) where id = lote;
  perform set_config('request.jwt.claim.sub',coalesce(claim_anterior,''),true);
  return observado;
end $fn$;
revoke all on function private.conferir_importacao(text,jsonb) from public, anon, authenticated;

-- Opaque recovery IDs may be kept in browser storage; financial payloads stay
-- exclusively in private.operacoes. This lookup waits for an in-flight command.
create function private.consultar_operacao(p_operacao uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare ator uuid; op private.operacoes;
begin
  ator:=private.exigir_membro();
  if p_operacao is null then raise exception 'Identificador obrigatório' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ator::text||p_operacao::text,0));
  select * into op from private.operacoes where autor_id=ator and id=p_operacao;
  if not found then return jsonb_build_object('estado','ausente'); end if;
  return jsonb_build_object('estado',case when op.acao='cancelada' then 'cancelada' else 'concluida' end,
    'acao',op.acao,'resultado',op.resultado);
end $fn$;

-- A cancellation is a durable tombstone: a delayed HTTP request with this ID
-- can no longer create a movement. If already committed, return its result.
create function private.encerrar_operacao(p_operacao uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare ator uuid; op private.operacoes;
begin
  ator:=private.exigir_membro();
  if p_operacao is null then raise exception 'Identificador obrigatório' using errcode='22023'; end if;
  perform pg_advisory_xact_lock_shared(194762914);
  perform pg_advisory_xact_lock(hashtextextended(ator::text||p_operacao::text,0));
  select * into op from private.operacoes where autor_id=ator and id=p_operacao;
  if not found then
    insert into private.operacoes values(ator,p_operacao,'cancelada','{}','{"cancelada":true}');
    return jsonb_build_object('estado','cancelada');
  end if;
  return jsonb_build_object('estado',case when op.acao='cancelada' then 'cancelada' else 'concluida' end,
    'acao',op.acao,'resultado',op.resultado);
end $fn$;

create function public.consultar_operacao(p_operacao uuid) returns jsonb
language sql security invoker set search_path = '' as $fn$
  select private.consultar_operacao(p_operacao);
$fn$;
create function public.encerrar_operacao(p_operacao uuid) returns jsonb
language sql security invoker set search_path = '' as $fn$
  select private.encerrar_operacao(p_operacao);
$fn$;
revoke all on function private.consultar_operacao(uuid),private.encerrar_operacao(uuid),
  public.consultar_operacao(uuid),public.encerrar_operacao(uuid) from public,anon,authenticated;
grant execute on function private.consultar_operacao(uuid),private.encerrar_operacao(uuid),
  public.consultar_operacao(uuid),public.encerrar_operacao(uuid) to authenticated;

-- UI receipts are scoped to an actor. Refuse a delayed UI action if the SDK
-- has switched accounts before acquiring/sending its access token.
create function public.executar_com_identidade(p_usuario_esperado uuid,p_acao text,p_dados jsonb,p_operacao uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $fn$
begin
  if p_usuario_esperado is null or p_usuario_esperado is distinct from auth.uid() then
    raise exception 'Sessão mudou antes do envio' using errcode='42501';
  end if;
  return private.executar(p_acao,p_dados,p_operacao);
end $fn$;
revoke all on function public.executar_com_identidade(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.executar_com_identidade(uuid,text,jsonb,uuid) to authenticated;
create function public.recuperar_operacao(p_usuario_esperado uuid,p_operacao uuid,p_encerrar boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $fn$
begin
  if p_usuario_esperado is null or p_usuario_esperado is distinct from auth.uid() then
    raise exception 'Sessão mudou antes da recuperação' using errcode='42501';
  end if;
  if p_encerrar is null then raise exception 'Ação de recuperação obrigatória' using errcode='22023'; end if;
  if p_encerrar then return private.encerrar_operacao(p_operacao); end if;
  return private.consultar_operacao(p_operacao);
end $fn$;
revoke all on function public.recuperar_operacao(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.recuperar_operacao(uuid,uuid,boolean) to authenticated;
$corrective_body$; existing text;
begin
 perform pg_advisory_xact_lock(194762913);
 select checksum into existing from private.schema_versions where version='corrective_review_v2';
 if found then
  if existing<>md5(ddl) then raise exception 'Migration checksum mismatch'; end if;
  return;
 end if;
 execute ddl;
 insert into private.schema_versions values('corrective_review_v2',md5(ddl));
end $migration$;
commit;
