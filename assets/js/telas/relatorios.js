import { carregarPainel } from "../servicos/painel.js";
import { economiaDoAtendimento, TIPOS } from "../core/indicadores.js";
import { COMPLEXIDADE, ROTULO_NIVEL } from "../core/triagem.js";
import { dataLocal } from "../servicos/dados.js";
import { icone } from "../ui/icones.js";
import {
  esc, $, aviso, carregando, vazio, toast, carregarScript, baixarArquivo, fmtNum, fmtPct, fmtMoeda, fmtDataHora,
  ROTULO_TIPO_CURTO, ROTULO_RESULTADO, ROTULO_TIPO_ATENDIMENTO, ROTULO_FAIXA,
} from "../ui/comum.js";
import { grafico, destruirGraficos, CORES, eixos } from "../ui/graficos.js";
import { kpi } from "./dashboard.js";

export const subtitulo = "Relatórios mensais com exportação em PDF, Excel e CSV";

const LIBS = {
  jspdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
  autotable: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js",
  xlsx: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
};

/** Linhas de atendimento SEM relato livre e SEM código do paciente (minimização LGPD). */
function linhasExportacao(atendimentos, config) {
  return atendimentos.map((a) => ({
    "Nº": a.protocolo,
    "Data/hora": fmtDataHora(a.created_at),
    "Unidade de origem": a.origem_nome,
    "Tipo da origem": ROTULO_TIPO_CURTO[a.origem_tipo],
    "Tipo de atendimento": ROTULO_TIPO_ATENDIMENTO[a.tipo_atendimento],
    "Faixa etária": ROTULO_FAIXA[a.faixa_etaria] ?? "",
    "Sinais de alerta": (a.alertas ?? []).join(", "),
    "Nível recomendado": ROTULO_NIVEL[a.nivel_recomendado],
    "Destino recomendado": ROTULO_TIPO_CURTO[a.destino_recomendado] ?? "",
    "Destino escolhido": ROTULO_TIPO_CURTO[a.destino_escolhido],
    "Divergiu do protocolo": a.destino_recomendado && a.destino_recomendado !== a.destino_escolhido ? "Sim" : "Não",
    "Resultado": ROTULO_RESULTADO[a.resultado],
    "Interpretação": a.interpretacao_fonte === "ia" ? "IA" : "Regras locais",
    "Economia potencial estimada (R$)": economiaDoAtendimento(a, config) ?? "",
  }));
}

function porUnidade(atendimentos, config) {
  const u = {};
  for (const a of atendimentos) {
    const x = (u[a.origem_nome] ??= { tipo: a.origem_tipo, total: 0, menor: 0, economia: 0 });
    x.total++;
    if (COMPLEXIDADE[a.destino_escolhido] < COMPLEXIDADE[a.origem_tipo]) x.menor++;
    x.economia += economiaDoAtendimento(a, config) ?? 0;
  }
  return Object.entries(u).sort((a, b) => b[1].total - a[1].total).map(([nome, x]) => ({
    nome, ...x, pct: COMPLEXIDADE[x.tipo] > 1 && x.total ? (x.menor / x.total) * 100 : null,
  }));
}

export async function render(el, ctx) {
  const mesAtual = dataLocal(new Date()).slice(0, 7);
  el.innerHTML = `
    <div class="card"><form class="filtros" id="form-rel">
      <label class="campo"><span>Mês de referência</span><input class="entrada" type="month" name="mes" value="${mesAtual}" max="${mesAtual}" required></label>
      <label class="campo"><span>Unidade de saúde</span><select class="entrada" name="unidade"><option value="">Toda a rede</option>${ctx.unidades.map((u) => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join("")}</select></label>
      <button class="btn btn-primario" type="submit">${icone("relatorios")} Gerar relatório</button>
    </form></div>
    <div id="rel"></div>`;
  const f = $("#form-rel", el);
  let d = null;
  let unidadeNome = "Toda a rede";

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    destruirGraficos();
    const box = $("#rel", el);
    box.innerHTML = carregando("Gerando relatório…");
    unidadeNome = f.unidade.value ? f.unidade.selectedOptions[0].textContent : "Toda a rede";
    try {
      d = await carregarPainel({ periodo: "mes", referencia: `${f.mes.value}-01`, unidadeId: f.unidade.value, tipoAtendimento: "" });
    } catch (err) {
      box.innerHTML = aviso("erro", err.message);
      return;
    }
    if (!ctx.ativo()) return;
    desenhar(box);
  });

  function desenhar(box) {
    const { ind, config } = d;
    const unidades = porUnidade(d.atendimentos, config);
    box.innerHTML = `<div class="card" id="relatorio">
      <div class="relatorio-cab"><div><span class="rotulo">${esc(config.nome_rede ?? "Rede Municipal de Saúde")}</span>
        <h2>Relatório mensal de encaminhamentos</h2>
        <p style="color:var(--texto-2)">Período: <strong>${esc(d.descricao)}</strong> · Abrangência: <strong>${esc(unidadeNome)}</strong></p></div>
        <div style="text-align:right;font-size:12px;color:var(--texto-3)">Gerado em ${esc(fmtDataHora(new Date()))}<br>por ${esc(ctx.perfil.nome)}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <button class="btn btn-secundario btn-sm" id="exp-pdf" ${ind.total ? "" : "disabled"}>${icone("baixar")} PDF</button>
        <button class="btn btn-secundario btn-sm" id="exp-xlsx" ${ind.total ? "" : "disabled"}>${icone("baixar")} Excel</button>
        <button class="btn btn-secundario btn-sm" id="exp-csv" ${ind.total ? "" : "disabled"}>${icone("baixar")} CSV</button>
        <span class="kpi-nota" style="align-self:center">As exportações não incluem o relato livre nem o código do paciente (LGPD).</span>
      </div>
      ${ind.total ? `
      <div class="grade grade-kpi">
        ${kpi({ rotulo: "Pacientes atendidos", valor: fmtNum(ind.total), ic: "paciente" })}
        ${kpi({ rotulo: "Redirecionados", valor: fmtNum(ind.redirecionados), ic: "setas", cor: "azul" })}
        ${kpi({ rotulo: "Otimização", valor: fmtPct(ind.otimizacaoPct), ic: "otimizacao", cor: "positivo" })}
        ${kpi({ rotulo: "Economia potencial estimada", valor: fmtMoeda(ind.economia.potencial), ic: "economia", destaque: true })}
      </div>
      <div class="grade grade-2" style="margin-top:16px">
        <div class="card" style="box-shadow:none"><div class="card-cab"><h3>Encaminhamentos por destino</h3></div><div class="grafico"><canvas id="g-rel-destino"></canvas></div></div>
        <div class="card" style="box-shadow:none"><div class="card-cab"><h3>Atendimentos por dia</h3></div><div class="grafico"><canvas id="g-rel-dia"></canvas></div></div>
      </div>
      <div class="card" style="box-shadow:none;margin-top:16px"><div class="card-cab"><h3>Comparação entre unidades de saúde</h3></div>
        <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Unidade</th><th>Tipo</th><th class="num">Atendimentos</th><th class="num">Para menor complexidade</th><th class="num">% otimização</th><th class="num">Economia potencial</th></tr></thead>
        <tbody>${unidades.map((u) => `<tr><td>${esc(u.nome)}</td><td>${esc(ROTULO_TIPO_CURTO[u.tipo])}</td><td class="num">${fmtNum(u.total)}</td><td class="num">${fmtNum(u.menor)}</td><td class="num">${u.pct === null ? "n/a" : fmtPct(u.pct)}</td><td class="num">${fmtMoeda(u.economia)}</td></tr>`).join("")}</tbody></table></div></div>
      <div style="margin-top:16px">${aviso("info", "Notas metodológicas", `<p>Concordância com o protocolo: ${fmtPct(ind.concordancia.pct)}. Direcionados corretamente (entre ${fmtNum(ind.desfecho.conhecidos)} desfechos registrados): ${fmtPct(ind.desfecho.pct)}. A economia potencial é uma estimativa calculada com custos médios configurados e não representa economia comprovada${d.comprovada.length ? `; economia comprovada registrada no mês: ${fmtMoeda(d.comprovadaTotal)}` : ""}.</p>`)}</div>`
      : vazio("Sem atendimentos neste mês", "Escolha outro mês ou unidade.", "relatorios")}
    </div>`;
    if (!ind.total) return;

    grafico($("#g-rel-destino", box), {
      type: "bar",
      data: { labels: TIPOS.map((t) => ROTULO_TIPO_CURTO[t]), datasets: [{ label: "Encaminhamentos", data: TIPOS.map((t) => ind.porDestino[t]), backgroundColor: TIPOS.map((t) => CORES[t]), borderRadius: 6, maxBarThickness: 46 }] },
      options: { animation: false, plugins: { legend: { display: false } }, scales: eixos() },
    });
    grafico($("#g-rel-dia", box), {
      type: "line",
      data: { labels: ind.serie.map((s) => s.rotulo), datasets: [{ label: "Atendimentos", data: ind.serie.map((s) => s.total), borderColor: CORES.primaria, backgroundColor: "rgba(27,122,92,.12)", fill: true, tension: 0.3, pointRadius: 2 }] },
      options: { animation: false, plugins: { legend: { display: false } }, scales: eixos() },
    });

    const nomeArq = `relatorio-encaminhamentos-${f.mes.value}${f.unidade.value ? "-" + unidadeNome.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-") : ""}`;
    $("#exp-csv", box).addEventListener("click", () => exportarCSV(nomeArq));
    $("#exp-xlsx", box).addEventListener("click", (e) => comBotao(e.currentTarget, () => exportarExcel(nomeArq, unidades)));
    $("#exp-pdf", box).addEventListener("click", (e) => comBotao(e.currentTarget, () => exportarPDF(nomeArq, unidades, box)));
  }

  async function comBotao(btn, fn) {
    btn.disabled = true;
    try { await fn(); toast("Arquivo gerado."); } catch (e) { toast(e.message, "erro"); } finally { btn.disabled = false; }
  }

  function exportarCSV(nome) {
    const linhas = linhasExportacao(d.atendimentos, d.config);
    const cab = Object.keys(linhas[0]);
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cab.map(cel).join(";"), ...linhas.map((l) => cab.map((c) => cel(l[c])).join(";"))].join("\r\n");
    baixarArquivo(`${nome}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
    toast("Arquivo gerado.");
  }

  function resumo() {
    const { ind } = d;
    return [
      ["Rede", d.config.nome_rede ?? ""], ["Período", d.descricao], ["Abrangência", unidadeNome], ["Gerado em", fmtDataHora(new Date())],
      ["Pacientes atendidos", ind.total], ["Pacientes redirecionados", ind.redirecionados],
      ...TIPOS.map((t) => [`Encaminhamentos para ${ROTULO_TIPO_CURTO[t]}`, ind.porDestino[t]]),
      ["Poderiam ser atendidos em menor complexidade", ind.menorComplexidade],
      ["Otimização dos encaminhamentos (%)", ind.otimizacaoPct === null ? "—" : Number(ind.otimizacaoPct.toFixed(1))],
      ["Concordância com o protocolo (%)", ind.concordancia.pct === null ? "—" : Number(ind.concordancia.pct.toFixed(1))],
      ["Direcionados corretamente (%)", ind.desfecho.pct === null ? "—" : Number(ind.desfecho.pct.toFixed(1))],
      ["Economia potencial ESTIMADA (R$)", Number(ind.economia.potencial.toFixed(2))],
      ["Estimada com desfecho confirmado (R$)", Number(ind.economia.comDesfechoConfirmado.toFixed(2))],
      ["Economia COMPROVADA (R$)", d.comprovada.length ? Number(d.comprovadaTotal.toFixed(2)) : "Sem dados"],
      ["Custo operacional da plataforma no período (R$)", Number(ind.economia.custoOperacional.toFixed(2))],
    ];
  }

  async function exportarExcel(nome, unidades) {
    await carregarScript(LIBS.xlsx);
    const X = window.XLSX;
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Indicador", "Valor"], ...resumo()]), "Resumo");
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(unidades.map((u) => ({
      Unidade: u.nome, Tipo: ROTULO_TIPO_CURTO[u.tipo], Atendimentos: u.total, "Para menor complexidade": u.menor,
      "% otimização": u.pct === null ? "n/a" : Number(u.pct.toFixed(1)), "Economia potencial (R$)": Number(u.economia.toFixed(2)),
    }))), "Unidades");
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(linhasExportacao(d.atendimentos, d.config)), "Atendimentos");
    X.writeFile(wb, `${nome}.xlsx`);
  }

  async function exportarPDF(nome, unidades, box) {
    await carregarScript(LIBS.jspdf);
    await carregarScript(LIBS.autotable);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(15, 74, 58);
    doc.rect(0, 0, W, 26, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text("Relatório mensal de encaminhamentos", 14, 12);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(`${d.config.nome_rede ?? ""} · ${d.descricao} · ${unidadeNome}`, 14, 19);
    doc.setTextColor(21, 35, 30);
    doc.autoTable({
      startY: 32, head: [["Indicador", "Valor"]],
      body: resumo().slice(4).map(([k, v]) => [k, typeof v === "number" && /R\$/.test(k) ? fmtMoeda(v) : String(v)]),
      theme: "grid", headStyles: { fillColor: [27, 122, 92] }, styles: { fontSize: 9 }, columnStyles: { 1: { halign: "right" } },
    });
    let y = doc.lastAutoTable.finalY + 6;
    const imgs = [$("#g-rel-destino", box), $("#g-rel-dia", box)].filter(Boolean);
    const larg = (W - 28 - 6) / 2;
    imgs.forEach((c, i) => {
      const alt = larg * (c.height / c.width);
      doc.addImage(c.toDataURL("image/png", 1), "PNG", 14 + i * (larg + 6), y, larg, alt);
      if (i === imgs.length - 1) y += alt + 6;
    });
    doc.autoTable({
      startY: y, head: [["Unidade", "Tipo", "Atend.", "Menor compl.", "% otim.", "Economia pot."]],
      body: unidades.map((u) => [u.nome, ROTULO_TIPO_CURTO[u.tipo], fmtNum(u.total), fmtNum(u.menor), u.pct === null ? "n/a" : fmtPct(u.pct), fmtMoeda(u.economia)]),
      theme: "striped", headStyles: { fillColor: [27, 122, 92] }, styles: { fontSize: 8.5 },
    });
    const pags = doc.getNumberOfPages();
    for (let p = 1; p <= pags; p++) {
      doc.setPage(p);
      doc.setFontSize(7.5); doc.setTextColor(122, 138, 131);
      doc.text("Economia potencial = estimativa com custos médios configurados; não representa economia comprovada. Documento sem dados identificáveis de pacientes.", 14, 290);
      doc.text(`Gerado em ${fmtDataHora(new Date())} por ${ctx.perfil.nome} · página ${p}/${pags}`, W - 14, 286, { align: "right" });
    }
    doc.save(`${nome}.pdf`);
  }

  f.requestSubmit();
}
