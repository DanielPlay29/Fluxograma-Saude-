import {
  obterConfig, salvarConfig, listarUnidades, salvarUnidade, listarRegras, criarRegra, alterarRegra, excluirRegra,
  listarLinhaBase, salvarLinhaBase, excluirLinhaBase, listarAuditoria, listarPerfis, dataLocal,
} from "../servicos/dados.js";
import { ROTULO_NIVEL } from "../core/triagem.js";
import { icone } from "../ui/icones.js";
import {
  esc, $, $$, aviso, carregando, vazio, modal, toast, confirmar, fmtNum, fmtDataHora, fmtCompetencia, ROTULO_TIPO_CURTO,
} from "../ui/comum.js";

export const subtitulo = "Custos estimados, unidades, regras do protocolo, linha de base e auditoria";

const ABAS = [
  ["rede", "Rede e custos", "economia"],
  ["unidades", "Unidades de saúde", "HOSPITAL"],
  ["regras", "Regras de encaminhamento", "regras"],
  ["base", "Linha de base", "calendario"],
  ["auditoria", "Auditoria", "escudo"],
];

export async function render(el, ctx) {
  el.innerHTML = `<div class="segmentado" role="tablist" style="flex-wrap:wrap;align-self:flex-start">
      ${ABAS.map(([id, r], i) => `<button type="button" role="tab" data-aba="${id}" aria-pressed="${i === 0}">${esc(r)}</button>`).join("")}
    </div><div id="aba"></div>`;
  const abrir = (id) => {
    $$("[data-aba]", el).forEach((b) => b.setAttribute("aria-pressed", b.dataset.aba === id));
    const box = $("#aba", el);
    box.innerHTML = carregando();
    ({ rede, unidades, regras, base, auditoria })[id](box, ctx).catch((e) => { box.innerHTML = aviso("erro", e.message); });
  };
  $$("[data-aba]", el).forEach((b) => b.addEventListener("click", () => abrir(b.dataset.aba)));
  abrir("rede");
}

// ---------------- Rede e custos ----------------
async function rede(box, ctx) {
  const c = await obterConfig();
  const campoCusto = (nome, rotulo) => `<label class="campo"><span>${rotulo}</span><input class="entrada" type="number" min="0" step="0.01" name="${nome}" value="${c[nome] ?? ""}" placeholder="Não configurado"></label>`;
  box.innerHTML = `<form class="card" id="form-rede">
    <div class="card-cab"><div><h3>Rede, custos e tempos de espera</h3><p>Valores médios usados no cálculo da economia e do tempo de espera evitado.</p></div></div>
    ${aviso("atencao", "Estes valores são estimativas", "<p>Use custos médios apurados pela Secretaria de Saúde. Eles não representam custos oficiais do SUS e o sistema sempre os apresenta como estimativa. Deixe em branco o que não souber — esses casos ficam fora do cálculo.</p>")}
    <div class="grade-form" style="margin-top:16px">
      <label class="campo" style="grid-column:1/-1"><span>Nome da rede</span><input class="entrada" name="nome_rede" value="${esc(c.nome_rede ?? "")}" maxlength="120"></label>
      ${campoCusto("custo_ubs", "Custo médio – UBS (R$)")}
      ${campoCusto("custo_upa", "Custo médio – UPA (R$)")}
      ${campoCusto("custo_hospital", "Custo médio – Hospital (R$)")}
      ${campoCusto("custo_emergencia", "Custo médio – Emergência (R$)")}
      ${campoCusto("custo_operacional_mensal", "Custo operacional mensal da plataforma (R$)")}
      <label class="campo"><span>Espera média – UBS (min)</span><input class="entrada" type="number" min="0" step="1" name="espera_ubs_min" value="${c.espera_ubs_min ?? ""}" placeholder="Não configurado"></label>
      <label class="campo"><span>Espera média – UPA (min)</span><input class="entrada" type="number" min="0" step="1" name="espera_upa_min" value="${c.espera_upa_min ?? ""}" placeholder="Não configurado"></label>
      <label class="campo"><span>Espera média – Hospital (min)</span><input class="entrada" type="number" min="0" step="1" name="espera_hospital_min" value="${c.espera_hospital_min ?? ""}" placeholder="Não configurado"></label>
      <label class="campo"><span>Espera média – Emergência (min)</span><input class="entrada" type="number" min="0" step="1" name="espera_emergencia_min" value="${c.espera_emergencia_min ?? ""}" placeholder="Não configurado"></label>
      <label class="campo"><span>Data de implantação</span><input class="entrada" type="date" name="data_implantacao" value="${esc(c.data_implantacao ?? "")}"></label>
    </div>
    <p class="kpi-nota" style="margin-top:12px">Última alteração: ${esc(fmtDataHora(c.updated_at))}</p>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn btn-primario" type="submit">Salvar configurações</button></div>
  </form>`;
  $("#form-rede", box).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const num = (n) => (f[n].value === "" ? null : Number(f[n].value));
    for (const n of ["custo_ubs", "custo_upa", "custo_hospital", "custo_emergencia", "custo_operacional_mensal", "espera_ubs_min", "espera_upa_min", "espera_hospital_min", "espera_emergencia_min"]) {
      if (num(n) !== null && (Number.isNaN(num(n)) || num(n) < 0)) return toast("Os custos devem ser números positivos.", "erro");
    }
    try {
      await salvarConfig({
        nome_rede: f.nome_rede.value.trim() || "Rede Municipal de Saúde",
        custo_ubs: num("custo_ubs"), custo_upa: num("custo_upa"), custo_hospital: num("custo_hospital"),
        custo_emergencia: num("custo_emergencia"), custo_operacional_mensal: num("custo_operacional_mensal") ?? 0,
        espera_ubs_min: num("espera_ubs_min"), espera_upa_min: num("espera_upa_min"),
        espera_hospital_min: num("espera_hospital_min"), espera_emergencia_min: num("espera_emergencia_min"),
        data_implantacao: f.data_implantacao.value || null,
      }, ctx.perfil.id);
      toast("Configurações salvas.");
    } catch (err) { toast(err.message, "erro"); }
  });
}

// ---------------- Unidades ----------------
async function unidades(box, ctx) {
  const lista = await listarUnidades({ incluirInativas: true });
  box.innerHTML = `<div class="card"><div class="card-cab"><div><h3>Unidades de saúde</h3><p>Usadas como origem e destino dos encaminhamentos.</p></div>
    <button class="btn btn-primario btn-sm" id="nova">${icone("mais")} Nova unidade</button></div>
    ${lista.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nome</th><th>Tipo</th><th>Endereço</th><th>Telefone</th><th>Situação</th><th></th></tr></thead>
    <tbody>${lista.map((u) => `<tr><td><strong>${esc(u.nome)}</strong></td><td>${esc(ROTULO_TIPO_CURTO[u.tipo])}</td><td>${esc(u.endereco ?? "—")}</td><td>${esc(u.telefone ?? "—")}</td>
      <td>${u.ativa ? '<span class="tag tag-ok">Ativa</span>' : '<span class="tag tag-neutra">Inativa</span>'}</td>
      <td class="num"><button class="btn btn-fantasma btn-sm" data-id="${esc(u.id)}">${icone("editar")} Editar</button></td></tr>`).join("")}</tbody></table></div>` : vazio("Nenhuma unidade cadastrada")}</div>`;
  const form = (u = {}) => {
    const m = modal({
      titulo: u.id ? "Editar unidade" : "Nova unidade",
      corpo: `<div class="grade-form">
        <label class="campo"><span>Nome *</span><input class="entrada" name="nome" value="${esc(u.nome ?? "")}"></label>
        <label class="campo"><span>Tipo *</span><select class="entrada" name="tipo">${Object.entries(ROTULO_TIPO_CURTO).map(([v, r]) => `<option value="${v}" ${v === u.tipo ? "selected" : ""}>${r}</option>`).join("")}</select></label>
        <label class="campo"><span>Cidade</span><input class="entrada" name="cidade" value="${esc(u.cidade ?? "")}"></label>
        <label class="campo"><span>Telefone</span><input class="entrada" name="telefone" value="${esc(u.telefone ?? "")}"></label></div>
        <label class="campo"><span>Endereço</span><input class="entrada" name="endereco" value="${esc(u.endereco ?? "")}"></label>
        <label class="campo"><span>Serviços</span><textarea class="entrada" name="servicos" rows="2">${esc(u.servicos ?? "")}</textarea></label>
        <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="ativa" ${u.ativa !== false ? "checked" : ""}> Unidade ativa</label>`,
      acoes: [{ rotulo: "Cancelar" }, {
        rotulo: "Salvar", classe: "btn-primario",
        aoClicar: async () => {
          const q = (n) => $(`[name=${n}]`, m.corpo);
          const dados = { id: u.id, nome: q("nome").value.trim(), tipo: q("tipo").value, cidade: q("cidade").value.trim() || null, telefone: q("telefone").value.trim() || null, endereco: q("endereco").value.trim() || null, servicos: q("servicos").value.trim() || null, ativa: q("ativa").checked };
          if (dados.nome.length < 2) { toast("Informe o nome da unidade.", "erro"); return false; }
          await salvarUnidade(dados);
          toast("Unidade salva.");
          await ctx.recarregarUnidades?.();
          unidades(box, ctx);
        },
      }],
    });
  };
  $("#nova", box).addEventListener("click", () => form());
  box.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => form(lista.find((u) => u.id === b.dataset.id))));
}

// ---------------- Regras ----------------
async function regras(box, ctx) {
  const lista = await listarRegras();
  const semTabela = !lista[0]?.id;
  box.innerHTML = `<div class="card"><div class="card-cab"><div><h3>Regras de encaminhamento</h3><p>Palavras-chave que associam o relato a um nível de atenção. As regras originais do fluxograma podem ser desativadas, mas não excluídas.</p></div></div>
    ${semTabela ? aviso("atencao", "Regras originais em uso direto", "<p>A tabela de regras ainda não foi preenchida (execute o arquivo <code>supabase/seed.sql</code>). Enquanto isso, o sistema usa as regras originais embutidas.</p>") : ""}
    ${aviso("info", "", "<p>Cadastre regras complementares somente conforme protocolos clínicos validados pela gestão. Os sinais de alerta (dor torácica, dificuldade respiratória, sinais de AVC etc.) são fixos e não podem ser desativados.</p>")}
    <form class="filtros" id="nova-regra" style="margin-top:14px">
      <label class="campo" style="flex:2 1 220px"><span>Termo ou expressão</span><input class="entrada" name="termo" maxlength="80" placeholder="Ex.: dor nas costas" ${semTabela ? "disabled" : ""}></label>
      <label class="campo"><span>Nível de atenção</span><select class="entrada" name="nivel" ${semTabela ? "disabled" : ""}>${["primaria", "secundaria", "terciaria"].map((n) => `<option value="${n}">${esc(ROTULO_NIVEL[n])}</option>`).join("")}</select></label>
      <button class="btn btn-primario" type="submit" ${semTabela ? "disabled" : ""}>${icone("mais")} Adicionar regra</button>
    </form>
    <div class="tabela-wrap" style="margin-top:16px"><table class="tabela"><thead><tr><th>Termo</th><th>Nível</th><th>Origem</th><th>Situação</th><th></th></tr></thead>
    <tbody>${lista.map((r) => `<tr><td>${esc(r.termo)}</td><td>${esc(ROTULO_NIVEL[r.nivel])}</td>
      <td>${r.origem === "original" ? '<span class="tag tag-ok">Original</span>' : '<span class="tag tag-ia">Complementar</span>'}</td>
      <td>${r.ativa ? "Ativa" : '<span class="tag tag-neutra">Desativada</span>'}</td>
      <td class="num">${r.id ? `<button class="btn btn-fantasma btn-sm" data-alternar="${esc(r.id)}" data-ativa="${r.ativa}">${r.ativa ? "Desativar" : "Ativar"}</button>
        ${r.origem !== "original" ? `<button class="btn btn-fantasma btn-sm" data-excluir="${esc(r.id)}" aria-label="Excluir">${icone("lixeira")}</button>` : ""}` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#nova-regra", box).addEventListener("submit", async (e) => {
    e.preventDefault();
    const termo = e.target.termo.value.trim();
    if (termo.length < 3) return toast("Informe um termo com pelo menos 3 letras.", "erro");
    try { await criarRegra(termo, e.target.nivel.value, ctx.perfil.id); toast("Regra adicionada."); regras(box, ctx); } catch (err) { toast(err.message, "erro"); }
  });
  box.querySelectorAll("[data-alternar]").forEach((b) => b.addEventListener("click", async () => {
    try { await alterarRegra(b.dataset.alternar, { ativa: b.dataset.ativa !== "true" }); regras(box, ctx); } catch (err) { toast(err.message, "erro"); }
  }));
  box.querySelectorAll("[data-excluir]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmar("Excluir regra", "Excluir esta regra complementar?", "Excluir", "btn-perigo"))) return;
    try { await excluirRegra(b.dataset.excluir); toast("Regra excluída."); regras(box, ctx); } catch (err) { toast(err.message, "erro"); }
  }));
}

// ---------------- Linha de base ----------------
async function base(box, ctx) {
  const lista = await listarLinhaBase();
  box.innerHTML = `<div class="card"><div class="card-cab"><div><h3>Linha de base (antes da implantação)</h3><p>Atendimentos mensais por tipo de unidade, de fonte oficial, para a comparação antes × depois.</p></div></div>
    ${aviso("info", "", "<p>Informe dados reais (ex.: e-SUS APS, SIA/SUS, relatórios da Secretaria). Sem linha de base, o sistema não exibe a comparação — ele nunca a simula.</p>")}
    <form class="filtros" id="nova-base" style="margin-top:14px">
      <label class="campo"><span>Competência</span><input class="entrada" type="month" name="competencia" max="${dataLocal(new Date()).slice(0, 7)}" required></label>
      <label class="campo"><span>Tipo de unidade</span><select class="entrada" name="tipo">${Object.entries(ROTULO_TIPO_CURTO).map(([v, r]) => `<option value="${v}">${r}</option>`).join("")}</select></label>
      <label class="campo"><span>Atendimentos no mês</span><input class="entrada" type="number" min="0" step="1" name="atendimentos" required></label>
      <label class="campo" style="flex:2 1 220px"><span>Fonte</span><input class="entrada" name="fonte" maxlength="200" placeholder="Ex.: SIA/SUS – jan/2026" required></label>
      <button class="btn btn-primario" type="submit">${icone("mais")} Salvar</button>
    </form>
    ${lista.length ? `<div class="tabela-wrap" style="margin-top:16px"><table class="tabela"><thead><tr><th>Competência</th><th>Tipo</th><th class="num">Atendimentos</th><th>Fonte</th><th></th></tr></thead>
    <tbody>${lista.map((l) => `<tr><td>${esc(fmtCompetencia(l.competencia))}</td><td>${esc(ROTULO_TIPO_CURTO[l.tipo_unidade])}</td><td class="num">${fmtNum(l.atendimentos)}</td><td>${esc(l.fonte)}</td>
      <td class="num"><button class="btn btn-fantasma btn-sm" data-excluir="${esc(l.id)}" aria-label="Excluir">${icone("lixeira")}</button></td></tr>`).join("")}</tbody></table></div>` : vazio("Nenhum mês cadastrado", "", "calendario")}</div>`;
  $("#nova-base", box).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.competencia.value || f.atendimentos.value === "" || f.fonte.value.trim().length < 3) return toast("Preencha competência, quantidade e fonte.", "erro");
    try {
      await salvarLinhaBase({ competencia: `${f.competencia.value}-01`, tipo_unidade: f.tipo.value, atendimentos: Number(f.atendimentos.value), fonte: f.fonte.value.trim(), created_by: ctx.perfil.id });
      toast("Linha de base salva.");
      base(box, ctx);
    } catch (err) { toast(err.message, "erro"); }
  });
  box.querySelectorAll("[data-excluir]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmar("Excluir", "Excluir este mês da linha de base?", "Excluir", "btn-perigo"))) return;
    try { await excluirLinhaBase(b.dataset.excluir); base(box, ctx); } catch (err) { toast(err.message, "erro"); }
  }));
}

// ---------------- Auditoria ----------------
const ROTULO_TABELA = { atendimentos: "Atendimento", perfis: "Usuário", unidades: "Unidade", configuracoes: "Configurações", regras_encaminhamento: "Regra", linha_base: "Linha de base", economia_comprovada: "Economia comprovada" };
const ROTULO_ACAO = { INSERT: "Inclusão", UPDATE: "Alteração", DELETE: "Exclusão" };
async function auditoria(box) {
  const [lista, perfis] = await Promise.all([listarAuditoria(300), listarPerfis()]);
  const nomes = Object.fromEntries(perfis.map((p) => [p.id, p.nome]));
  box.innerHTML = `<div class="card"><div class="card-cab"><div><h3>Registro de auditoria</h3><p>Últimas 300 operações. Os registros não podem ser alterados nem apagados pela aplicação.</p></div></div>
    ${lista.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Registro</th><th>Campos alterados</th></tr></thead>
    <tbody>${lista.map((a) => {
      const campos = a.acao === "UPDATE" ? Object.keys(a.depois ?? {}).filter((k) => !["atualizado_em", "updated_at"].includes(k) && JSON.stringify(a.antes?.[k]) !== JSON.stringify(a.depois?.[k])) : [];
      return `<tr><td>${esc(fmtDataHora(a.ocorrido_em))}</td><td>${esc(nomes[a.usuario_id] ?? (a.usuario_id ? "—" : "Sistema"))}</td><td>${esc(ROTULO_ACAO[a.acao] ?? a.acao)}</td>
        <td>${esc(ROTULO_TABELA[a.tabela] ?? a.tabela)}${a.tabela === "atendimentos" && (a.depois ?? a.antes)?.protocolo ? ` nº ${esc((a.depois ?? a.antes).protocolo)}` : ""}</td>
        <td class="trunc">${esc(campos.join(", ") || "—")}</td></tr>`;
    }).join("")}</tbody></table></div>` : vazio("Nenhum registro")}</div>`;
}
