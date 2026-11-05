# Guia de configuração e publicação — FluxoSaúde

Este guia leva o sistema do código até um endereço funcionando na internet, usando apenas serviços com plano gratuito. Tempo estimado: 30 a 40 minutos.

| Serviço | Para que serve | Plano |
|---|---|---|
| **GitHub Pages** | Hospeda as telas do sistema (HTML/CSS/JS) | Gratuito |
| **Supabase** | Login, banco de dados PostgreSQL, regras de segurança e funções do servidor | Gratuito |
| **Google Gemini API** | Interpretação dos relatos de sintomas por IA | Cota gratuita |

---

## 1. Criar o banco de dados (Supabase)

1. Crie uma conta em <https://supabase.com> e clique em **New project**. Escolha a região **South America (São Paulo)** e anote a senha do banco.
2. No menu do projeto, abra **SQL Editor → New query**.
3. Copie todo o conteúdo de `supabase/migrations/20261105000000_plataforma.sql`, cole e clique em **Run**.
4. Faça o mesmo com `supabase/seed.sql` (cadastra as unidades de Luís Eduardo Magalhães, os custos de exemplo e as 60 regras originais do fluxograma).
5. Por último, rode `supabase/migrations/20261105010000_consulta_publica.sql` (permite que a página inicial grave as consultas dos cidadãos sem login, e adiciona os tempos de espera).

> Confira endereços e telefones das unidades com a Secretaria de Saúde antes de usar em produção. Eles vieram das páginas antigas do site.

### 1.1 Ajustar a autenticação

Em **Authentication → Sign In / Providers** (ou **Settings**):

- Desative **Allow new users to sign up**. Só o administrador cria usuários.
- Em **Authentication → URL Configuration**:
  - **Site URL**: o endereço do site (ex.: `https://danielplay29.github.io/Fluxograma-Saude-/`)
  - **Redirect URLs**: adicione `https://danielplay29.github.io/Fluxograma-Saude-/redefinir-senha.html`

### 1.2 Criar o primeiro administrador

1. **Authentication → Users → Add user → Create new user**. Informe e-mail e senha e marque **Auto Confirm User**.
2. No **SQL Editor**, rode (trocando o e-mail):

```sql
update public.perfis
set papel = 'admin', ativo = true, nome = 'Seu Nome'
where email = 'seu-email@exemplo.com';
```

Os próximos usuários são criados pela tela **Usuários** do próprio sistema.

---

## 2. Conectar as telas ao banco

1. No Supabase, abra **Project Settings → API** (ou **API Keys**).
2. Copie a **Project URL** e a chave **anon / public**.
3. Edite `assets/js/config.js`:

```js
export const CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
};
```

A chave *anon* é pública por natureza e pode ficar no código: ela não abre nenhum dado sozinha, porque toda tabela está protegida por RLS. **Nunca** coloque nesse arquivo a chave `service_role` nem a chave da Gemini.

---

## 3. Configurar a inteligência artificial (Gemini)

A IA roda numa **função do servidor** (Supabase Edge Function), então a chave nunca chega ao navegador. Tudo é feito pelo navegador, sem instalar nada.

### 3.1 Obter a chave

1. Acesse <https://aistudio.google.com/apikey> com uma conta Google.
2. Clique em **Create API key** e copie a chave.

> **Atenção à LGPD:** no plano gratuito, o Google pode usar o conteúdo enviado para melhorar seus produtos. O sistema envia somente o relato (nunca nome, CPF ou Cartão SUS) e bloqueia números de documento, mas para uso real com pacientes recomenda-se ativar o faturamento na conta Google. Para apresentação acadêmica, o plano gratuito é suficiente.

### 3.2 Guardar a chave no Supabase

1. No Supabase, abra **Edge Functions → Secrets** (ou **Manage secrets**).
2. Adicione o segredo **`GEMINI_API_KEY`** com a chave copiada e salve.

### 3.3 Criar a função da página inicial (`interpretar-publico`)

1. Em **Edge Functions**, clique em **Deploy a new function → Via Editor**.
2. Nome da função: **`interpretar-publico`** (exatamente assim).
3. Apague o código de exemplo, cole todo o conteúdo de `supabase/functions/interpretar-publico/index.ts` e clique em **Deploy function**.
4. Abra a função → **Details** (ou **Settings**) e **desative "Verify JWT"** / "Enforce JWT verification". Isso é necessário porque os visitantes não fazem login. Salve.

Pronto: a página inicial passa a mostrar "Interpretado com IA".

### 3.4 Funções da área restrita (opcional)

As funções `interpretar-sintomas` (IA na tela *Novo atendimento*) e `gerenciar-usuarios` (criar usuários pela tela) usam arquivos compartilhados e são publicadas com o Supabase CLI, num computador com Node.js:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase functions deploy interpretar-sintomas
npx supabase functions deploy gerenciar-usuarios
```

Se você for o único usuário da área restrita, elas não são necessárias.

### 3.5 Se a IA não estiver configurada

O sistema continua funcionando: o relato é interpretado por **regras locais** (expressões populares conhecidas), e a tela mostra "Interpretação automática" em vez de "Interpretado com IA". Nada é apresentado como IA quando não é.

## 4. Publicar o site (GitHub Pages)

1. No GitHub, abra o repositório **Fluxograma-Saude-** → **Settings → Pages**.
2. Em **Build and deployment**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)` e salve.
3. Em 1 a 2 minutos o site fica disponível em `https://danielplay29.github.io/Fluxograma-Saude-/`.

Endereços:

| Página | Para quem |
|---|---|
| `index.html` | **Página inicial pública**: o cidadão descreve o sintoma e recebe a orientação (sem login) |
| `entrar.html` | Login da área restrita (gestão) |
| `app.html` | Área restrita (após login): dashboard, fluxograma, relatórios etc. |
| `consulta.html` | Endereço antigo: redireciona para a página inicial |
| `UBS.html`, `UPA.html`, `Hospital.html` | Páginas públicas das unidades (mantidas) |

---

## 5. O que depende de configuração externa

| Funcionalidade | Depende de | Sem a configuração |
|---|---|---|
| Login, telas internas, dados | Supabase + `config.js` | A tela de login mostra o aviso de configuração |
| Registro das consultas da página inicial | Arquivo `20261105010000_consulta_publica.sql` | A orientação aparece, mas não é contada no painel |
| IA na página inicial | Função `interpretar-publico` + `GEMINI_API_KEY` | Usa regras locais, identificadas como tal |
| IA na tela Novo atendimento | Função `interpretar-sintomas` + `GEMINI_API_KEY` | Usa regras locais, identificadas como tal |
| Tempo de espera evitado | Tempos médios em Configurações | O indicador pede a configuração |
| Criar usuários pela tela | Função `gerenciar-usuarios` | Criar em Authentication → Users e ativar via SQL |
| Recuperação de senha | Redirect URL configurada (seção 1.1) | Link do e-mail não volta ao sistema |
| E-mails de recuperação em produção | SMTP próprio no Supabase (Authentication → Emails) | O e-mail padrão do Supabase tem limite baixo de envios por hora |
| Economia estimada de hospital/emergência | Custos em Configurações | Esses casos ficam fora do cálculo (com aviso) |
| Gráfico antes × depois | Linha de base em Configurações | O gráfico mostra que falta a linha de base |
| Economia comprovada | Registros com fonte em Economia gerada | Mostra “Sem dados comprovados” |

---

## 6. Perfis de acesso

| Perfil | Acessa |
|---|---|
| **Administrador** | Tudo: indicadores, atendimentos, relatórios, usuários, configurações e auditoria |
| **Gestor hospitalar** | Dashboard, fluxograma, histórico (leitura), otimização, economia e relatórios |
| **Profissional de saúde** | Novo atendimento, fluxograma e histórico da própria unidade |

As permissões são aplicadas em dois lugares: no menu/rotas (interface) e no banco (RLS). Mesmo que alguém altere o código no navegador, o banco recusa o que o perfil não pode ver ou fazer.

---

## 7. Segurança e LGPD

- **Minimização:** não há campos para nome, CPF ou Cartão SUS. O sistema bloqueia números de CPF/Cartão SUS digitados no relato ou no código do paciente.
- **Controle de acesso:** RLS em todas as tabelas; novos usuários nascem inativos; ninguém se autopromove a administrador.
- **Imutabilidade:** relato, interpretação e recomendação não podem ser reescritos depois de salvos; só o desfecho e a decisão podem ser atualizados.
- **Auditoria:** toda inclusão, alteração e exclusão fica registrada com usuário e data (tela Configurações → Auditoria).
- **Criptografia:** o Supabase criptografa os dados em repouso e em trânsito (HTTPS/TLS).
- **Exportações:** PDF, Excel e CSV não incluem o relato livre nem o código do paciente.
- **IA:** a resposta da IA é validada no servidor; todo sintoma, início ou intensidade sem trecho correspondente no relato é descartado.

---

## 8. Executar e testar localmente

Qualquer servidor de arquivos estáticos funciona:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

Testes automatizados:

```bash
# Regras de encaminhamento, indicadores e validação da IA (Node.js 22+)
node --experimental-strip-types --test tests/*.test.mjs tests/*.test.mts

# Segurança do banco (precisa de PostgreSQL local)
psql -d banco_teste -f tests/sql/00_simular_supabase.sql \
  -f supabase/migrations/20261105000000_plataforma.sql \
  -f supabase/seed.sql -f tests/sql/10_testar_seguranca.sql

# Interface ponta a ponta com backend simulado (Python + Playwright)
python3 tests/e2e/testar_interface.py
```

---

## 9. Limites conhecidos

- As regras de encaminhamento são as do fluxograma original (palavras-chave por nível de atenção) e **não foram validadas clinicamente**. Antes de uso real, devem ser revisadas pela equipe técnica e alinhadas a protocolos oficiais (ex.: Protocolo de Manchester / classificação de risco do município). A tela **Configurações → Regras** permite isso.
- Os custos por atendimento são exemplos ilustrativos; os indicadores financeiros só têm valor com custos apurados pela Secretaria.
- O plano gratuito do Supabase pausa projetos sem uso por 7 dias (basta reativar no painel) e tem limites de armazenamento.
