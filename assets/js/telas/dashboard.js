import { criarFiltros } from "../ui/filtros.js";
import { carregarPainel } from "../servicos/painel.js";
import { icone } from "../ui/icones.js";
import { esc, fmtNum, fmtPct, fmtMoeda, aviso, carregando, vazio, ROTULO_TIPO_CURTO } from "../ui/comum.js";
import { grafico, destruirGraficos, CORES, eixos } from "../ui/graficos.js";
import { TIPOS } from "../core/indicadores.js";

export const subtitulo = "Indicadores gerais da rede e resultados da plataforma";

export function kpi({ rotulo, valor, nota = "", ic = "pulso", cor = "", destaque = false, notaClasse = "", titulo = "" }) {
  return `<div class="card kpi ${destaque ? "destaque" : ""}" ${titulo ? `title="${esc(titulo)}"` : ""}>
    <div class="kpi-topo"><span class="kpi-rotulo">${esc(rotulo)}</span><span class="kpi-icone ${cor}">${icone(ic)}</span></div>
    <div class="kpi-valor">${valor}</div>
    ${nota ? `<div class="kpi-nota ${notaClasse}">${nota}</div>` : ""}
  </div>`;
}

export function avisosDeDados(d) {
  let h = "";
  if (d.ind.economia.custosFaltando.length) {
    h += aviso("atencao", "Custos não configurados",
      `<p>Sem custo estimado para: ${d.ind.economia.custosFaltando.map((t) => ROTULO_TIPO_CURTO[t]).join(", ")}.
       Encaminhamentos que envolvem essas unidades não entram no cálculo de economia. Configure em <a href="#/configuracoes">Configurações</a>.</p>`);
  }
  if (d.limiteAtingido) h += aviso("atencao", "Período muito grande", "<p>Foram considerados os 5.000 atendimentos mais recentes. Reduza o período para resultados completos.</p>");
  return h;
}

export async function render(el, ctx) {
  el.innerHTML = `<div id="f"></div><div id="painel">${carregando()}</div>`;
  const painel = el.querySelector("#painel");

  criarFiltros(el.querySelector("#f"), {
    unidades: ctx.unidades,
    aoMudar: async (filtros) => {
      destruirGraficos();
      painel.innerHTML = carregando();
      let d;
      try {
        d = await carregarPainel(filtros);
      } catch (e) {
        painel.innerHTML = aviso("erro", e.message);
        return;
      }
      if (!ctx.ativo()) return;
      desenhar(painel, d, filtros);
    },
  });
}

function desenhar(painel, d, filtros) {
  const { ind } = d;
  const outros = ind.porDestino.EMERGENCIA;
  painel.innerHTML = `
    ${avisosDeDados(d)}
    <div class="grade grade-kpi">
      ${kpi({ rotulo: "Pacientes atendidos", valor: fmtNum(ind.total), nota: esc(d.descricao), ic: "paciente" })}
      ${kpi({ rotulo: "Pacientes redirecionados", valor: fmtNum(ind.redirecionados), nota: `${fmtPct(ind.total ? (ind.redirecionados / ind.total) * 100 : null)} do total`, ic: "setas", cor: "azul" })}
      ${kpi({ rotulo: "Poderiam ser atendidos em menor complexidade", valor: fmtNum(ind.menorComplexidade), nota: "Direcionados para unidade de menor complexidade", ic: "alvo", cor: "positivo" })}
      ${kpi({ rotulo: "Otimização dos encaminhamentos", valor: fmtPct(ind.otimizacaoPct), nota: `Das ${fmtNum(ind.chegadasAltaComplexidade)} chegadas em UPA/hospital`, ic: "otimizacao", cor: "positivo", titulo: "Percentual dos pacientes que chegaram em UPA ou hospital e foram direcionados a um nível de menor complexidade" })}
      ${kpi({ rotulo: "Encaminhamentos para UBS", valor: fmtNum(ind.porDestino.UBS), ic: "UBS" })}
      ${kpi({ rotulo: "Encaminhamentos para UPA", valor: fmtNum(ind.porDestino.UPA), ic: "UPA", cor: "azul" })}
      ${kpi({ rotulo: "Encaminhamentos para hospitais", valor: fmtNum(ind.porDestino.HOSPITAL), nota: outros ? `+ ${fmtNum(outros)} para serviço de emergência` : "", ic: "HOSPITAL" })}
      ${kpi({ rotulo: "Economia potencial estimada", valor: fmtMoeda(ind.economia.potencial), nota: "Estimativa com custos configurados — não é economia comprovada", ic: "economia", destaque: true })}
    </div>

    <div class="grade grade-2">
      <div class="card"><div class="card-cab"><div><h3>Pacientes por unidade de saúde</h3><p>Unidade onde o paciente foi atendido inicialmente</p></div></div>
        ${ind.total ? '<div class="grafico"><canvas id="g-unidades"></canvas></div>' : vazio("Sem atendimentos no período")}</div>
      <div class="card"><div class="card-cab"><div><h3>Distribuição dos encaminhamentos</h3><p>Destino escolhido pelo profissional</p></div></div>
        ${ind.total ? '<div class="grafico"><canvas id="g-destinos"></canvas></div>' : vazio("Sem atendimentos no período")}</div>
      <div class="card"><div class="card-cab"><div><h3>Fluxo antes × depois da implantação</h3><p>Média mensal de atendimentos por tipo de unidade</p></div></div>
        <div id="antes-depois"></div></div>
      <div class="card"><div class="card-cab"><div><h3>Economia potencial acumulada por mês</h3><p>Estimativa a partir dos custos configurados</p></div></div>
        ${ind.porMes.length ? '<div class="grafico"><canvas id="g-economia"></canvas></div>' : vazio("Sem dados no período")}</div>
      <div class="card"><div class="card-cab"><div><h3>Pacientes direcionados corretamente</h3><p>Entre os desfechos registrados: atendidos no destino sem precisar de reencaminhamento</p></div>
        <span class="tag tag-ok">${fmtPct(ind.desfecho.pct)}</span></div>
        ${ind.desfecho.conhecidos ? '<div class="grafico"><canvas id="g-corretos"></canvas></div>' : vazio("Nenhum desfecho registrado ainda", "Registre o resultado dos atendimentos no Histórico.")}</div>
      <div class="card"><div class="card-cab"><div><h3>Evolução da otimização</h3><p>% de chegadas em UPA/hospital direcionadas a menor complexidade</p></div></div>
        ${ind.chegadasAltaComplexidade ? '<div class="grafico"><canvas id="g-otimizacao"></canvas></div>' : vazio("Sem chegadas em UPA/hospital no período")}</div>
    </div>`;

  if (ind.total) {
    const unid = Object.entries(ind.porUnidade).sort((a, b) => b[1] - a[1]);
    grafico(painel.querySelector("#g-unidades"), {
      type: "bar",
      data: { labels: unid.map((u) => u[0]), datasets: [{ label: "Pacientes", data: unid.map((u) => u[1]), backgroundColor: CORES.UBS, borderRadius: 6, maxBarThickness: 34 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: CORES.grade } }, y: { grid: { display: false } } } },
    });
    const comDados = TIPOS.filter((t) => ind.porDestino[t] > 0);
    grafico(painel.querySelector("#g-destinos"), {
      type: "doughnut",
      data: { labels: comDados.map((t) => ROTULO_TIPO_CURTO[t]), datasets: [{ data: comDados.map((t) => ind.porDestino[t]), backgroundColor: comDados.map((t) => CORES[t]), borderWidth: 2, borderColor: "#fff" }] },
      options: { cutout: "62%", plugins: { legend: { position: "right" } } },
    });
  }

  const ad = painel.querySelector("#antes-depois");
  if (!d.antesDepois.temBase) {
    ad.innerHTML = vazio("Linha de base não cadastrada", 'Informe os atendimentos mensais anteriores à implantação (fonte oficial) em <a href="#/configuracoes">Configurações → Linha de base</a>.', "calendario");
  } else if (!["mes", "ano"].includes(filtros.periodo)) {
    ad.innerHTML = vazio("Comparação em médias mensais", "Selecione o período Mês ou Ano para comparar.", "calendario");
  } else {
    ad.innerHTML = '<div class="grafico"><canvas id="g-antes"></canvas></div>';
    grafico(ad.querySelector("#g-antes"), {
      type: "bar",
      data: {
        labels: TIPOS.map((t) => ROTULO_TIPO_CURTO[t]),
        datasets: [
          { label: `Antes (média de ${d.antesDepois.mesesAntes} meses)`, data: d.antesDepois.antes, backgroundColor: CORES.neutro, borderRadius: 6, maxBarThickness: 30 },
          { label: "Depois (período selecionado)", data: d.antesDepois.depois, backgroundColor: CORES.UBS, borderRadius: 6, maxBarThickness: 30 },
        ],
      },
      options: { scales: eixos(), plugins: { legend: { position: "bottom" } } },
    });
  }

  if (ind.porMes.length) {
    grafico(painel.querySelector("#g-economia"), {
      type: "line",
      data: {
        labels: ind.porMes.map((m) => m.rotulo),
        datasets: [
          { label: "Acumulada", data: ind.porMes.map((m) => m.acumulado), borderColor: CORES.positivo, backgroundColor: "rgba(47,182,122,.12)", fill: true, tension: 0.3, pointRadius: 3 },
          { label: "No mês", data: ind.porMes.map((m) => m.potencial), borderColor: CORES.primaria, borderDash: [5, 4], tension: 0.3, pointRadius: 2 },
        ],
      },
      options: { scales: eixos((v) => fmtMoeda(v)), plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoeda(c.parsed.y)}` } } } },
    });
  }

  const linhaPct = (id, campo, cor, rotulo) => grafico(painel.querySelector(id), {
    type: "line",
    data: { labels: ind.serie.map((s) => s.rotulo), datasets: [{ label: rotulo, data: ind.serie.map((s) => (s[campo] === null ? null : Math.round(s[campo] * 10) / 10)), borderColor: cor, backgroundColor: cor, spanGaps: true, tension: 0.3, pointRadius: 2.5 }] },
    options: { scales: { ...eixos((v) => `${v}%`), y: { ...eixos().y, max: 100, ticks: { callback: (v) => `${v}%` } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtPct(c.parsed.y) } } } },
  });
  if (ind.desfecho.conhecidos) linhaPct("#g-corretos", "corretosPct", CORES.positivo, "Direcionados corretamente");
  if (ind.chegadasAltaComplexidade) linhaPct("#g-otimizacao", "otimizacaoPct", CORES.azul, "Otimização");
}
