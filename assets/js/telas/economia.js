import { criarFiltros } from "../ui/filtros.js";
import { carregarPainel } from "../servicos/painel.js";
import { kpi, avisosDeDados } from "./dashboard.js";
import { economiaDoAtendimento, custoDe, TIPOS } from "../core/indicadores.js";
import { salvarEconomiaComprovada, excluirEconomiaComprovada, dataLocal } from "../servicos/dados.js";
import { icone } from "../ui/icones.js";
import { esc, $, aviso, carregando, vazio, modal, toast, confirmar, fmtNum, fmtMoeda, fmtCompetencia, ROTULO_TIPO_CURTO } from "../ui/comum.js";
import { grafico, destruirGraficos, CORES, eixos } from "../ui/graficos.js";

export const subtitulo = "Economia potencial estimada × economia comprovada";

export async function render(el, ctx) {
  el.innerHTML = `<div id="f"></div><div id="painel">${carregando()}</div>`;
  const painel = el.querySelector("#painel");
  let ultimo;
  const carregar = async (filtros) => {
    ultimo = filtros;
    destruirGraficos();
    painel.innerHTML = carregando();
    try {
      const d = await carregarPainel(filtros);
      if (ctx.ativo()) desenhar(painel, d, ctx, () => carregar(ultimo));
    } catch (e) {
      painel.innerHTML = aviso("erro", e.message);
    }
  };
  criarFiltros(el.querySelector("#f"), { unidades: ctx.unidades, aoMudar: carregar });
}

function desenhar(painel, d, ctx, recarregar) {
  const { ind, config, atendimentos } = d;
  const ehAdmin = ctx.perfil.papel === "admin";
  const pares = {};
  for (const a of atendimentos) {
    const v = economiaDoAtendimento(a, config);
    if (!v) continue;
    const k = `${a.origem_tipo}→${a.destino_escolhido}`;
    (pares[k] ??= { origem: a.origem_tipo, destino: a.destino_escolhido, casos: 0, total: 0, confirmados: 0 });
    pares[k].casos++;
    pares[k].total += v;
    if (a.resultado === "atendido_no_destino") pares[k].confirmados += v;
  }

  painel.innerHTML = `
    ${avisosDeDados(d)}
    ${aviso("info", "Como ler estes valores", `<p><strong>Economia potencial estimada</strong> é calculada com custos médios configurados pela administração (não são custos oficiais do SUS) para pacientes que chegaram numa unidade de maior complexidade e foram direcionados para uma de menor complexidade. <strong>Economia comprovada</strong> só inclui valores cadastrados com fonte documental (ex.: relatório financeiro da Secretaria).</p>`)}
    <div class="grade grade-kpi">
      ${kpi({ rotulo: "Economia potencial estimada", valor: fmtMoeda(ind.economia.potencial), nota: `${fmtNum(ind.economia.casos)} encaminhamento(s) a menor complexidade`, ic: "economia", destaque: true })}
      ${kpi({ rotulo: "Estimada com desfecho confirmado", valor: fmtMoeda(ind.economia.comDesfechoConfirmado), nota: "Pacientes efetivamente atendidos no destino — ainda é estimativa", ic: "ok", cor: "positivo" })}
      ${kpi({ rotulo: "Economia comprovada", valor: d.comprovada.length ? fmtMoeda(d.comprovadaTotal) : "—", nota: d.comprovada.length ? `${d.comprovada.length} registro(s) com fonte` : "Sem dados comprovados no período", ic: "documento", cor: "azul" })}
      ${kpi({ rotulo: "Saldo potencial líquido", valor: fmtMoeda(ind.economia.liquidaPotencial), nota: `Descontado o custo operacional da plataforma (${fmtMoeda(ind.economia.custoOperacional)})`, ic: "otimizacao", notaClasse: ind.economia.liquidaPotencial >= 0 ? "positivo" : "" })}
    </div>
    <div class="grade grade-2">
      <div class="card span-2"><div class="card-cab"><div><h3>Economia potencial acumulada por mês</h3><p>Barras: estimativa do mês · Linha: acumulado</p></div></div>
        ${ind.porMes.length ? '<div class="grafico"><canvas id="g-mes"></canvas></div>' : vazio("Sem atendimentos no período")}</div>
      <div class="card"><div class="card-cab"><div><h3>Custos estimados configurados</h3><p>Valor médio por atendimento</p></div>${ehAdmin ? '<a class="btn btn-secundario btn-sm" href="#/configuracoes">Editar</a>' : ""}</div>
        <div class="tabela-wrap"><table class="tabela"><tbody>${TIPOS.map((t) => `<tr><td>${esc(ROTULO_TIPO_CURTO[t])}</td><td class="num">${custoDe(t, config) === null ? '<span class="tag tag-atencao">Não configurado</span>' : fmtMoeda(custoDe(t, config))}</td></tr>`).join("")}
          <tr><td>Custo operacional mensal da plataforma</td><td class="num">${fmtMoeda(config.custo_operacional_mensal ?? 0)}</td></tr></tbody></table></div></div>
      <div class="card"><div class="card-cab"><div><h3>Origem da economia potencial</h3><p>Por tipo de redirecionamento</p></div></div>
        ${Object.keys(pares).length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Redirecionamento</th><th class="num">Casos</th><th class="num">Por caso</th><th class="num">Total</th></tr></thead>
          <tbody>${Object.values(pares).sort((a, b) => b.total - a.total).map((p) => `<tr><td>${esc(ROTULO_TIPO_CURTO[p.origem])} → ${esc(ROTULO_TIPO_CURTO[p.destino])}</td><td class="num">${fmtNum(p.casos)}</td>
            <td class="num">${fmtMoeda(custoDe(p.origem, config) - custoDe(p.destino, config))}</td><td class="num"><strong>${fmtMoeda(p.total)}</strong></td></tr>`).join("")}</tbody></table></div>` : vazio("Nenhum redirecionamento com economia estimável")}</div>
      <div class="card span-2"><div class="card-cab"><div><h3>Economia comprovada</h3><p>Valores apurados com documentação (competência no período)</p></div>
        ${ehAdmin ? `<button class="btn btn-primario btn-sm" id="btn-add">${icone("mais")} Registrar economia comprovada</button>` : ""}</div>
        ${d.comprovada.length ? `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Competência</th><th>Descrição</th><th>Fonte</th><th class="num">Valor</th>${ehAdmin ? "<th></th>" : ""}</tr></thead>
          <tbody>${d.comprovada.map((c) => `<tr><td>${esc(fmtCompetencia(c.competencia))}</td><td>${esc(c.descricao)}</td><td>${esc(c.fonte)}</td><td class="num">${fmtMoeda(c.valor)}</td>
            ${ehAdmin ? `<td class="num"><button class="btn btn-fantasma btn-sm" data-excluir="${esc(c.id)}" aria-label="Excluir">${icone("lixeira")}</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`
          : vazio("Sem dados de economia comprovada", "A economia comprovada depende de apuração financeira oficial. Até lá, os valores acima são apenas estimativas.", "documento")}</div>
    </div>`;

  if (ind.porMes.length) {
    grafico(painel.querySelector("#g-mes"), {
      type: "bar",
      data: {
        labels: ind.porMes.map((m) => m.rotulo),
        datasets: [
          { label: "No mês", data: ind.porMes.map((m) => m.potencial), backgroundColor: CORES.UBS, borderRadius: 6, maxBarThickness: 36, order: 2 },
          { label: "Acumulado", data: ind.porMes.map((m) => m.acumulado), type: "line", borderColor: CORES.positivo, backgroundColor: CORES.positivo, tension: 0.3, pointRadius: 3, order: 1 },
        ],
      },
      options: { scales: eixos((v) => fmtMoeda(v)), plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoeda(c.parsed.y)}` } } } },
    });
  }

  if (!ehAdmin) return;
  painel.querySelector("#btn-add")?.addEventListener("click", () => {
    const corpo = `<div class="grade-form">
      <label class="campo"><span>Competência (mês) *</span><input class="entrada" type="month" name="competencia" value="${dataLocal(new Date()).slice(0, 7)}"></label>
      <label class="campo"><span>Valor (R$) *</span><input class="entrada" type="number" name="valor" min="0" step="0.01"></label></div>
      <label class="campo"><span>Descrição *</span><input class="entrada" name="descricao" maxlength="200" placeholder="Ex.: Redução de atendimentos de baixa complexidade na UPA"></label>
      <label class="campo"><span>Fonte / documento comprobatório *</span><input class="entrada" name="fonte" maxlength="200" placeholder="Ex.: Relatório de custos SMS nº 12/2026"></label>`;
    const m = modal({
      titulo: "Registrar economia comprovada", corpo,
      acoes: [{ rotulo: "Cancelar" }, {
        rotulo: "Salvar", classe: "btn-primario",
        aoClicar: async () => {
          const q = (n) => $(`[name=${n}]`, m.corpo).value.trim();
          if (!q("competencia") || !(Number(q("valor")) >= 0) || q("valor") === "" || q("descricao").length < 3 || q("fonte").length < 3) {
            toast("Preencha todos os campos obrigatórios.", "erro");
            return false;
          }
          await salvarEconomiaComprovada({ competencia: `${q("competencia")}-01`, valor: Number(q("valor")), descricao: q("descricao"), fonte: q("fonte"), created_by: ctx.perfil.id });
          toast("Registro salvo.");
          recarregar();
        },
      }],
    });
  });
  painel.querySelectorAll("[data-excluir]").forEach((b) => b.addEventListener("click", async () => {
    if (!(await confirmar("Excluir registro", "Excluir este registro de economia comprovada?", "Excluir", "btn-perigo"))) return;
    try { await excluirEconomiaComprovada(b.dataset.excluir); toast("Registro excluído."); recarregar(); } catch (e) { toast(e.message, "erro"); }
  }));
}
