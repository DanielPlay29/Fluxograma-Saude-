// =====================================================================
// Cálculo dos indicadores de gestão (módulo puro, testado em tests/).
//
// Definições (também exibidas na interface):
//  * Redirecionado: destino escolhido ≠ tipo da unidade onde o paciente chegou.
//  * Menor complexidade: redirecionado para unidade de complexidade MENOR
//    que a de chegada (ex.: chegou na UPA, foi para a UBS).
//  * Otimização (%): entre os pacientes que chegaram em UPA/Hospital, quantos
//    foram direcionados para um nível de menor complexidade.
//  * Concordância com o protocolo (%): destino escolhido = destino recomendado.
//  * Direcionados corretamente (%): entre os desfechos conhecidos, quantos
//    foram atendidos no destino (não precisaram ser reencaminhados).
//  * Economia POTENCIAL ESTIMADA: soma de (custo configurado da unidade de
//    chegada − custo configurado do destino) nos casos de menor complexidade,
//    exceto quando o desfecho mostrou que o encaminhamento foi inadequado.
//    É uma estimativa — NUNCA é apresentada como economia comprovada.
//  * Economia COMPROVADA: somente valores cadastrados com fonte documental.
// =====================================================================
import { COMPLEXIDADE } from "./triagem.js";

export const TIPOS = ["UBS", "UPA", "HOSPITAL", "EMERGENCIA"];

export function custoDe(tipo, config) {
  const mapa = {
    UBS: config?.custo_ubs,
    UPA: config?.custo_upa,
    HOSPITAL: config?.custo_hospital,
    EMERGENCIA: config?.custo_emergencia,
  };
  const v = mapa[tipo];
  return v === null || v === undefined || v === "" ? null : Number(v);
}

export function custosFaltando(config) {
  return TIPOS.filter((t) => custoDe(t, config) === null);
}

/** Intervalo [inicio, fim) para o período escolhido, no horário local. */
export function intervaloDoPeriodo(tipo, referencia = new Date()) {
  const r = new Date(referencia);
  let inicio, fim;
  if (tipo === "dia") {
    inicio = new Date(r.getFullYear(), r.getMonth(), r.getDate());
    fim = new Date(inicio); fim.setDate(fim.getDate() + 1);
  } else if (tipo === "semana") {
    const dow = (r.getDay() + 6) % 7; // segunda = 0
    inicio = new Date(r.getFullYear(), r.getMonth(), r.getDate() - dow);
    fim = new Date(inicio); fim.setDate(fim.getDate() + 7);
  } else if (tipo === "ano") {
    inicio = new Date(r.getFullYear(), 0, 1);
    fim = new Date(r.getFullYear() + 1, 0, 1);
  } else {
    inicio = new Date(r.getFullYear(), r.getMonth(), 1);
    fim = new Date(r.getFullYear(), r.getMonth() + 1, 1);
  }
  return { inicio, fim };
}

const pad = (n) => String(n).padStart(2, "0");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Gera os "baldes" da série temporal conforme o período. */
export function baldes(tipo, inicio, fim) {
  const lista = [];
  const d = new Date(inicio);
  while (d < fim) {
    if (tipo === "dia") {
      lista.push({ chave: `${pad(d.getHours())}h`, rotulo: `${pad(d.getHours())}h` });
      d.setHours(d.getHours() + 1);
    } else if (tipo === "ano") {
      lista.push({ chave: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, rotulo: `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` });
      d.setMonth(d.getMonth() + 1);
    } else {
      lista.push({ chave: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, rotulo: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` });
      d.setDate(d.getDate() + 1);
    }
  }
  return lista;
}

export function chaveDoBalde(tipo, data) {
  const d = new Date(data);
  if (tipo === "dia") return `${pad(d.getHours())}h`;
  if (tipo === "ano") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function chaveMes(data) {
  const d = new Date(data);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function rotuloMes(chave) {
  const [a, m] = chave.split("-").map(Number);
  return `${MESES[m - 1]}/${String(a).slice(2)}`;
}

/** Economia estimada de UM atendimento (0 quando não se aplica; null quando falta custo). */
export function economiaDoAtendimento(a, config) {
  const o = a.origem_tipo, d = a.destino_escolhido;
  if (!o || !d || !(COMPLEXIDADE[d] < COMPLEXIDADE[o])) return 0;
  if (a.resultado === "reencaminhado") return 0;
  const co = custoDe(o, config), cd = custoDe(d, config);
  if (co === null || cd === null) return null;
  return Math.max(0, co - cd);
}

/**
 * @param {Array} atendimentos [{created_at, origem_tipo, origem_nome, destino_escolhido,
 *                              destino_recomendado, resultado, tipo_atendimento}]
 * @param {object} config      linha de configuracoes
 * @param {object} opcoes      {granularidade, inicio, fim, custoOperacionalMeses}
 */
export function calcularIndicadores(atendimentos, config, opcoes = {}) {
  const lista = atendimentos ?? [];
  const r = {
    total: lista.length,
    redirecionados: 0,
    porDestino: Object.fromEntries(TIPOS.map((t) => [t, 0])),
    porOrigemTipo: Object.fromEntries(TIPOS.map((t) => [t, 0])),
    porUnidade: {},
    menorComplexidade: 0,
    chegadasAltaComplexidade: 0,
    otimizacaoPct: null,
    concordancia: { base: 0, concordantes: 0, pct: null },
    desfecho: { conhecidos: 0, adequados: 0, pct: null, pendentes: 0 },
    economia: { potencial: 0, comDesfechoConfirmado: 0, casosSemCusto: 0, casos: 0 },
    serie: [],
    porMes: [],
  };

  const gran = opcoes.granularidade ?? "mes";
  const serieMapa = new Map();
  if (opcoes.inicio && opcoes.fim) {
    for (const b of baldes(gran, opcoes.inicio, opcoes.fim)) {
      serieMapa.set(b.chave, { ...b, total: 0, chegadasAlta: 0, menorComplexidade: 0, potencial: 0, adequados: 0, conhecidos: 0 });
    }
  }
  const mesMapa = new Map();

  for (const a of lista) {
    if (r.porDestino[a.destino_escolhido] !== undefined) r.porDestino[a.destino_escolhido]++;
    if (r.porOrigemTipo[a.origem_tipo] !== undefined) r.porOrigemTipo[a.origem_tipo]++;
    const nome = a.origem_nome ?? "—";
    r.porUnidade[nome] = (r.porUnidade[nome] ?? 0) + 1;

    if (a.destino_escolhido !== a.origem_tipo) r.redirecionados++;
    const alta = COMPLEXIDADE[a.origem_tipo] > 1;
    const menor = COMPLEXIDADE[a.destino_escolhido] < COMPLEXIDADE[a.origem_tipo];
    if (alta) r.chegadasAltaComplexidade++;
    if (menor) r.menorComplexidade++;

    if (a.destino_recomendado) {
      r.concordancia.base++;
      if (a.destino_recomendado === a.destino_escolhido) r.concordancia.concordantes++;
    }

    const conhecido = ["atendido_no_destino", "reencaminhado"].includes(a.resultado);
    const adequado = a.resultado === "atendido_no_destino";
    if (conhecido) r.desfecho.conhecidos++;
    if (adequado) r.desfecho.adequados++;
    if (a.resultado === "pendente") r.desfecho.pendentes++;

    const eco = economiaDoAtendimento(a, config);
    if (eco === null) r.economia.casosSemCusto++;
    else if (eco > 0) {
      r.economia.potencial += eco;
      r.economia.casos++;
      if (adequado) r.economia.comDesfechoConfirmado += eco;
    }

    const k = chaveDoBalde(gran, a.created_at);
    if (!serieMapa.has(k)) serieMapa.set(k, { chave: k, rotulo: k, total: 0, chegadasAlta: 0, menorComplexidade: 0, potencial: 0, adequados: 0, conhecidos: 0 });
    const b = serieMapa.get(k);
    b.total++;
    if (alta) b.chegadasAlta++;
    if (menor) b.menorComplexidade++;
    if (eco > 0) b.potencial += eco;
    if (conhecido) b.conhecidos++;
    if (adequado) b.adequados++;

    const km = chaveMes(a.created_at);
    if (!mesMapa.has(km)) mesMapa.set(km, { chave: km, rotulo: rotuloMes(km), total: 0, potencial: 0, porDestino: Object.fromEntries(TIPOS.map((t) => [t, 0])) });
    const mm = mesMapa.get(km);
    mm.total++;
    if (eco > 0) mm.potencial += eco;
    if (mm.porDestino[a.destino_escolhido] !== undefined) mm.porDestino[a.destino_escolhido]++;
  }

  const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);
  r.otimizacaoPct = pct(r.menorComplexidade, r.chegadasAltaComplexidade);
  r.concordancia.pct = pct(r.concordancia.concordantes, r.concordancia.base);
  r.desfecho.pct = pct(r.desfecho.adequados, r.desfecho.conhecidos);

  r.serie = [...serieMapa.values()]
    .sort((x, y) => (x.chave < y.chave ? -1 : 1))
    .map((b) => ({ ...b, otimizacaoPct: pct(b.menorComplexidade, b.chegadasAlta), corretosPct: pct(b.adequados, b.conhecidos) }));

  let acumulado = 0;
  r.porMes = [...mesMapa.values()]
    .sort((x, y) => (x.chave < y.chave ? -1 : 1))
    .map((m) => ({ ...m, acumulado: (acumulado += m.potencial) }));

  const custoOp = Number(config?.custo_operacional_mensal ?? 0) * (opcoes.custoOperacionalMeses ?? 0);
  r.economia.custoOperacional = custoOp;
  r.economia.liquidaPotencial = r.economia.potencial - custoOp;
  r.economia.custosFaltando = custosFaltando(config);
  return r;
}

/** Quantidade de meses (fração) cobertos pelo intervalo, para custo operacional. */
export function mesesNoIntervalo(inicio, fim) {
  const dias = (fim - inicio) / 86_400_000;
  return Math.round((dias / 30.4375) * 100) / 100;
}

/**
 * Fluxo antes × depois: média mensal por tipo de unidade.
 * Antes = linha de base informada (registros oficiais anteriores à implantação).
 * Depois = destinos escolhidos nos atendimentos registrados na plataforma.
 */
export function antesDepois(linhaBase, porMes) {
  const mesesAntes = new Set((linhaBase ?? []).map((l) => String(l.competencia).slice(0, 7)));
  const somaAntes = Object.fromEntries(TIPOS.map((t) => [t, 0]));
  for (const l of linhaBase ?? []) somaAntes[l.tipo_unidade] += Number(l.atendimentos);
  const somaDepois = Object.fromEntries(TIPOS.map((t) => [t, 0]));
  for (const m of porMes ?? []) for (const t of TIPOS) somaDepois[t] += m.porDestino[t];
  const nA = mesesAntes.size, nD = (porMes ?? []).length;
  return {
    temBase: nA > 0,
    temDepois: nD > 0,
    mesesAntes: nA,
    mesesDepois: nD,
    tipos: TIPOS,
    antes: TIPOS.map((t) => (nA ? Math.round(somaAntes[t] / nA) : 0)),
    depois: TIPOS.map((t) => (nD ? Math.round(somaDepois[t] / nD) : 0)),
  };
}
