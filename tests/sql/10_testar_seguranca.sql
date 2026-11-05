-- Testes das regras de segurança (RLS), gatilhos e auditoria.
-- Executar depois de 00_simular_supabase.sql, da migração e do seed.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Usuários de teste (fictícios)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@teste.local', '{"nome":"Admin Teste"}'),
  ('00000000-0000-0000-0000-00000000000b', 'gestor@teste.local', '{"nome":"Gestor Teste"}'),
  ('00000000-0000-0000-0000-00000000000c', 'prof.ubs@teste.local', '{"nome":"Prof UBS"}'),
  ('00000000-0000-0000-0000-00000000000d', 'prof.upa@teste.local', '{"nome":"Prof UPA"}'),
  -- tenta se autopromover a admin pelos metadados: deve ser ignorado
  ('00000000-0000-0000-0000-00000000000e', 'intruso@teste.local', '{"nome":"Intruso","papel":"admin"}');

do $$ begin
  assert (select count(*) from public.perfis) = 5, 'gatilho deveria criar 5 perfis';
  assert (select bool_and(not ativo and papel = 'profissional') from public.perfis),
    'perfis devem nascer inativos e como profissional';
end $$;

update public.perfis set papel = 'admin', ativo = true where email = 'admin@teste.local';
update public.perfis set papel = 'gestor', ativo = true where email = 'gestor@teste.local';
update public.perfis set ativo = true,
  unidade_id = (select id from public.unidades where nome = 'UBS Central') where email = 'prof.ubs@teste.local';
update public.perfis set ativo = true,
  unidade_id = (select id from public.unidades where tipo = 'UPA') where email = 'prof.upa@teste.local';

-- ---------------- Profissional da UBS ----------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';

insert into public.atendimentos (unidade_origem_id, relato, destino_recomendado, destino_escolhido, nivel_recomendado, criterios)
select id, 'Paciente com gripe e dor de garganta', 'UBS', 'UBS', 'primaria', array['Regra original: gripe']
from public.unidades where nome = 'UBS Central';

-- Divergência sem justificativa deve falhar
do $$ begin
  begin
    insert into public.atendimentos (unidade_origem_id, relato, destino_recomendado, destino_escolhido)
    select id, 'teste divergencia', 'UBS', 'UPA' from public.unidades where nome = 'UBS Central';
    raise exception 'divergência sem justificativa deveria falhar';
  exception when check_violation then null;
  end;
end $$;

-- Não pode alterar configurações nem se promover
do $$ begin
  update public.configuracoes set custo_ubs = 1;
  assert not found, 'profissional não pode alterar configurações';
  update public.perfis set papel = 'admin' where id = auth.uid();
  assert not found, 'profissional não pode alterar o próprio papel';
  assert (select count(*) from public.linha_base) = 0;
end $$;

-- Relato e recomendação são imutáveis; resultado pode ser atualizado
update public.atendimentos set relato = 'adulterado', destino_recomendado = 'HOSPITAL', resultado = 'atendido_no_destino';
do $$ begin
  assert (select relato from public.atendimentos limit 1) = 'Paciente com gripe e dor de garganta', 'relato deve ser imutável';
  assert (select destino_recomendado from public.atendimentos limit 1) = 'UBS', 'recomendação deve ser imutável';
  assert (select resultado from public.atendimentos limit 1) = 'atendido_no_destino';
  assert (select resultado_em from public.atendimentos limit 1) is not null;
  assert (select count(*) from public.auditoria) >= 2, 'histórico do atendimento visível ao profissional';
end $$;

-- ---------------- Profissional da UPA: não vê atendimentos da UBS ----------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin
  assert (select count(*) from public.atendimentos) = 0, 'profissional de outra unidade não deve ver o atendimento';
  assert (select count(*) from public.auditoria) = 0, 'nem o histórico dele';
end $$;

-- ---------------- Usuário inativo: não vê nada ----------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $$ begin
  assert (select count(*) from public.unidades) = 0, 'inativo não lê unidades';
  assert public.papel_atual() is null;
  begin
    insert into public.atendimentos (unidade_origem_id, relato, destino_escolhido)
    select id, 'invasão', 'UBS' from public.unidades limit 1;
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------- Gestor ----------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.atendimentos) = 1, 'gestor vê todos os atendimentos';
  begin
    insert into public.atendimentos (unidade_origem_id, relato, destino_escolhido)
    select id, 'gestor tentando', 'UBS' from public.unidades limit 1;
    raise exception 'gestor não deveria registrar atendimento';
  exception when insufficient_privilege then null;
  end;
  update public.configuracoes set custo_ubs = 1;
  assert not found, 'gestor não altera configurações';
end $$;

-- ---------------- Administrador ----------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.configuracoes set custo_hospital = 450;
insert into public.linha_base (competencia, tipo_unidade, atendimentos, fonte)
values ('2026-01-01', 'UPA', 1200, 'Relatório SIA/SUS jan/2026 (teste)');
do $$ begin
  assert (select custo_hospital from public.configuracoes) = 450;
  assert (select count(*) from public.auditoria where tabela = 'configuracoes' and acao = 'UPDATE') = 1;
  assert (select usuario_id from public.auditoria where tabela = 'configuracoes' and acao = 'UPDATE')
         = '00000000-0000-0000-0000-00000000000a', 'auditoria registra quem alterou';
  assert (select count(*) from public.regras_encaminhamento where origem = 'original') = 60,
    'as 60 regras originais devem estar semeadas';
end $$;

reset role;
\echo 'TODOS OS TESTES DE SEGURANÇA PASSARAM'
