-- =====================================================================
-- Dados iniciais (executar UMA vez, depois da migração)
-- =====================================================================

-- Unidades: as mesmas que já existiam nas páginas UBS.html, UPA.html e Hospital.html.
-- Confira endereços e telefones com a Secretaria Municipal antes de usar em produção.
insert into public.unidades (nome, tipo, cidade, endereco, telefone, servicos, pagina_publica, latitude, longitude)
select * from (values
  ('UBS Central', 'UBS'::public.tipo_unidade, 'Luís Eduardo Magalhães - BA',
   'Av. Salvador, 123, Centro', '(77) 3628-5678',
   'Atendimento básico de saúde, vacinação, consultas de rotina, pré-natal e acompanhamento de doenças crônicas.',
   'UBS.html', -12.0924186, -45.7976303),
  ('UBS Jardim Paraíso', 'UBS'::public.tipo_unidade, 'Luís Eduardo Magalhães - BA',
   'Rua das Flores, 456, Jardim Paraíso', '(77) 3628-9012',
   'Atendimento a crianças, gestantes, vacinação e consultas de acompanhamento.',
   'UBS.html', -12.100987654321, -45.8123456789),
  ('UPA Luís Eduardo Magalhães', 'UPA'::public.tipo_unidade, 'Luís Eduardo Magalhães - BA',
   'Av. Barreiras, 123, Centro', '(77) 3628-1234',
   'Atendimento de emergências e urgências, como febre alta, dores intensas, fraturas e crises respiratórias.',
   'UPA.html', -12.0924186, -45.7976303),
  ('Hospital São Luís Eduardo Magalhães', 'HOSPITAL'::public.tipo_unidade, 'Luís Eduardo Magalhães - BA',
   'Av. Barreiras, 1234, Centro', '(77) 3628-1234',
   'Referência em emergências e alta complexidade: cirurgia, terapia intensiva, cardiologia e oncologia.',
   'Hospital.html', -12.0924186, -45.7976303),
  ('SAMU 192 – Serviço de Emergência', 'EMERGENCIA'::public.tipo_unidade, 'Luís Eduardo Magalhães - BA',
   null, '192', 'Atendimento pré-hospitalar móvel de urgência e emergência.', null, null, null)
) as v(nome, tipo, cidade, endereco, telefone, servicos, pagina_publica, latitude, longitude)
where not exists (select 1 from public.unidades);

-- Configurações. Os custos de UBS e UPA são os valores ILUSTRATIVOS do projeto
-- (não são custos oficiais do SUS). Hospital e emergência ficam em branco até
-- o administrador informar valores: enquanto isso, a economia desses casos não é calculada.
insert into public.configuracoes (id, nome_rede, custo_ubs, custo_upa, custo_hospital, custo_emergencia, custo_operacional_mensal)
values (1, 'Rede Municipal de Saúde de Luís Eduardo Magalhães', 65.00, 180.00, null, null, 0)
on conflict (id) do nothing;

-- Regras ORIGINAIS do fluxograma (copiadas exatamente do index.html anterior)
insert into public.regras_encaminhamento (termo, nivel, origem)
select termo, nivel::public.nivel_atencao, 'original' from (
  select unnest(array[
    'resfriado', 'dor de garganta', 'diarreia leve', 'cefaleia tensional', 'gripe',
    'infecção urinária simples', 'febre baixa', 'hipertensão leve', 'diabetes tipo 2 controlado',
    'alergias respiratórias leves', 'pequenas feridas', 'cortes', 'dor muscular', 'verminoses',
    'vacinação', 'planejamento familiar', 'ansiedade leve', 'conjuntivite', 'gastrite leve',
    'otite externa', 'insônia leve'
  ]) as termo, 'primaria' as nivel
  union all
  select unnest(array[
    'apendicite', 'pneumonia', 'depressão moderada', 'endometriose', 'diabetes tipo 2 descontrolado',
    'hipertensão severa', 'insuficiência cardíaca leve', 'cálculo renal', 'hérnia de disco',
    'asma grave', 'lúpus leve', 'distúrbios de tireoide', 'refluxo crônico', 'catarata',
    'toc moderado', 'obesidade mórbida', 'doença de crohn', 'transtornos alimentares',
    'insuficiência venosa crônica', 'dst avançada'
  ]), 'secundaria'
  union all
  select unnest(array[
    'transplante de órgãos', 'câncer', 'avc agudo', 'infarto', 'insuficiência renal',
    'lesões graves', 'cirurgias cardíacas', 'transtornos psiquiátricos graves', 'sepse',
    'grandes queimaduras', 'dpoc grave', 'hemorragias internas', 'lesão medular',
    'meningite bacteriana', 'neuropatias severas', 'aids avançada', 'cirurgias ortopédicas complexas',
    'cirrose descompensada', 'cuidados paliativos'
  ]), 'terciaria'
) r
on conflict (termo, nivel) do nothing;
