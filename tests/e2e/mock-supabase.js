// Simulação MÍNIMA do cliente Supabase, usada SOMENTE nos testes automatizados
// de interface (tests/e2e). Não faz parte do sistema publicado.
const CHAVE = "__mock_db__";
const uid = () => crypto.randomUUID();
const agora = () => new Date().toISOString();

function semente() {
  const u = (nome, tipo) => ({ id: uid(), nome, tipo, ativa: true, cidade: "Luís Eduardo Magalhães - BA", endereco: null, telefone: null, servicos: null, created_at: agora() });
  const unidades = [u("UBS Central", "UBS"), u("UBS Jardim Paraíso", "UBS"), u("UPA Luís Eduardo Magalhães", "UPA"), u("Hospital São Luís Eduardo Magalhães", "HOSPITAL"), u("SAMU 192", "EMERGENCIA")];
  const p = (nome, email, papel, unidade) => ({ id: uid(), nome, email, papel, ativo: true, unidade_id: unidade?.id ?? null, created_at: agora(), _senha: "senha12345" });
  const perfis = [
    p("Ana Admin", "admin@teste.local", "admin"),
    p("Gustavo Gestor", "gestor@teste.local", "gestor"),
    p("Paula Profissional", "prof@teste.local", "profissional", unidades[2]),
    { ...p("Ivo Inativo", "inativo@teste.local", "profissional"), ativo: false },
  ];
  return {
    unidades, perfis,
    configuracoes: [{ id: 1, nome_rede: "Rede de Teste", custo_ubs: 65, custo_upa: 180, custo_hospital: null, custo_emergencia: null, custo_operacional_mensal: 0, updated_at: agora() }],
    regras_encaminhamento: [], atendimentos: [], ia_interpretacoes: [], linha_base: [], economia_comprovada: [], auditoria: [],
    _seq: 0, _sessao: null, _modoIA: "desligada",
  };
}
const ler = () => JSON.parse(localStorage.getItem(CHAVE) ?? "null") ?? semente();
const gravar = (db) => localStorage.setItem(CHAVE, JSON.stringify(db));
if (!localStorage.getItem(CHAVE)) gravar(semente());

function juntar(tabela, linha, db, sel) {
  const r = { ...linha };
  delete r._senha;
  if (tabela === "atendimentos") {
    r.origem = db.unidades.find((u) => u.id === linha.unidade_origem_id) ?? null;
    r.destino_unidade = db.unidades.find((u) => u.id === linha.destino_unidade_id) ?? null;
    r.autor = { nome: db.perfis.find((p) => p.id === linha.created_by)?.nome };
  }
  if (tabela === "perfis" && /unidade:/.test(sel)) r.unidade = db.unidades.find((u) => u.id === linha.unidade_id) ?? null;
  return r;
}

class Consulta {
  constructor(tabela) { Object.assign(this, { tabela, filtros: [], op: "select", ordem: [], lim: null, unico: null, sel: "*" }); }
  select(s = "*") { if (this.op === "select") this.sel = s; this.retornar = true; return this; }
  insert(v) { this.op = "insert"; this.valor = v; return this; }
  update(v) { this.op = "update"; this.valor = v; return this; }
  upsert(v) { this.op = "upsert"; this.valor = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filtros.push((r) => r[c] === v); return this; }
  gte(c, v) { this.filtros.push((r) => r[c] >= v); return this; }
  lt(c, v) { this.filtros.push((r) => r[c] < v); return this; }
  order(c, o = {}) { this.ordem.push([c, o.ascending !== false]); return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.unico = "single"; return this; }
  maybeSingle() { this.unico = "maybe"; return this; }
  then(ok, erro) { return Promise.resolve(this.executar()).then(ok, erro); }
  executar() {
    const db = ler();
    const eu = db.perfis.find((p) => p.id === db._sessao);
    if (!eu) return { data: null, error: { message: "permission denied" } };
    // Como no banco real: usuário inativo só enxerga o próprio perfil
    if (!eu.ativo && !(this.tabela === "perfis" && this.op === "select")) return { data: null, error: { message: "permission denied" } };
    if (!eu.ativo) this.filtros.push((r) => r.id === eu.id);
    let tab = db[this.tabela];
    const audit = (acao, antes, depois) => db.auditoria.push({ id: db.auditoria.length + 1, ocorrido_em: agora(), usuario_id: eu.id, tabela: this.tabela, registro_id: (depois ?? antes)?.id, acao, antes, depois });
    if (this.op === "insert" || this.op === "upsert") {
      const novos = (Array.isArray(this.valor) ? this.valor : [this.valor]).map((v) => {
        const r = { id: uid(), created_at: agora(), ...v };
        if (this.tabela === "atendimentos") {
          if (eu.papel === "gestor") throw new Error("gestor não insere");
          if (r.destino_recomendado && r.destino_escolhido !== r.destino_recomendado && !(r.justificativa?.trim().length >= 5)) return { erro: 'violates check constraint "justificativa_divergencia"' };
          r.protocolo = ++db._seq; r.atualizado_em = agora(); r.resultado ??= "pendente";
        }
        return r;
      });
      const e = novos.find((n) => n.erro);
      if (e) return { data: null, error: { message: e.erro } };
      tab.push(...novos);
      novos.forEach((n) => audit("INSERT", null, n));
      gravar(db);
      const d = this.unico ? juntar(this.tabela, novos[0], db, this.sel) : novos;
      return { data: d, error: null };
    }
    let linhas = tab.filter((r) => this.filtros.every((f) => f(r)));
    if (this.tabela === "atendimentos" && eu.papel === "profissional") linhas = linhas.filter((r) => r.created_by === eu.id || r.unidade_origem_id === eu.unidade_id);
    if (this.op === "update") {
      for (const r of linhas) { const antes = { ...r }; Object.assign(r, this.valor); if (this.valor.resultado) r.resultado_em = agora(); audit("UPDATE", antes, { ...r }); }
      gravar(db);
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      db[this.tabela] = tab.filter((r) => !linhas.includes(r));
      linhas.forEach((r) => audit("DELETE", r, null));
      gravar(db);
      return { data: null, error: null };
    }
    for (const [c, asc] of [...this.ordem].reverse()) linhas.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
    if (this.lim) linhas = linhas.slice(0, this.lim);
    const dados = linhas.map((r) => juntar(this.tabela, r, db, this.sel));
    if (this.unico === "single") return dados.length === 1 ? { data: dados[0], error: null } : { data: null, error: { message: "not found" } };
    if (this.unico === "maybe") return { data: dados[0] ?? null, error: null };
    return { data: dados, error: null };
  }
}

const ouvintes = [];
export function createClient() {
  return {
    from: (t) => new Consulta(t),
    auth: {
      async getSession() { const db = ler(); return { data: { session: db._sessao ? { user: { id: db._sessao } } : null } }; },
      async signInWithPassword({ email, password }) {
        const db = ler();
        const p = db.perfis.find((x) => x.email === email && x._senha === password);
        if (!p) return { error: { message: "Invalid login credentials" } };
        db._sessao = p.id; gravar(db);
        return { data: {}, error: null };
      },
      async signOut() { const db = ler(); db._sessao = null; gravar(db); ouvintes.forEach((f) => f("SIGNED_OUT")); return { error: null }; },
      onAuthStateChange(f) { ouvintes.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
      async resetPasswordForEmail() { return { error: null }; },
      async updateUser() { return { error: null }; },
    },
    functions: {
      async invoke(nome, { body }) {
        const db = ler();
        const falha = (codigo) => ({ data: null, error: { context: { json: async () => ({ erro: codigo }) } } });
        if (nome === "interpretar-sintomas") {
          if (db._modoIA === "desligada") return falha("ia_nao_configurada");
          const r = String(body.relato);
          const interpretacao = {
            sintoma_principal: /garganta/i.test(r) ? { termo_tecnico: "Dor de garganta", trecho_original: "dor de garganta" } : null,
            sintomas_associados: /gripe/i.test(r) ? [{ termo_tecnico: "Gripe", trecho_original: "gripe" }] : [],
            negados: [], inicio: null, intensidade: null,
            informacoes_pendentes: ["Temperatura aferida", "Tempo de início dos sintomas"],
            resumo_tecnico: "Paciente relata dor de garganta, associado a gripe.",
          };
          const reg = { id: uid(), created_by: db._sessao, modelo: "gemini-teste", saida: interpretacao, created_at: agora() };
          db.ia_interpretacoes.push(reg); gravar(db);
          return { data: { id: reg.id, modelo: "gemini-teste", interpretacao, descartados: 1 }, error: null };
        }
        if (nome === "gerenciar-usuarios") {
          const p = { id: uid(), nome: body.nome, email: body.email, papel: body.papel, unidade_id: body.unidade_id, ativo: true, created_at: agora(), _senha: body.senha };
          db.perfis.push(p); gravar(db);
          return { data: { ok: true, id: p.id }, error: null };
        }
        return falha("acao_desconhecida");
      },
    },
  };
}
