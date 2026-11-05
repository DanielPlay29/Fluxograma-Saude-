-- =====================================================================
-- Plataforma de Gestão e Otimização do Fluxo de Pacientes do SUS
-- Estrutura do banco de dados (Supabase / PostgreSQL)
--
-- Princípios LGPD aplicados:
--  * Minimização: nenhum nome, CPF ou Cartão SUS do paciente é armazenado.
--    O paciente é identificado apenas por um código opcional (pseudônimo).
--  * Controle de acesso: Row Level Security (RLS) em todas as tabelas.
--  * Auditoria: toda inclusão/alteração/exclusão relevante é registrada.
--  * Criptografia: o Supabase criptografa os dados em repouso (AES-256)
--    e em trânsito (TLS). A IA recebe somente o relato, nunca identificação.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type public.papel as enum ('admin', 'gestor', 'profissional');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_unidade as enum ('UBS', 'UPA', 'HOSPITAL', 'EMERGENCIA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.nivel_atencao as enum ('primaria', 'secundaria', 'terciaria', 'emergencia', 'indefinido');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Unidades de saúde
-- ---------------------------------------------------------------------
create table if not exists public.unidades (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  tipo          public.tipo_unidade not null,
  cidade        text,
  endereco      text,
  telefone      text,
  servicos      text,
  pagina_publica text,
  latitude      double precision,
  longitude     double precision,
  ativa         boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Perfis de usuários (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text,
  papel       public.papel not null default 'profissional',
  unidade_id  uuid references public.unidades(id) on delete set null,
  -- Novos usuários nascem INATIVOS: só um administrador libera o acesso.
  ativo       boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário é criado no Auth.
-- O papel NUNCA é lido dos metadados enviados pelo usuário (evita escalada de privilégio).
create or replace function public.criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, email, papel, ativo)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nome'), ''), split_part(new.email, '@', 1)),
    new.email,
    'profissional',
    false
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

-- Funções auxiliares usadas pelas políticas de segurança
create or replace function public.papel_atual()
returns public.papel language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo
$$;

create or replace function public.unidade_atual()
returns uuid language sql stable security definer set search_path = public as $$
  select unidade_id from public.perfis where id = auth.uid() and ativo
$$;

-- ---------------------------------------------------------------------
-- Configurações gerais (linha única)
-- Os custos são ESTIMATIVAS configuráveis, não custos oficiais do SUS.
-- ---------------------------------------------------------------------
create table if not exists public.configuracoes (
  id                        int primary key default 1 check (id = 1),
  nome_rede                 text not null default 'Rede Municipal de Saúde',
  custo_ubs                 numeric(12,2) check (custo_ubs >= 0),
  custo_upa                 numeric(12,2) check (custo_upa >= 0),
  custo_hospital            numeric(12,2) check (custo_hospital >= 0),
  custo_emergencia          numeric(12,2) check (custo_emergencia >= 0),
  custo_operacional_mensal  numeric(12,2) not null default 0 check (custo_operacional_mensal >= 0),
  data_implantacao          date,
  updated_at                timestamptz not null default now(),
  updated_by                uuid references public.perfis(id) on delete set null
);

-- ---------------------------------------------------------------------
-- Regras de encaminhamento (palavras-chave → nível de atenção)
-- Semeadas com as regras ORIGINAIS do fluxograma; o administrador
-- pode incluir regras complementares conforme o protocolo local.
-- ---------------------------------------------------------------------
create table if not exists public.regras_encaminhamento (
  id          uuid primary key default gen_random_uuid(),
  termo       text not null,
  nivel       public.nivel_atencao not null check (nivel in ('primaria', 'secundaria', 'terciaria')),
  origem      text not null default 'personalizada' check (origem in ('original', 'personalizada')),
  ativa       boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.perfis(id) on delete set null,
  unique (termo, nivel)
);

-- ---------------------------------------------------------------------
-- Atendimentos
-- ---------------------------------------------------------------------
create table if not exists public.atendimentos (
  id                    uuid primary key default gen_random_uuid(),
  protocolo             bigint generated always as identity unique,
  created_at            timestamptz not null default now(),
  created_by            uuid not null default auth.uid() references public.perfis(id),
  unidade_origem_id     uuid not null references public.unidades(id),
  codigo_paciente       text check (codigo_paciente is null or char_length(codigo_paciente) <= 40),
  faixa_etaria          text check (faixa_etaria in ('0-11', '12-17', '18-39', '40-59', '60+', 'nao_informada')),
  tipo_atendimento      text not null default 'demanda_espontanea'
                        check (tipo_atendimento in ('demanda_espontanea', 'agendado', 'retorno', 'transferencia', 'orientacao')),
  relato                text not null check (char_length(relato) between 3 and 2000),
  interpretacao         jsonb,
  interpretacao_fonte   text check (interpretacao_fonte in ('ia', 'regras')),
  ia_interpretacao_id   uuid,
  alertas               text[] not null default '{}',
  nivel_recomendado     public.nivel_atencao not null default 'indefinido',
  destino_recomendado   public.tipo_unidade,
  criterios             text[] not null default '{}',
  destino_escolhido     public.tipo_unidade not null,
  destino_unidade_id    uuid references public.unidades(id),
  justificativa         text,
  resultado             text not null default 'pendente'
                        check (resultado in ('pendente', 'atendido_no_destino', 'reencaminhado', 'nao_compareceu', 'evadiu')),
  resultado_em          timestamptz,
  atualizado_em         timestamptz not null default now(),
  -- Divergir da recomendação exige justificativa do profissional
  constraint justificativa_divergencia check (
    destino_recomendado is null
    or destino_escolhido = destino_recomendado
    or char_length(coalesce(trim(justificativa), '')) >= 5
  )
);

create index if not exists atendimentos_created_at_idx on public.atendimentos (created_at desc);
create index if not exists atendimentos_unidade_idx on public.atendimentos (unidade_origem_id);

-- Campos do registro original não podem ser reescritos depois de salvos
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
  new.atualizado_em := now();
  if new.resultado is distinct from old.resultado then
    new.resultado_em := now();
  end if;
  return new;
end $$;

drop trigger if exists proteger_atendimento on public.atendimentos;
create trigger proteger_atendimento
  before update on public.atendimentos
  for each row execute function public.proteger_campos_atendimento();

-- ---------------------------------------------------------------------
-- Registro das interpretações da IA
-- Por minimização, guarda-se apenas o hash do texto enviado (o relato
-- completo fica no atendimento, se for salvo).
-- ---------------------------------------------------------------------
create table if not exists public.ia_interpretacoes (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  created_by      uuid not null default auth.uid() references public.perfis(id),
  atendimento_id  uuid references public.atendimentos(id) on delete set null,
  modelo          text not null,
  entrada_sha256  text not null,
  saida           jsonb not null,
  itens_descartados jsonb not null default '[]',
  latencia_ms     int
);

alter table public.atendimentos
  drop constraint if exists atendimentos_ia_fk;
alter table public.atendimentos
  add constraint atendimentos_ia_fk foreign key (ia_interpretacao_id)
  references public.ia_interpretacoes(id) on delete set null;

-- ---------------------------------------------------------------------
-- Linha de base (fluxo ANTES da implantação), informada pela gestão
-- a partir de registros oficiais (ex.: e-SUS, SIA/SUS).
-- ---------------------------------------------------------------------
create table if not exists public.linha_base (
  id             uuid primary key default gen_random_uuid(),
  competencia    date not null,             -- primeiro dia do mês
  tipo_unidade   public.tipo_unidade not null,
  atendimentos   int not null check (atendimentos >= 0),
  fonte          text not null check (char_length(trim(fonte)) >= 3),
  created_at     timestamptz not null default now(),
  created_by     uuid references public.perfis(id) on delete set null,
  unique (competencia, tipo_unidade)
);

-- ---------------------------------------------------------------------
-- Economia efetivamente COMPROVADA (com fonte/documento)
-- Separada da economia potencial estimada, que é calculada.
-- ---------------------------------------------------------------------
create table if not exists public.economia_comprovada (
  id           uuid primary key default gen_random_uuid(),
  competencia  date not null,
  valor        numeric(14,2) not null check (valor >= 0),
  descricao    text not null,
  fonte        text not null check (char_length(trim(fonte)) >= 3),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.perfis(id) on delete set null
);

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table if not exists public.auditoria (
  id           bigint generated always as identity primary key,
  ocorrido_em  timestamptz not null default now(),
  usuario_id   uuid,
  tabela       text not null,
  registro_id  text,
  acao         text not null,
  antes        jsonb,
  depois       jsonb
);
create index if not exists auditoria_registro_idx on public.auditoria (tabela, registro_id);

create or replace function public.registrar_auditoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  v_id := coalesce(
    case when tg_op = 'DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end,
    ''
  );
  insert into public.auditoria (usuario_id, tabela, registro_id, acao, antes, depois)
  values (
    auth.uid(),
    tg_table_name,
    v_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['atendimentos', 'perfis', 'unidades', 'configuracoes',
                           'regras_encaminhamento', 'linha_base', 'economia_comprovada']
  loop
    execute format('drop trigger if exists auditar on public.%I', t);
    execute format('create trigger auditar after insert or update or delete on public.%I
                    for each row execute function public.registrar_auditoria()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Permissões básicas da API (o RLS abaixo é quem decide as linhas)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.unidades, public.perfis, public.configuracoes, public.regras_encaminhamento,
  public.atendimentos, public.ia_interpretacoes, public.linha_base,
  public.economia_comprovada, public.auditoria
to authenticated;
revoke insert, update, delete on public.auditoria from authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.unidades              enable row level security;
alter table public.perfis                enable row level security;
alter table public.configuracoes         enable row level security;
alter table public.regras_encaminhamento enable row level security;
alter table public.atendimentos          enable row level security;
alter table public.ia_interpretacoes     enable row level security;
alter table public.linha_base            enable row level security;
alter table public.economia_comprovada   enable row level security;
alter table public.auditoria             enable row level security;

-- Unidades: toda a equipe ativa lê; só administrador altera
drop policy if exists unidades_ler on public.unidades;
create policy unidades_ler on public.unidades for select to authenticated
  using (public.papel_atual() is not null);
drop policy if exists unidades_admin on public.unidades;
create policy unidades_admin on public.unidades for all to authenticated
  using (public.papel_atual() = 'admin') with check (public.papel_atual() = 'admin');

-- Perfis: cada um lê o próprio; equipe ativa vê nomes dos colegas; só admin altera
drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated
  using (id = auth.uid() or public.papel_atual() is not null);
drop policy if exists perfis_admin on public.perfis;
create policy perfis_admin on public.perfis for update to authenticated
  using (public.papel_atual() = 'admin') with check (public.papel_atual() = 'admin');

-- Configurações
drop policy if exists config_ler on public.configuracoes;
create policy config_ler on public.configuracoes for select to authenticated
  using (public.papel_atual() is not null);
drop policy if exists config_admin on public.configuracoes;
create policy config_admin on public.configuracoes for update to authenticated
  using (public.papel_atual() = 'admin') with check (public.papel_atual() = 'admin');

-- Regras de encaminhamento
drop policy if exists regras_ler on public.regras_encaminhamento;
create policy regras_ler on public.regras_encaminhamento for select to authenticated
  using (public.papel_atual() is not null);
drop policy if exists regras_admin on public.regras_encaminhamento;
create policy regras_admin on public.regras_encaminhamento for all to authenticated
  using (public.papel_atual() = 'admin') with check (public.papel_atual() = 'admin');

-- Atendimentos
drop policy if exists atend_ler on public.atendimentos;
create policy atend_ler on public.atendimentos for select to authenticated
  using (
    public.papel_atual() in ('admin', 'gestor')
    or (public.papel_atual() = 'profissional'
        and (created_by = auth.uid() or unidade_origem_id = public.unidade_atual()))
  );
drop policy if exists atend_inserir on public.atendimentos;
create policy atend_inserir on public.atendimentos for insert to authenticated
  with check (
    public.papel_atual() in ('admin', 'profissional')
    and created_by = auth.uid()
  );
drop policy if exists atend_atualizar on public.atendimentos;
create policy atend_atualizar on public.atendimentos for update to authenticated
  using (
    public.papel_atual() = 'admin'
    or (public.papel_atual() = 'profissional'
        and (created_by = auth.uid() or unidade_origem_id = public.unidade_atual()))
  )
  with check (public.papel_atual() in ('admin', 'profissional'));
drop policy if exists atend_excluir on public.atendimentos;
create policy atend_excluir on public.atendimentos for delete to authenticated
  using (public.papel_atual() = 'admin');

-- Interpretações da IA
drop policy if exists ia_ler on public.ia_interpretacoes;
create policy ia_ler on public.ia_interpretacoes for select to authenticated
  using (public.papel_atual() in ('admin', 'gestor') or created_by = auth.uid());
drop policy if exists ia_inserir on public.ia_interpretacoes;
create policy ia_inserir on public.ia_interpretacoes for insert to authenticated
  with check (public.papel_atual() in ('admin', 'profissional') and created_by = auth.uid());
drop policy if exists ia_vincular on public.ia_interpretacoes;
create policy ia_vincular on public.ia_interpretacoes for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

-- Linha de base e economia comprovada: gestão lê, admin altera
drop policy if exists base_ler on public.linha_base;
create policy base_ler on public.linha_base for select to authenticated
  using (public.papel_atual() in ('admin', 'gestor'));
drop policy if exists base_admin on public.linha_base;
create policy base_admin on public.linha_base for all to authenticated
  using (public.papel_atual() = 'admin') with check (public.papel_atual() = 'admin');

drop policy if exists econ_ler on public.economia_comprovada;
create policy econ_ler on public.economia_comprovada for select to authenticated
  using (public.papel_atual() in ('admin', 'gestor'));
drop policy if exists econ_admin on public.economia_comprovada;
create policy econ_admin on public.economia_comprovada for all to authenticated
  using (public.papel_atual() = 'admin') with check (public.papel_atual() = 'admin');

-- Auditoria: admin vê tudo; demais veem o histórico dos atendimentos que já podem ver
drop policy if exists audit_ler on public.auditoria;
create policy audit_ler on public.auditoria for select to authenticated
  using (
    public.papel_atual() = 'admin'
    or (tabela = 'atendimentos'
        and exists (select 1 from public.atendimentos a where a.id::text = registro_id))
  );
