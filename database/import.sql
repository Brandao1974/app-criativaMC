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
