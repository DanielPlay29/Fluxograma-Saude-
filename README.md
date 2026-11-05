# FluxoSaúde — Gestão e Otimização do Fluxo de Pacientes do SUS

Plataforma web para organizar o encaminhamento de pacientes entre **UBS**, **UPA**, **hospitais** e **serviços de emergência**, com interpretação de relatos por inteligência artificial, painel de gestão e cálculo de economia estimada.

> Ferramenta de apoio à decisão. Não substitui a avaliação profissional, o diagnóstico médico ou a classificação oficial de risco.

## Funcionalidades

- **Login real** (Supabase Auth) com três perfis: administrador, gestor hospitalar e profissional de saúde, e recuperação de senha.
- **Novo atendimento**: relato livre → sinais de alerta imediatos → interpretação por IA (Gemini) → recomendação pelo protocolo → decisão do profissional (com justificativa obrigatória em caso de divergência).
- **Sinais de alerta determinísticos** (dor torácica, dificuldade respiratória, sinais de AVC, desmaio, convulsão, sangramento, trauma grave, anafilaxia, risco de autoagressão, intoxicação), que não dependem da IA.
- **Fluxograma interativo**: Paciente → Avaliação inicial → Interpretação → Protocolo → Destino, com rastreio de cada atendimento.
- **Dashboard de gestão**: 8 indicadores e 6 gráficos com filtros por dia, semana, mês, ano, unidade e tipo de atendimento.
- **Otimização da rede** e **Economia gerada**, separando economia **potencial estimada** de economia **comprovada**.
- **Relatórios mensais** exportáveis em PDF, Excel e CSV.
- **Usuários**, **Configurações** (custos, unidades, regras, linha de base) e **auditoria** completa.
- Preserva o site original: as **60 regras de encaminhamento**, o verificador público (`consulta.html`) e as páginas das unidades.

## Tecnologia

HTML, CSS e JavaScript (módulos ES, sem etapa de build), como o projeto original, mais:

- **Supabase** — PostgreSQL com Row Level Security, autenticação e Edge Functions
- **Google Gemini API** — chamada somente pelo servidor (a chave nunca vai ao navegador)
- **Chart.js**, **jsPDF** e **SheetJS** via CDN

## Como configurar

Veja o passo a passo completo em **[GUIA_DE_CONFIGURACAO.md](GUIA_DE_CONFIGURACAO.md)**.

## Estrutura

```
index.html               Login
app.html                 Sistema (menu lateral + telas)
redefinir-senha.html     Nova senha (link do e-mail)
consulta.html            Orientação ao cidadão (verificador original)
UBS.html, UPA.html, Hospital.html   Páginas públicas das unidades
assets/js/core/          Regras de encaminhamento e indicadores (testados)
assets/js/servicos/      Acesso ao Supabase
assets/js/telas/         Uma tela por item do menu
supabase/migrations/     Banco de dados, segurança (RLS) e auditoria
supabase/functions/      Funções do servidor (IA e criação de usuários)
tests/                   Testes unitários, de segurança do banco e de interface
```
