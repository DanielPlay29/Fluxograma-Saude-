import { listarAtendimentos, listarRegras, obterAtendimento } from "../servicos/dados.js";
import { ROTULO_NIVEL, ROTULO_DESTINO, SINAIS_ALERTA } from "../core/triagem.js";
import { icone } from "../ui/icones.js";
import {
  esc, $, aviso, carregando, vazio, fmtNum, fmtPct, fmtDataHora, tagDestino, tagResultado,
  ROTULO_TIPO_ATENDIMENTO, ROTULO_TIPO_CURTO, ROTULO_FAIXA,
} from "../ui/comum.js";

export const subtitulo = "Como o paciente percorre a rede: do relato ao destino adequado";

const NIVEIS = ["primaria", "secundaria", "terciaria", "emergencia", "indefinido"];
const TIPOS = ["UBS", "UPA", "HOSPITAL", "EMERGENCIA"];

function barras(itens, total) {
  return `<div class="fluxo-destinos">${itens.map(([rotulo, n, cls = ""]) => `
    <div class="${cls}"><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:3px"><span>${esc(rotulo)}</span><span class="num">${fmtNum(n)}</span></div>
    <div class="barra"><span style="width:${total ? Math.round((n / total) * 100) : 0}%"></span></div></div>`).join("")}</div>`;
}

export async function render(el, ctx) {
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  el.innerHTML = `
    <div class="card">
      <div class="card-cab"><div><h3>Mapa do fluxo de pacientes</h3><p id="desc-fluxo">Totais do período</p></div>
        <label class="campo" style="min-width:170px"><span class="sr-only">Período</span>
          <select class="entrada" id="dias"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option></select></label></div>
      <div id="mapa">${carregando()}</div>
    </div>
    <div class="card">
      <div class="card-cab"><div><h3>Rastrear um atendimento</h3><p>Veja o caminho completo de um paciente: origem, sintomas, interpretação, critérios, destino recomendado, destino escolhido e resultado.</p></div></div>
      <div class="filtros"><label class="campo" style="flex:1 1 320px"><span>Atendimento</span><select class="entrada" id="sel-atend"><option value="">Selecione um atendimento recente…</option></select></label></div>
      <div id="rastreio" style="margin-top:16px"></div>
    </div>
    <div class="card" id="regras">${carregando("Carregando regras…")}</div>`;

  let lista = [];
  const desenharMapa = async () => {
    const dias = Number($("#dias", el).value);
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0); inicio.setDate(inicio.getDate() - dias + 1);
    $("#mapa", el).innerHTML = carregando();
    try {
      lista = await listarAtendimentos({ inicio, limite: 5000 });
    } catch (e) {
      $("#mapa", el).innerHTML = aviso("erro", e.message);
      return;
    }
    if (!ctx.ativo()) return;
    $("#desc-fluxo", el).textContent = `${fmtNum(lista.length)} atendimento(s) desde ${inicio.toLocaleDateString("pt-BR")}`;
    const sel = $("#sel-atend", el);
    const escolhido = sel.value || params.get("id") || "";
    sel.innerHTML = `<option value="">Selecione um atendimento recente…</option>${lista.slice(0, 200).map((a) =>
      `<option value="${esc(a.id)}">nº ${esc(a.protocolo)} · ${esc(fmtDataHora(a.created_at))} · ${esc(a.origem_nome)} → ${esc(ROTULO_TIPO_CURTO[a.destino_escolhido])}</option>`).join("")}`;
    if (escolhido) sel.value = escolhido;
    mapa(null);
    if (escolhido) rastrear(escolhido);
  };

  function contar(campo, chaves) {
    return chaves.map((k) => [k, lista.filter((a) => a[campo] === k).length]);
  }

  function mapa(a) {
    const t = lista.length;
    const ia = lista.filter((x) => x.interpretacao_fonte === "ia").length;
    const comAlerta = lista.filter((x) => x.alertas?.length).length;
    const concord = lista.filter((x) => x.destino_recomendado && x.destino_recomendado === x.destino_escolhido).length;
    const baseConc = lista.filter((x) => x.destino_recomendado).length;
    const origens = contar("origem_tipo", TIPOS).filter(([, n]) => n);
    const etapa = (n, ic, titulo, corpo, ativa) => `<div class="fluxo-etapa"><div class="fluxo-caixa ${ativa ? "ativa" : ""}">
      <div style="display:flex;align-items:center;gap:10px"><span class="fluxo-icone">${icone(ic)}</span><div><span class="rotulo">${n}</span><h4>${esc(titulo)}</h4></div></div>${corpo}</div></div>`;

    const html = a
      ? `<div class="fluxo">
        ${etapa("1", "paciente", "Paciente", `<p><strong>${esc(a.origem_nome)}</strong></p><p>${esc(ROTULO_TIPO_ATENDIMENTO[a.tipo_atendimento])} · ${esc(ROTULO_FAIXA[a.faixa_etaria] ?? "Faixa não informada")}</p><p>${esc(fmtDataHora(a.created_at))}</p>`, true)}
        ${etapa("2", "estetoscopio", "Avaliação inicial", `<p>${a.alertas?.length ? `<span class="tag tag-erro">${icone("alerta", 'width="12" height="12"')} ${esc(a.alertas.join(", "))}</span>` : '<span class="tag tag-ok">Sem sinais de alerta</span>'}</p><p class="evidencia">“${esc(a.relato.length > 120 ? a.relato.slice(0, 120) + "…" : a.relato)}”</p>`, true)}
        ${etapa("3", "ia", "Interpretação dos sintomas", `<p>${a.interpretacao_fonte === "ia" ? '<span class="tag tag-ia">IA</span>' : '<span class="tag tag-neutra">Regras locais</span>'}</p><p>${esc(a.interpretacao?.resumo_tecnico ?? "—")}</p>`, true)}
        ${etapa("4", "regras", "Protocolo de encaminhamento", `<p><strong>${esc(ROTULO_NIVEL[a.nivel_recomendado])}</strong></p><p>${a.destino_recomendado ? `Recomendado: ${tagDestino(a.destino_recomendado)}` : "Sem recomendação automática"}</p>`, true)}
        ${etapa("5", "alvo", "Destino", `<div class="fluxo-destinos">${TIPOS.map((tp) => `<div class="fluxo-destino ${a.destino_recomendado === tp ? "rec" : ""} ${a.destino_escolhido === tp ? "esc" : ""}"><span>${esc(ROTULO_TIPO_CURTO[tp])}</span>${a.destino_escolhido === tp ? "✓ escolhido" : a.destino_recomendado === tp ? "recomendado" : ""}</div>`).join("")}</div><p style="margin-top:6px">${tagResultado(a.resultado)}</p>`, true)}
      </div>`
      : t === 0
        ? vazio("Nenhum atendimento no período", "Os números do fluxo aparecem conforme os atendimentos são registrados.", "fluxo")
        : `<div class="fluxo">
        ${etapa("1", "paciente", "Paciente", `<p><strong class="num">${fmtNum(t)}</strong> pacientes</p>${barras(origens.map(([k, n]) => [`Chegaram em ${ROTULO_TIPO_CURTO[k]}`, n]), t)}`)}
        ${etapa("2", "estetoscopio", "Avaliação inicial", `<p><strong class="num">${fmtNum(comAlerta)}</strong> com sinal de alerta</p>${barras([["Com alerta", comAlerta], ["Sem alerta", t - comAlerta]], t)}`)}
        ${etapa("3", "ia", "Interpretação dos sintomas", `${barras([["Por IA", ia], ["Regras locais", t - ia]], t)}`)}
        ${etapa("4", "regras", "Protocolo de encaminhamento", barras(contar("nivel_recomendado", NIVEIS).filter(([, n]) => n).map(([k, n]) => [ROTULO_NIVEL[k], n]), t))}
        ${etapa("5", "alvo", "Destino adequado", `${barras(contar("destino_escolhido", TIPOS).filter(([, n]) => n).map(([k, n]) => [ROTULO_TIPO_CURTO[k], n]), t)}<p style="margin-top:6px">Concordância com o protocolo: <strong>${fmtPct(baseConc ? (concord / baseConc) * 100 : null)}</strong></p>`)}
      </div>`;
    $("#mapa", el).innerHTML = html;
  }

  async function rastrear(id) {
    const box = $("#rastreio", el);
    if (!id) { box.innerHTML = ""; mapa(null); return; }
    box.innerHTML = carregando();
    let a = lista.find((x) => x.id === id);
    try { if (!a) a = await obterAtendimento(id); } catch (e) { box.innerHTML = aviso("erro", e.message); return; }
    if (!ctx.ativo()) return;
    mapa(a);
    const i = a.interpretacao ?? {};
    box.innerHTML = `<div class="fluxo-detalhe"><dl>
      <dt>Origem do paciente</dt><dd>${esc(a.origem_nome)} ${tagDestino(a.origem_tipo)}</dd>
      <dt>Sintomas informados</dt><dd>“${esc(a.relato)}”</dd>
      <dt>Interpretação realizada</dt><dd>${esc(i.resumo_tecnico ?? "—")} ${a.interpretacao_fonte === "ia" ? '<span class="tag tag-ia">IA</span>' : '<span class="tag tag-neutra">Regras locais</span>'}</dd>
      <dt>Critérios do encaminhamento</dt><dd><ul class="lista-criterios">${(a.criterios ?? []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul></dd>
      <dt>Destino recomendado</dt><dd>${a.destino_recomendado ? `${tagDestino(a.destino_recomendado)} ${esc(ROTULO_DESTINO[a.destino_recomendado])}` : "Sem recomendação automática"}</dd>
      <dt>Destino escolhido</dt><dd>${tagDestino(a.destino_escolhido)} ${esc(a.destino_unidade?.nome ?? "")}${a.justificativa ? `<br><span class="evidencia">Justificativa: ${esc(a.justificativa)}</span>` : ""}</dd>
      <dt>Resultado</dt><dd>${tagResultado(a.resultado)} ${a.resultado_em ? `<small>em ${esc(fmtDataHora(a.resultado_em))}</small>` : ""}</dd>
      <dt>Registrado por</dt><dd>${esc(a.autor?.nome ?? "—")} · ${esc(fmtDataHora(a.created_at))}</dd>
    </dl></div>`;
  }

  $("#dias", el).addEventListener("change", desenharMapa);
  $("#sel-atend", el).addEventListener("change", (e) => rastrear(e.target.value));
  await desenharMapa();

  // Regras do protocolo (as originais são preservadas e exibidas aqui)
  try {
    const regras = await listarRegras();
    if (!ctx.ativo()) return;
    const col = (nivel, destino) => {
      const r = regras.filter((x) => x.nivel === nivel);
      return `<div><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><h4>${esc(ROTULO_NIVEL[nivel])}</h4>${tagDestino(destino)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">${r.map((x) => `<span class="tag ${x.ativa === false ? "tag-neutra" : x.origem === "original" ? "tag-ok" : "tag-ia"}" ${x.ativa === false ? 'style="text-decoration:line-through"' : ""}>${esc(x.termo)}</span>`).join("")}</div></div>`;
    };
    $("#regras", el).innerHTML = `
      <div class="card-cab"><div><h3>Regras do protocolo de encaminhamento</h3><p>Verde: regras originais do fluxograma · Azul: regras complementares cadastradas pela administração</p></div></div>
      <div class="grade grade-3">${col("primaria", "UBS")}${col("secundaria", "UPA")}${col("terciaria", "HOSPITAL")}</div>
      <div style="margin-top:18px">${aviso("erro", "Sinais de alerta — sempre verificados, antes de qualquer regra", `<p>${SINAIS_ALERTA.map((s) => esc(s.rotulo)).join(" · ")}. Quando presentes, o sistema orienta avaliação imediata e o destino recomendado passa a ser o serviço de emergência.</p>`)}</div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><span class="rotulo" style="align-self:center">Páginas públicas das unidades:</span>
        <a class="btn btn-secundario btn-sm" href="UBS.html" target="_blank" rel="noopener">${icone("UBS")} UBS</a>
        <a class="btn btn-secundario btn-sm" href="UPA.html" target="_blank" rel="noopener">${icone("UPA")} UPA</a>
        <a class="btn btn-secundario btn-sm" href="Hospital.html" target="_blank" rel="noopener">${icone("HOSPITAL")} Hospital</a>
        <a class="btn btn-secundario btn-sm" href="index.html" target="_blank" rel="noopener">${icone("paciente")} Página pública (cidadão)</a></div>`;
  } catch (e) {
    $("#regras", el).innerHTML = aviso("erro", e.message);
  }
}
