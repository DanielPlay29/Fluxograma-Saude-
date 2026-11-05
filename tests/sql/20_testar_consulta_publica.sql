-- Testes da consulta pública (sem login). Executar depois de 10_testar_seguranca.sql
\set ON_ERROR_STOP on
set client_min_messages = warning;

set role anon;
reset request.jwt.claim.sub;
set request.headers = '{"x-forwarded-for": "200.1.2.3, 10.0.0.1"}';

do $$
declare p bigint;
begin
  -- Visitante lê unidades e regras pelas funções públicas, mas não as tabelas
  assert (select count(*) from public.unidades_publicas()) = 5;
  assert (select count(*) from public.regras_publicas()) = 60;
  begin
    perform 1 from public.atendimentos;
    raise exception 'anon não deveria ler atendimentos';
  exception when insufficient_privilege then null;
  end;

  p := public.registrar_consulta_publica('estou com gripe e dor de garganta', '18-39', 'UPA',
        '{"resumo_tecnico":"Paciente relata gripe."}', 'regras', '{}', 'primaria', 'UBS',
        array['Regra original: "gripe" → Atenção Primária']);
  assert p is not null;

  -- indefinido → UBS (porta de entrada do SUS)
  perform public.registrar_consulta_publica('dor no joelho', null, null, null, 'regras', '{}', 'indefinido', 'UBS', '{}');

  -- destino incoerente com o nível é recusado (evita estatística falsa)
  begin
    perform public.registrar_consulta_publica('gripe', null, null, null, 'regras', '{}', 'primaria', 'HOSPITAL', '{}');
    raise exception 'deveria recusar destino incoerente';
  exception when invalid_parameter_value then null;
  end;

  -- CPF no relato é recusado (LGPD)
  begin
    perform public.registrar_consulta_publica('meu cpf 123.456.789-00 gripe', null, null, null, 'regras', '{}', 'primaria', 'UBS', '{}');
    raise exception 'deveria recusar CPF';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Limite: 6 por 10 minutos por IP
do $$
declare i int;
begin
  for i in 1..4 loop
    perform public.registrar_consulta_publica('gripe forte', null, null, null, 'regras', '{}', 'primaria', 'UBS', '{}');
  end loop;
  begin
    perform public.registrar_consulta_publica('gripe forte', null, null, null, 'regras', '{}', 'primaria', 'UBS', '{}');
    raise exception 'deveria bloquear pelo limite';
  exception when program_limit_exceeded then null;
  end;
end $$;

-- Outro IP continua podendo usar
set request.headers = '{"x-forwarded-for": "189.9.9.9"}';
select public.registrar_consulta_publica('febre baixa', null, 'HOSPITAL', null, 'ia', '{}', 'primaria', 'UBS', '{}') is not null as ok \gset
\if :ok
\else
  \echo 'falhou outro IP'
\endif

-- Admin enxerga as consultas do site; profissional não; IP não é guardado
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select count(*) from public.atendimentos where canal = 'site') = 7, 'admin vê as 7 consultas do site';
  assert (select count(*) from public.atendimentos where relato like '%200.1.2.3%' or ip_hash like '200%') = 0;
  assert (select intencao_inicial from public.atendimentos where relato = 'estou com gripe e dor de garganta') = 'UPA';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  assert (select count(*) from public.atendimentos where canal = 'site') = 0, 'profissional não vê consultas do site';
  begin
    insert into public.atendimentos (canal, created_by, unidade_origem_id, relato, destino_escolhido)
    select 'site', auth.uid(), id, 'tentativa', 'UBS' from public.unidades limit 1;
    raise exception 'profissional não pode gravar como site';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo 'TODOS OS TESTES DA CONSULTA PÚBLICA PASSARAM'
