import { esc, ROTULO_TIPO_ATENDIMENTO, $, $$ } from "./comum.js";
import { dataLocal } from "../servicos/dados.js";

const PERIODOS = [["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"], ["ano", "Ano"]];
let memoria = null; // mantém os filtros ao trocar de tela

/**
 * Barra de filtros (período, data de referência, unidade, tipo de atendimento).
 * Chama aoMudar(estado) sempre que algo muda (e uma vez ao iniciar).
 */
export function criarFiltros(el, { unidades, aoMudar, extras = "" }) {
  const estado = memoria ?? { periodo: "mes", referencia: dataLocal(new Date()), unidadeId: "", tipoAtendimento: "", canal: "" };
  el.innerHTML = `<div class="card"><div class="filtros">
    <div class="campo"><span>Período</span>
      <div class="segmentado" role="group" aria-label="Período">
        ${PERIODOS.map(([v, r]) => `<button type="button" data-periodo="${v}" aria-pressed="${estado.periodo === v}">${r}</button>`).join("")}
      </div>
    </div>
    <label class="campo"><span>Data de referência</span><input class="entrada" type="date" name="referencia" value="${esc(estado.referencia)}" max="${dataLocal(new Date())}"></label>
    <label class="campo"><span>Unidade de saúde</span>
      <select class="entrada" name="unidadeId"><option value="">Todas as unidades</option>
        ${unidades.map((u) => `<option value="${esc(u.id)}" ${u.id === estado.unidadeId ? "selected" : ""}>${esc(u.nome)}</option>`).join("")}
      </select></label>
    <label class="campo"><span>Tipo de atendimento</span>
      <select class="entrada" name="tipoAtendimento"><option value="">Todos</option>
        ${Object.entries(ROTULO_TIPO_ATENDIMENTO).map(([v, r]) => `<option value="${v}" ${v === estado.tipoAtendimento ? "selected" : ""}>${r}</option>`).join("")}
      </select></label>
    <label class="campo"><span>Canal</span>
      <select class="entrada" name="canal">
        <option value="">Site e profissionais</option>
        <option value="site" ${estado.canal === "site" ? "selected" : ""}>Site (cidadãos)</option>
        <option value="profissional" ${estado.canal === "profissional" ? "selected" : ""}>Registrados por profissionais</option>
      </select></label>
    ${extras}
  </div></div>`;

  const emitir = () => { memoria = { ...estado }; aoMudar({ ...estado }); };
  $$("[data-periodo]", el).forEach((b) => b.addEventListener("click", () => {
    estado.periodo = b.dataset.periodo;
    $$("[data-periodo]", el).forEach((x) => x.setAttribute("aria-pressed", x === b));
    emitir();
  }));
  for (const nome of ["referencia", "unidadeId", "tipoAtendimento", "canal"]) {
    $(`[name="${nome}"]`, el).addEventListener("change", (e) => {
      estado[nome] = e.target.value || (nome === "referencia" ? dataLocal(new Date()) : "");
      emitir();
    });
  }
  emitir();
  return estado;
}

/** Converte "AAAA-MM-DD" em Date local. */
export function dataDeTexto(t) {
  const [a, m, d] = String(t).split("-").map(Number);
  return new Date(a, (m ?? 1) - 1, d ?? 1);
}
