import { criarFiltros } from "../ui/filtros.js";
import { carregarPainel } from "../servicos/painel.js";
import { kpi, avisosDeDados } from "./dashboard.js";
import { COMPLEXIDADE } from "../core/triagem.js";
import { TIPOS } from "../core/indicadores.js";
import { esc, aviso, carregando, vazio, fmtNum, fmtPct, ROTULO_TIPO_CURTO } from "../ui/comum.js";
import { grafico, destruirGraficos, CORES, eixos } from "../ui/graficos.js";

export const subtitulo = "Quanto a rede está direcionando cada paciente ao nível de atenção adequado";

export async function render(el, ctx) {
  el.innerHTML = `<div id="f"></div><div id="painel">${carregando()}</div>`;
  const painel = el.querySelector("#painel");
  criarFiltros(el.querySelector("#f"), {
    unidades: ctx.unidades,
    aoMudar: async (filtros) => {
      destruirGraficos();
      painel.innerHTML = carregando();
      try {
        const d = await carregarPainel(filtros);
        if (ctx.ativo()) desenhar(painel, d, filtros);
      } catch (e) {
        painel.innerHTML = aviso("erro", e.message);
      }
    },
  });
}

function desenhar(painel, d, filtros) {
  const { ind, atendimentos } = d;
  const origens = TIPOS.filter((t) => t !== "EMERGENCIA");
  const matriz = origens.map((o) => TIPOS.map((t) => atendimentos.filter((a) => a.origem_tipo === o && a.destino_escolhido === t).length));
  const maxM = Math.max(1, ...matriz.flat());

  const porUnidade = {};
  for (const a of atendimentos) {
    const u = (porUnidade[a.origem_nome] ??= { tipo: a.origem_tipo, total: 0, menor: 0, divergentes: 0 });
    u.total++;
    if (COMPLEXIDADE[a.destino_escolhido] < COMPLEXIDADE[a.origem_tipo]) u.menor++;
    if (a.destino_recomendado && a.destino_recomendado !== a.destino_escolhido) u.divergentes++;
  }
  const divergentes = atendimentos.filter((a) => a.destino_recomendado && a.destino_recomendado !== a.destino_escolhido).length;

  painel.innerHTML = `
    ${avisosDeDados(d)}
    <div class="grade grade-kpi">
      ${kpi({ rotulo: "Otimização dos encaminhamentos", valor: fmtPct(ind.otimizacaoPct), nota: `${fmtNum(ind.menorComplexidade)} de ${fmtNum(ind.chegadasAltaComplexidade)} chegadas em UPA/hospital`, ic: "otimizacao", destaque: true })}
      ${kpi({ rotulo: "Concordância com o protocolo", valor: fmtPct(ind.concordancia.pct), nota: `${fmtNum(divergentes)} decisão(ões) divergente(s), todas justificadas`, ic: "regras", cor: "azul" })}
      ${kpi({ rotulo: "Direcionados corretamente", valor: fmtPct(ind.desfecho.pct), nota: `${fmtNum(ind.desfecho.conhecidos)} desfechos registrados · ${fmtNum(ind.desfecho.pendentes)} pendentes`, ic: "ok", cor: "positivo" })}
      ${kpi({ rotulo: "Poderiam ser atendidos em menor complexidade", valor: fmtNum(ind.menorComplexidade), nota: esc(d.descricao), ic: "alvo", cor: "positivo" })}
    </div>
    <div class="grade grade-2">
      <div class="card span-2"><div class="card-cab"><div><h3>Evolução da otimização ao longo do tempo</h3><p>Otimização (%) e pacientes direcionados corretamente (%)</p></div></div>
        ${ind.total ? '<div class="grafico alto"><canvas id="g-evolucao"></canvas></div>' : vazio("Sem atendimentos no período")}</div>
      <div class="card"><div class="card-cab"><div><h3>Origem × destino</h3><p>Linha: onde o paciente chegou · Coluna: para onde foi direcionado</p></div></div>
        ${ind.total ? `<div class="tabela-wrap" style="margin-bottom:-20px"><table class="tabela"><thead><tr><th>Chegou em</th>${TIPOS.map((t) => `<th class="num">${esc(ROTULO_TIPO_CURTO[t])}</th>`).join("")}</tr></thead>
          <tbody>${origens.map((o, i) => `<tr><td><strong>${esc(ROTULO_TIPO_CURTO[o])}</strong></td>${matriz[i].map((n, j) => {
            const menor = COMPLEXIDADE[TIPOS[j]] < COMPLEXIDADE[o];
            const alfa = n ? 0.1 + 0.5 * (n / maxM) : 0;
            return `<td class="num" style="background:${n ? (menor ? `rgba(47,182,122,${alfa})` : `rgba(58,127,193,${alfa * 0.6})`) : "transparent"}">${n ? fmtNum(n) : "·"}</td>`;
          }).join("")}</tr>`).join("")}</tbody></table></div>
          <p class="kpi-nota" style="margin-top:28px">Verde: direcionado a menor complexidade (otimização).</p>` : vazio("Sem atendimentos no período")}</div>
      <div class="card"><div class="card-cab"><div><h3>Fluxo antes × depois</h3><p>Média mensal por tipo de unidade</p></div></div><div id="antes-depois"></div></div>
      <div class="card span-2"><div class="card-cab"><div><h3>Desempenho por unidade de origem</h3><p>Onde há mais oportunidade de direcionamento adequado</p></div></div>
        ${Object.keys(porUnidade).length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Unidade</th><th>Tipo</th><th class="num">Atendimentos</th><th class="num">Para menor complexidade</th><th class="num">% otimização</th><th class="num">Divergências do protocolo</th></tr></thead>
          <tbody>${Object.entries(porUnidade).sort((a, b) => b[1].total - a[1].total).map(([nome, u]) => `<tr><td>${esc(nome)}</td><td>${esc(ROTULO_TIPO_CURTO[u.tipo])}</td><td class="num">${fmtNum(u.total)}</td><td class="num">${fmtNum(u.menor)}</td>
            <td class="num">${COMPLEXIDADE[u.tipo] > 1 ? fmtPct((u.menor / u.total) * 100) : '<span title="UBS já é o nível de menor complexidade">n/a</span>'}</td><td class="num">${fmtNum(u.divergentes)}</td></tr>`).join("")}</tbody></table></div>` : vazio("Sem atendimentos no período")}</div>
    </div>`;

  if (ind.total) {
    grafico(painel.querySelector("#g-evolucao"), {
      type: "line",
      data: {
        labels: ind.serie.map((s) => s.rotulo),
        datasets: [
          { label: "Otimização (%)", data: ind.serie.map((s) => s.otimizacaoPct), borderColor: CORES.azul, backgroundColor: CORES.azul, spanGaps: true, tension: 0.3, pointRadius: 2.5 },
          { label: "Direcionados corretamente (%)", data: ind.serie.map((s) => s.corretosPct), borderColor: CORES.positivo, backgroundColor: CORES.positivo, spanGaps: true, tension: 0.3, pointRadius: 2.5 },
          { label: "Atendimentos", data: ind.serie.map((s) => s.total), type: "bar", yAxisID: "y2", backgroundColor: "rgba(168,181,175,.35)", borderRadius: 4, order: 3 },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: {
          x: eixos().x,
          y: { ...eixos().y, max: 100, ticks: { callback: (v) => `${v}%` } },
          y2: { position: "right", beginAtZero: true, grid: { display: false }, ticks: { precision: 0 } },
        },
        plugins: { legend: { position: "bottom" } },
      },
    });
  }

  const ad = painel.querySelector("#antes-depois");
  if (!d.antesDepois.temBase) ad.innerHTML = vazio("Linha de base não cadastrada", 'Cadastre em <a href="#/configuracoes">Configurações → Linha de base</a>.', "calendario");
  else if (!["mes", "ano"].includes(filtros.periodo)) ad.innerHTML = vazio("Comparação em médias mensais", "Selecione o período Mês ou Ano.", "calendario");
  else {
    ad.innerHTML = '<div class="grafico"><canvas id="g-ad"></canvas></div>';
    grafico(ad.querySelector("#g-ad"), {
      type: "bar",
      data: { labels: TIPOS.map((t) => ROTULO_TIPO_CURTO[t]), datasets: [
        { label: "Antes", data: d.antesDepois.antes, backgroundColor: CORES.neutro, borderRadius: 6, maxBarThickness: 30 },
        { label: "Depois", data: d.antesDepois.depois, backgroundColor: CORES.UBS, borderRadius: 6, maxBarThickness: 30 },
      ] },
      options: { scales: eixos(), plugins: { legend: { position: "bottom" } } },
    });
  }
}
