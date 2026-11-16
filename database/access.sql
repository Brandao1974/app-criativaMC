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
