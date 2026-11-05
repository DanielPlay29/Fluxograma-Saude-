// Carrega e calcula tudo o que as telas de gestão precisam para um período.
import { listarAtendimentos, obterConfig, listarLinhaBase, listarEconomiaComprovada } from "./dados.js";
import { calcularIndicadores, intervaloDoPeriodo, mesesNoIntervalo, antesDepois } from "../core/indicadores.js";
import { dataDeTexto } from "../ui/filtros.js";

export const ROTULO_PERIODO = { dia: "dia", semana: "semana", mes: "mês", ano: "ano" };

export function descreverPeriodo(periodo, inicio, fim) {
  const f = (d) => d.toLocaleDateString("pt-BR");
  const ultimo = new Date(fim.getTime() - 1);
  if (periodo === "dia") return f(inicio);
  if (periodo === "mes") return inicio.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  if (periodo === "ano") return String(inicio.getFullYear());
  return `${f(inicio)} a ${f(ultimo)}`;
}

export async function carregarPainel(filtros, { comGestao = true } = {}) {
  const { inicio, fim } = intervaloDoPeriodo(filtros.periodo, dataDeTexto(filtros.referencia));
  const [atendimentos, config, linhaBase, comprovada] = await Promise.all([
    listarAtendimentos({ inicio, fim, unidadeId: filtros.unidadeId || null, tipoAtendimento: filtros.tipoAtendimento || null, canal: filtros.canal || null }),
    obterConfig(),
    comGestao ? listarLinhaBase() : Promise.resolve([]),
    comGestao ? listarEconomiaComprovada({ inicio, fim }) : Promise.resolve([]),
  ]);
  const ind = calcularIndicadores(atendimentos, config, {
    granularidade: filtros.periodo,
    inicio,
    fim,
    custoOperacionalMeses: mesesNoIntervalo(inicio, fim),
  });
  return {
    atendimentos,
    config,
    linhaBase,
    comprovada,
    comprovadaTotal: comprovada.reduce((s, c) => s + Number(c.valor), 0),
    inicio,
    fim,
    descricao: descreverPeriodo(filtros.periodo, inicio, fim),
    ind,
    antesDepois: antesDepois(linhaBase, ind.porMes),
    limiteAtingido: atendimentos.length >= 5000,
  };
}
