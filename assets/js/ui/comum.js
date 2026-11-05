import { icone } from "./icones.js";
import { ROTULO_DESTINO } from "../core/triagem.js";

/** Escapa texto para inserir com segurança em HTML (evita XSS). */
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = new Intl.NumberFormat("pt-BR");
export const fmtMoeda = (v) => moeda.format(Number(v ?? 0));
export const fmtNum = (v) => inteiro.format(Number(v ?? 0));
export const fmtPct = (v, casas = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: 0 })}%`);
export const fmtData = (d) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
export const fmtDataHora = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
export const fmtCompetencia = (d) => {
  if (!d) return "—";
  const [a, m] = String(d).split("-");
  return `${m}/${a}`;
};

export const ROTULO_TIPO_ATENDIMENTO = {
  demanda_espontanea: "Demanda espontânea",
  agendado: "Agendado",
  retorno: "Retorno",
  transferencia: "Transferência",
  orientacao: "Orientação",
};
export const ROTULO_RESULTADO = {
  pendente: "Pendente",
  atendido_no_destino: "Atendido no destino",
  reencaminhado: "Reencaminhado",
  nao_compareceu: "Não compareceu",
  evadiu: "Evadiu",
};
export const CLASSE_RESULTADO = {
  pendente: "tag-neutra",
  atendido_no_destino: "tag-ok",
  reencaminhado: "tag-atencao",
  nao_compareceu: "tag-neutra",
  evadiu: "tag-erro",
};
export const ROTULO_TIPO_CURTO = { UBS: "UBS", UPA: "UPA", HOSPITAL: "Hospital", EMERGENCIA: "Emergência" };
export const ROTULO_FAIXA = { "0-11": "0 a 11 anos", "12-17": "12 a 17 anos", "18-39": "18 a 39 anos", "40-59": "40 a 59 anos", "60+": "60 anos ou mais", nao_informada: "Não informada" };

export function tagDestino(tipo) {
  if (!tipo) return '<span class="tag tag-neutra">—</span>';
  return `<span class="tag tag-${esc(tipo)}" title="${esc(ROTULO_DESTINO[tipo])}">${esc(ROTULO_TIPO_CURTO[tipo] ?? tipo)}</span>`;
}
export function tagResultado(r) {
  return `<span class="tag ${CLASSE_RESULTADO[r] ?? "tag-neutra"}">${esc(ROTULO_RESULTADO[r] ?? r)}</span>`;
}

export function vazio(titulo, texto = "", nomeIcone = "info") {
  return `<div class="vazio">${icone(nomeIcone)}<strong>${esc(titulo)}</strong>${texto ? `<span>${texto}</span>` : ""}</div>`;
}

export function aviso(tipo, titulo, texto = "") {
  const ic = { info: "info", atencao: "alerta", erro: "alerta", ok: "ok" }[tipo];
  return `<div class="aviso aviso-${tipo}" role="${tipo === "erro" ? "alert" : "status"}">${icone(ic)}<div>${titulo ? `<strong>${esc(titulo)}</strong>` : ""}${texto}</div></div>`;
}

export function carregando(texto = "Carregando…") {
  return `<div class="vazio"><span class="carregando"><span class="spinner"></span>${esc(texto)}</span></div>`;
}

export function toast(mensagem, tipo = "ok") {
  let box = $(".toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("aria-live", "polite");
    document.body.append(box);
  }
  const t = document.createElement("div");
  t.className = `toast ${tipo === "erro" ? "erro" : ""}`;
  t.textContent = mensagem;
  box.append(t);
  setTimeout(() => t.remove(), 4500);
}

/**
 * Abre um modal. `acoes` = [{rotulo, classe, aoClicar(fechar) → bool|Promise}]
 * Retorna { el, fechar }.
 */
export function modal({ titulo, corpo, acoes = [], largura }) {
  const fundo = document.createElement("div");
  fundo.className = "modal-fundo";
  fundo.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(titulo)}" ${largura ? `style="width:min(${largura}px,100%)"` : ""}>
    <div class="modal-cab"><h2>${esc(titulo)}</h2><button class="btn btn-fantasma btn-sm" data-fechar aria-label="Fechar">${icone("fechar")}</button></div>
    <div class="modal-corpo"></div>
    ${acoes.length ? '<div class="modal-rodape"></div>' : ""}
  </div>`;
  const corpoEl = $(".modal-corpo", fundo);
  if (typeof corpo === "string") corpoEl.innerHTML = corpo;
  else if (corpo) corpoEl.append(corpo);
  const anterior = document.activeElement;
  const fechar = () => {
    fundo.remove();
    document.removeEventListener("keydown", tecla);
    anterior?.focus?.();
  };
  const tecla = (e) => e.key === "Escape" && fechar();
  document.addEventListener("keydown", tecla);
  fundo.addEventListener("click", (e) => { if (e.target === fundo || e.target.closest("[data-fechar]")) fechar(); });
  const rod = $(".modal-rodape", fundo);
  for (const a of acoes) {
    const b = document.createElement("button");
    b.className = `btn ${a.classe ?? "btn-secundario"}`;
    b.textContent = a.rotulo;
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const r = await (a.aoClicar?.(fechar) ?? true);
        if (r !== false) fechar();
      } catch (e) {
        toast(e.message, "erro");
      } finally {
        b.disabled = false;
      }
    });
    rod.append(b);
  }
  document.body.append(fundo);
  ($("input, select, textarea", corpoEl) ?? $("[data-fechar]", fundo)).focus();
  return { el: fundo, corpo: corpoEl, fechar };
}

export function confirmar(titulo, texto, rotulo = "Confirmar", classe = "btn-primario") {
  return new Promise((ok) => {
    let respondeu = false;
    const m = modal({
      titulo,
      corpo: `<p>${esc(texto)}</p>`,
      acoes: [
        { rotulo: "Cancelar", aoClicar: () => { respondeu = true; ok(false); } },
        { rotulo, classe, aoClicar: () => { respondeu = true; ok(true); } },
      ],
    });
    new MutationObserver((_, obs) => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!respondeu) ok(false); } })
      .observe(document.body, { childList: true });
  });
}

/** Carrega um script externo uma única vez (bibliotecas de exportação). */
const scripts = new Map();
export function carregarScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((ok, erro) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => { scripts.delete(src); erro(new Error("Não foi possível carregar a biblioteca de exportação. Verifique a internet.")); };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

export function baixarArquivo(nome, conteudo, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
