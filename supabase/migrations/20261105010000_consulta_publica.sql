-- =====================================================================
-- Consulta pública (sem login) + tempos de espera estimados
--
-- O cidadão usa a página inicial sem login. Cada consulta é gravada em
-- public.atendimentos com canal = 'site', por meio de uma função segura
-- (registrar_consulta_publica) que valida os dados e limita abusos.
-- O visitante NÃO consegue ler nenhum dado: só gravar a própria consulta
-- e ler as unidades e regras públicas.
-- =====================================================================

-- ---------------- Atendimentos: canal e intenção inicial ----------------
alter table public.atendimentos alter column created_by drop not null;
alter table public.atendimentos alter column unidade_origem_id drop not null;
alter table public.atendimentos add column if not exists canal text not null default 'profissional';
alter table public.atendimentos add column if not exists intencao_inicial public.tipo_unidade;
alter table public.atendimentos add column if not exists ip_hash text;

alter table public.atendimentos drop constraint if exists atendimentos_canal_check;
alter table public.atendimentos add constraint atendimentos_canal_check check (canal in ('profissional', 'site'));
alter table public.atendimentos drop constraint if exists campos_do_canal;
alter table public.atendimentos add constraint campos_do_canal check (
  canal = 'site' or (created_by is not null and unidade_origem_id is not null)
);
create index if not exists atendimentos_ip_idx on public.atendimentos (ip_hash, created_at) where canal = 'site';

-- Atendimentos registrados por profissionais continuam exigindo canal 'profissional'
drop policy if exists atend_inserir on public.atendimentos;
create policy atend_inserir on public.atendimentos for insert to authenticated
  with check (
    public.papel_atual() in ('admin', 'profissional')
    and created_by = auth.uid()
    and canal = 'profissional'
  );

-- Também protege os novos campos contra alteração posterior
create or replace function public.proteger_campos_atendimento()
returns trigger language plpgsql as $$
begin
  new.id := old.id;
  new.protocolo := old.protocolo;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.relato := old.relato;
  new.unidade_origem_id := old.unidade_origem_id;
  new.interpretacao := old.interpretacao;
  new.interpretacao_fonte := old.interpretacao_fonte;
  new.alertas := old.alertas;
  new.nivel_recomendado := old.nivel_recomendado;
  new.destino_recomendado := old.destino_recomendado;
  new.criterios := old.criterios;
  new.canal := old.canal;
  new.intencao_inicial := old.intencao_inicial;
  new.ip_hash := old.ip_hash;
  new.atualizado_em := now();
  if new.resultado is distinct from old.resultado then
    new.resultado_em := now();
  end if;
  return new;
end $$;

-- ---------------- Tempos médios de espera (estimativa configurável) ----------------
alter table public.configuracoes add column if not exists espera_ubs_min int check (espera_ubs_min >= 0);
alter table public.configuracoes add column if not exists espera_upa_min int check (espera_upa_min >= 0);
alter table public.configuracoes add column if not exists espera_hospital_min int check (espera_hospital_min >= 0);
alter table public.configuracoes add column if not exists espera_emergencia_min int check (espera_emergencia_min >= 0);

-- ---------------- Funções públicas (chamadas sem login) ----------------
create or replace function public.unidades_publicas()
returns table (nome text, tipo public.tipo_unidade, cidade text, endereco text, telefone text,
               servicos text, pagina_publica text, latitude double precision, longitude double precision)
language sql stable security definer set search_path = public as $$
  select nome, tipo, cidade, endereco, telefone, servicos, pagina_publica, latitude, longitude
  from public.unidades where ativa order by tipo, nome
$$;

create or replace function public.regras_publicas()
returns table (termo text, nivel public.nivel_atencao, origem text)
language sql stable security definer set search_path = public as $$
  select termo, nivel, origem from public.regras_encaminhamento where ativa
$$;

create or replace function public.registrar_consulta_publica(
  p_relato text,
  p_faixa_etaria text,
  p_intencao text,
  p_interpretacao jsonb,
  p_fonte text,
  p_alertas text[],
  p_nivel text,
  p_destino text,
  p_criterios text[]
) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_relato text := trim(coalesce(p_relato, ''));
  v_headers json;
  v_ip text;
  v_hash text;
  v_destino_esperado text;
  v_protocolo bigint;
begin
  -- Validação do conteúdo
  if char_length(v_relato) < 3 or char_length(v_relato) > 1000 then
    raise exception 'relato_tamanho_invalido' using errcode = '22023';
  end if;
  if v_relato ~ '(^|[^0-9])[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}([^0-9]|$)' or v_relato ~ '[0-9]{15}' then
    raise exception 'documento_no_relato' using errcode = '22023';
  end if;
  if p_nivel not in ('primaria', 'secundaria', 'terciaria', 'emergencia', 'indefinido') then
    raise exception 'nivel_invalido' using errcode = '22023';
  end if;
  v_destino_esperado := case p_nivel
    when 'primaria' then 'UBS' when 'secundaria' then 'UPA' when 'terciaria' then 'HOSPITAL'
    when 'emergencia' then 'EMERGENCIA' else 'UBS' end;
  if p_destino is distinct from v_destino_esperado then
    raise exception 'destino_incoerente' using errcode = '22023';
  end if;
  if p_intencao is not null and p_intencao not in ('UBS', 'UPA', 'HOSPITAL') then
    raise exception 'intencao_invalida' using errcode = '22023';
  end if;
  if coalesce(p_fonte, 'regras') not in ('ia', 'regras') then
    raise exception 'fonte_invalida' using errcode = '22023';
  end if;
  if coalesce(array_length(p_alertas, 1), 0) > 12 or coalesce(array_length(p_criterios, 1), 0) > 25
     or char_length(coalesce(p_interpretacao::text, '')) > 8000 then
    raise exception 'dados_excessivos' using errcode = '22023';
  end if;

  -- Limite anti-abuso: hash diário do IP (o IP em si não é guardado)
  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-real-ip',
                   split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), '');
  v_hash := encode(digest(coalesce(nullif(trim(v_ip), ''), 'desconhecido') || current_date::text || 'fluxosaude', 'sha256'), 'hex');

  if (select count(*) from public.atendimentos
      where canal = 'site' and ip_hash = v_hash and created_at > now() - interval '10 minutes') >= 6 then
    raise exception 'limite_excedido' using errcode = '54000';
  end if;
  if (select count(*) from public.atendimentos
      where canal = 'site' and created_at > now() - interval '1 hour') >= 3000 then
    raise exception 'limite_excedido' using errcode = '54000';
  end if;

  insert into public.atendimentos (
    canal, created_by, unidade_origem_id, faixa_etaria, tipo_atendimento, relato,
    interpretacao, interpretacao_fonte, alertas, nivel_recomendado, destino_recomendado,
    criterios, destino_escolhido, intencao_inicial, ip_hash
  ) values (
    'site', null, null,
    case when p_faixa_etaria in ('0-11', '12-17', '18-39', '40-59', '60+') then p_faixa_etaria else 'nao_informada' end,
    'orientacao', v_relato, p_interpretacao, coalesce(p_fonte, 'regras'),
    coalesce((select array_agg(left(a, 80)) from unnest(p_alertas) a), '{}'),
    p_nivel::public.nivel_atencao, v_destino_esperado::public.tipo_unidade,
    coalesce((select array_agg(left(c, 300)) from unnest(p_criterios) c), '{}'),
    v_destino_esperado::public.tipo_unidade, p_intencao::public.tipo_unidade, v_hash
  ) returning protocolo into v_protocolo;

  return v_protocolo;
end $$;

grant usage on schema public to anon;
revoke all on function public.unidades_publicas() from public;
revoke all on function public.regras_publicas() from public;
revoke all on function public.registrar_consulta_publica(text, text, text, jsonb, text, text[], text, text, text[]) from public;
grant execute on function public.unidades_publicas() to anon, authenticated;
grant execute on function public.regras_publicas() to anon, authenticated;
grant execute on function public.registrar_consulta_publica(text, text, text, jsonb, text, text[], text, text, text[]) to anon, authenticated;
