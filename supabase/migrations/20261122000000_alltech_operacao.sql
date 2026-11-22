begin;
create table private.alltech_localizacao (
 obra_id uuid primary key references public.obras,
 uf text check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
 cidade text check (length(cidade) between 1 and 120),
 versao integer not null default 1
);
create table private.alltech_participantes (
 id uuid primary key default gen_random_uuid(),
 obra_id uuid references public.obras,
 nome text not null check (length(btrim(nome)) between 1 and 120),
 ordem smallint unique,
 check ((obra_id is null) = (ordem is not null))
);
insert into private.alltech_participantes(id,nome,ordem) values
 ('a117ec00-0000-4000-8000-000000000001','Ildebrando',1),
 ('a117ec00-0000-4000-8000-000000000002','Edson',2),
 ('a117ec00-0000-4000-8000-000000000003','Ivan',3);
create table private.alltech_percentuais (
 obra_id uuid references public.obras,
 versao integer not null,
 pesos jsonb not null,
 autor_id uuid not null references public.profiles,
 registrado_em timestamptz not null default now(),
 primary key (obra_id,versao)
);
create table private.alltech_adiantamentos (
 id uuid primary key default gen_random_uuid(),
 obra_id uuid not null references public.obras,
 participante_id uuid not null references private.alltech_participantes,
 centavos bigint not null check (centavos between 1 and 999999999999),
 data date not null,
 observacao text not null check (length(observacao)<=1000),
 autor_id uuid not null references public.profiles,
 registrado_em timestamptz not null default now()
);
create index alltech_adiantamentos_obra on private.alltech_adiantamentos(obra_id,participante_id);
create table private.alltech_estornos (
 id uuid primary key default gen_random_uuid(),
 adiantamento_id uuid not null references private.alltech_adiantamentos,
 solicitante uuid not null references public.profiles,
 motivo text not null check (length(btrim(motivo)) between 3 and 1000),
 solicitado_em timestamptz not null default now(),
 decisor uuid references public.profiles,
 decisao text check (decisao in ('aprovada','rejeitada')),
 justificativa text check (length(btrim(justificativa)) between 3 and 1000),
 decidido_em timestamptz,
 check (decisor is distinct from solicitante),
 check ((decisor is null and decisao is null and justificativa is null and decidido_em is null) or
        (decisor is not null and decisao is not null and justificativa is not null and decidido_em is not null))
);
create unique index alltech_estorno_vigente on private.alltech_estornos(adiantamento_id)
 where decisao is null or decisao='aprovada';
create table private.alltech_agenda (
 id uuid primary key default gen_random_uuid(),
 obra_id uuid references public.obras,
 descricao text not null check(length(btrim(descricao)) between 1 and 500),
 data date,
 horario time,
 autor_id uuid not null references public.profiles,
 criado_em timestamptz not null default now(),
 concluido_por uuid references public.profiles,
 concluido_em timestamptz,
 check ((concluido_por is null)=(concluido_em is null))
);
create table private.alltech_liquidacoes (
 obra_id uuid primary key references public.obras,
 autor_id uuid not null references public.profiles,
 registrado_em timestamptz not null default now(),
 demonstrativo jsonb not null
);
do $$ declare t text; begin
 foreach t in array array['localizacao','participantes','percentuais','adiantamentos','estornos','agenda','liquidacoes'] loop
  execute format('alter table private.alltech_%I enable row level security',t);
  execute format('revoke all on private.alltech_%I from public,anon,authenticated,service_role,app_gateway',t);
 end loop;
end $$;

-- Método dos maiores restos. numeric preserva centavos mesmo acima da escala JS.
create function private.alltech_ratear(p_total numeric,p_pesos jsonb)
returns table(id uuid,centavos numeric)
language sql immutable set search_path='' as $$
 with pesos as (
  select key::uuid id,value::numeric peso from jsonb_each_text(p_pesos)
 ), cotas as (
  select id, p_total*peso as numerador, sum(peso) over () as divisor from pesos where peso>0
 ), partes as (
  select id, div(numerador,divisor) base, mod(numerador,divisor) resto from cotas
 )
 select id, base+case when row_number() over(order by resto desc,id)<=p_total-sum(base) over () then 1 else 0 end
 from partes
$$;

create function private.alltech_financeiro(p_obra uuid) returns jsonb
language sql stable set search_path='' as $$
 with obra as (
  select o.id,o.valor_centavos,r.entradas_centavos,r.custos_centavos,r.saldo_centavos,
    greatest(r.saldo_centavos::numeric,0) distribuivel
  from public.obras o join public.vw_obra_resumo r on r.obra_id=o.id where o.id=p_obra
 ), versao as (
  select p.versao,p.pesos from private.alltech_percentuais p where p.obra_id=p_obra order by p.versao desc limit 1
 ), participantes as (
  select p.id,p.nome,p.ordem,
   coalesce((select (pesos->>p.id::text)::integer from versao),case when p.ordem is null then 0 else 1 end) peso
  from private.alltech_participantes p where p.obra_id is null or p.obra_id=p_obra
 ), adicionais as (
  select coalesce(jsonb_object_agg(id,peso),'{}'::jsonb) ||
   jsonb_build_object('00000000-0000-0000-0000-000000000000',10000-coalesce(sum(peso),0)) pesos
  from participantes where ordem is null
 ), primeiro as (
  select r.* from obra, adicionais cross join lateral private.alltech_ratear(obra.distribuivel,adicionais.pesos) r
 ), segundo as (
  select r.* from private.alltech_ratear(
    coalesce((select centavos from primeiro where id='00000000-0000-0000-0000-000000000000'),0),
    (select jsonb_object_agg(id,peso) from participantes where ordem is not null)) r
 ), parcelas as (
  select * from primeiro union all select * from segundo
 ), adiantados as (
  select a.participante_id, sum(a.centavos) total from private.alltech_adiantamentos a
  where a.obra_id=p_obra and not exists(select 1 from private.alltech_estornos e where e.adiantamento_id=a.id and e.decisao='aprovada')
  group by a.participante_id
 ), saldos as (
  select p.*,coalesce(a.total,0) adiantado,coalesce(r.centavos,0) quota
  from participantes p left join parcelas r using(id) left join adiantados a on a.participante_id=p.id
 )
 select jsonb_build_object('obra_id',obra.id,'contratado',obra.valor_centavos::text,
   'entradas',obra.entradas_centavos,'custos',obra.custos_centavos,'resultado',obra.saldo_centavos,
   'adiantamentos',coalesce((select sum(adiantado) from saldos),0)::text,
   'caixa',(obra.saldo_centavos::numeric-coalesce((select sum(adiantado) from saldos),0))::text,
   'versao',coalesce((select versao from versao),0),
   'participantes',(select jsonb_agg(jsonb_build_object('id',id,'nome',nome,'operador',ordem is not null,
       'peso',peso,'participacao',quota::text,'adiantado',adiantado::text,'saldo',(quota-adiantado)::text)
       order by ordem nulls last,nome,id) from saldos))
 from obra
$$;

create function private.alltech_ler() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.membro_ativo() then raise exception 'Acesso negado' using errcode='42501'; end if;
 return jsonb_build_object(
  'usuario_id',auth.uid(),
  'localizacoes',coalesce((select jsonb_object_agg(obra_id,to_jsonb(l)) from private.alltech_localizacao l),'{}'),
  'financeiro',coalesce((select jsonb_agg(private.alltech_financeiro(id) order by id) from public.obras),'[]'),
  'adiantamentos',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('centavos',a.centavos::text,
   'participante',p.nome,'estornos',coalesce((select jsonb_agg(e order by e.solicitado_em,e.id)
    from private.alltech_estornos e where e.adiantamento_id=a.id),'[]'::jsonb)) order by a.data desc,a.id)
    from private.alltech_adiantamentos a join private.alltech_participantes p on p.id=a.participante_id),'[]'),
  'agenda',coalesce((select jsonb_agg(a order by a.concluido_em nulls first,a.data nulls last,a.horario nulls last,a.id)
    from private.alltech_agenda a),'[]'),
  'liquidacoes',coalesce((select jsonb_agg(l order by l.registrado_em,l.obra_id) from private.alltech_liquidacoes l),'[]'),
  'percentuais',coalesce((select jsonb_agg(p order by p.obra_id,p.versao) from private.alltech_percentuais p),'[]'));
end $$;

create function private.alltech_executar(p_usuario uuid,p_acao text,p_dados jsonb,p_operacao uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ator uuid; anterior private.operacoes; alvo uuid; retorno uuid; r jsonb; taxas jsonb; v integer;
  pedido private.alltech_estornos; permitidos text[];
begin
 ator:=private.exigir_membro();
 if p_usuario is distinct from ator then raise exception 'Sessão mudou' using errcode='42501'; end if;
 if p_operacao is null or jsonb_typeof(p_dados) is distinct from 'object' then
  raise exception 'Operação inválida' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock_shared(194762914);
 perform pg_advisory_xact_lock(hashtextextended(ator::text||p_operacao::text,0));
 select * into anterior from private.operacoes where autor_id=ator and id=p_operacao;
 if found then
  if anterior.acao is distinct from p_acao or anterior.dados is distinct from p_dados then
   raise exception 'Chave reutilizada com outro conteúdo' using errcode='22023';
  end if;
  return anterior.resultado;
 end if;
 case p_acao
  when 'alltech_criar_obra' then permitidos:=array['cliente','descricao','localizacao','responsavel_cliente','valor_centavos','uf','cidade'];
  when 'alltech_localizacao' then permitidos:=array['obra_id','versao','uf','cidade'];
  when 'alltech_participante' then permitidos:=array['obra_id','versao','nome','peso'];
  when 'alltech_percentuais' then permitidos:=array['obra_id','versao','pesos'];
  when 'alltech_adiantar' then permitidos:=array['obra_id','participante_id','valor_centavos','data','observacao'];
  when 'alltech_solicitar_estorno' then permitidos:=array['adiantamento_id','motivo'];
  when 'alltech_decidir_estorno' then permitidos:=array['solicitacao_id','decisao','motivo'];
  when 'alltech_liquidar' then permitidos:=array['obra_id','versao','demonstrativo'];
  when 'alltech_agendar' then permitidos:=array['obra_id','data','horario','descricao'];
  when 'alltech_concluir' then permitidos:=array['id'];
  else raise exception 'Ação inválida' using errcode='22023';
 end case;
 if exists(select 1 from jsonb_object_keys(p_dados) k where not(k=any(permitidos))) then
  raise exception 'Campo não permitido' using errcode='22023';
 end if;
 alvo:=(p_dados->>'obra_id')::uuid;
 if p_acao='alltech_solicitar_estorno' then
  select obra_id into strict alvo from private.alltech_adiantamentos where id=(p_dados->>'adiantamento_id')::uuid;
 elsif p_acao='alltech_decidir_estorno' then
  select a.obra_id into strict alvo from private.alltech_estornos e join private.alltech_adiantamentos a on a.id=e.adiantamento_id
  where e.id=(p_dados->>'solicitacao_id')::uuid;
 end if;

 if p_acao='alltech_criar_obra' then
  retorno:=(private.executar('criar_obra',p_dados-array['uf','cidade'],gen_random_uuid())->>'id')::uuid;
  insert into private.alltech_localizacao(obra_id,uf,cidade)
   values(retorno,nullif(p_dados->>'uf',''),nullif(btrim(p_dados->>'cidade'),''));
 elsif p_acao='alltech_agendar' then
  insert into private.alltech_agenda(obra_id,descricao,data,horario,autor_id)
   values(alvo,p_dados->>'descricao',(p_dados->>'data')::date,(p_dados->>'horario')::time,ator) returning id into retorno;
 elsif p_acao='alltech_concluir' then
  update private.alltech_agenda set concluido_por=ator,concluido_em=now()
   where id=(p_dados->>'id')::uuid and concluido_em is null returning id into retorno;
  if not found then raise exception 'Compromisso indisponível' using errcode='23514'; end if;
 else
  perform 1 from public.obras where id=alvo for update;
  if not found then raise exception 'Obra inválida' using errcode='23514'; end if;
  retorno:=alvo;
  if p_acao='alltech_localizacao' then
   select versao into v from private.alltech_localizacao where obra_id=alvo;
   if coalesce(v,0) is distinct from (p_dados->>'versao')::integer then
    raise exception 'Localização mudou' using errcode='PT409';
   end if;
   insert into private.alltech_localizacao(obra_id,uf,cidade)
   values(alvo,nullif(p_dados->>'uf',''),nullif(btrim(p_dados->>'cidade'),''))
   on conflict(obra_id) do update set uf=excluded.uf,cidade=excluded.cidade,versao=alltech_localizacao.versao+1;
  elsif p_acao in ('alltech_participante','alltech_percentuais','alltech_liquidar') then
   if exists(select 1 from private.alltech_liquidacoes where obra_id=alvo) then
    raise exception 'Distribuição já liquidada' using errcode='23514';
   end if;
   r:=private.alltech_financeiro(alvo);
   v:=(r->>'versao')::integer;
   if v is distinct from (p_dados->>'versao')::integer then raise exception 'Percentuais mudaram' using errcode='PT409'; end if;
   if p_acao='alltech_liquidar' then
    if r is distinct from p_dados->'demonstrativo' then raise exception 'Demonstrativo mudou' using errcode='PT409'; end if;
    insert into private.alltech_liquidacoes(obra_id,autor_id,demonstrativo) values(alvo,ator,r);
   else
    if p_acao='alltech_participante' then
     insert into private.alltech_participantes(obra_id,nome) values(alvo,btrim(p_dados->>'nome')) returning id into retorno;
     select jsonb_object_agg(x->>'id',x->'peso') into taxas from jsonb_array_elements(r->'participantes') x;
     taxas:=taxas||jsonb_build_object(retorno,(p_dados->>'peso')::integer);
    else taxas:=p_dados->'pesos';
    end if;
    if jsonb_typeof(taxas) is distinct from 'object' then raise exception 'Percentuais inválidos' using errcode='23514'; end if;
    if exists(
      select 1 from jsonb_each(taxas) j full join
       (select id,ordem from private.alltech_participantes where obra_id is null or obra_id=alvo) p
       on j.key=p.id::text
      where j.key is null or p.id is null or jsonb_typeof(j.value)<>'number' or j.value::text !~ '^[0-9]{1,5}$'
        or (j.value::text)::numeric>10000
    ) then raise exception 'Percentuais inválidos' using errcode='23514'; end if;
    if (select sum((taxas->>id::text)::integer) from private.alltech_participantes where obra_id=alvo)>10000
     or (select sum((taxas->>id::text)::integer) from private.alltech_participantes where ordem is not null)=0
    then raise exception 'Soma de percentuais inválida' using errcode='23514'; end if;
    insert into private.alltech_percentuais(obra_id,versao,pesos,autor_id) values(alvo,v+1,taxas,ator);
   end if;
  elsif p_acao='alltech_adiantar' then
   if not exists(select 1 from private.alltech_participantes where id=(p_dados->>'participante_id')::uuid and (obra_id is null or obra_id=alvo))
    then raise exception 'Participante inválido' using errcode='23514'; end if;
   insert into private.alltech_adiantamentos(obra_id,participante_id,centavos,data,observacao,autor_id)
    values(alvo,(p_dados->>'participante_id')::uuid,(p_dados->>'valor_centavos')::bigint,
     (p_dados->>'data')::date,coalesce(p_dados->>'observacao',''),ator) returning id into retorno;
  elsif p_acao='alltech_solicitar_estorno' then
   insert into private.alltech_estornos(adiantamento_id,solicitante,motivo)
    values((p_dados->>'adiantamento_id')::uuid,ator,p_dados->>'motivo') returning id into retorno;
  else
   select * into strict pedido from private.alltech_estornos where id=(p_dados->>'solicitacao_id')::uuid for update;
   if pedido.solicitante=ator or not private.operador_habilitado(pedido.solicitante) then
    raise exception 'Exige outro operador ativo' using errcode='42501';
   end if;
   if pedido.decisao is not null then raise exception 'Pedido já decidido' using errcode='23514'; end if;
   update private.alltech_estornos set decisor=ator,decisao=p_dados->>'decisao',justificativa=p_dados->>'motivo',decidido_em=now()
    where id=pedido.id returning id into retorno;
  end if;
 end if;
 r:=jsonb_build_object('id',retorno);
 insert into private.operacoes(autor_id,id,acao,dados,resultado) values(ator,p_operacao,p_acao,p_dados,r);
 return r;
end $$;
create function public.alltech_ler() returns jsonb language sql stable security invoker set search_path=''
 as $$select private.alltech_ler()$$;
create function public.alltech_executar(p_usuario uuid,p_acao text,p_dados jsonb,p_operacao uuid)
 returns jsonb language sql security invoker set search_path=''
 as $$select private.alltech_executar(p_usuario,p_acao,p_dados,p_operacao)$$;
revoke all on function private.alltech_ratear(numeric,jsonb),private.alltech_financeiro(uuid),
 private.alltech_ler(),private.alltech_executar(uuid,text,jsonb,uuid),
 public.alltech_ler(),public.alltech_executar(uuid,text,jsonb,uuid)
 from public,anon,authenticated,service_role,app_gateway;
grant execute on function private.alltech_ler(),private.alltech_executar(uuid,text,jsonb,uuid),
 public.alltech_ler(),public.alltech_executar(uuid,text,jsonb,uuid) to authenticated;
commit;
