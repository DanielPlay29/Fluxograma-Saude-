import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tempoDoAtendimento,
  calcularIndicadores, economiaDoAtendimento, intervaloDoPeriodo, antesDepois, mesesNoIntervalo, baldes,
} from "../assets/js/core/indicadores.js";

const config = { custo_ubs: 65, custo_upa: 180, custo_hospital: null, custo_emergencia: null, custo_operacional_mensal: 100 };

const a = (origem, destino, extra = {}) => ({
  created_at: "2026-10-10T10:00:00", origem_tipo: origem, origem_nome: `${origem} X`,
  destino_escolhido: destino, destino_recomendado: destino, resultado: "pendente", ...extra,
});

test("exemplo do projeto: 100 pacientes UPA → UBS = R$ 11.500,00 de economia potencial", () => {
  const lista = Array.from({ length: 100 }, () => a("UPA", "UBS"));
  const r = calcularIndicadores(lista, config);
  assert.equal(r.economia.potencial, 11500);
  assert.equal(r.menorComplexidade, 100);
  assert.equal(r.otimizacaoPct, 100);
});

test("economia comprovada pelo desfecho é separada da potencial", () => {
  const lista = [a("UPA", "UBS", { resultado: "atendido_no_destino" }), a("UPA", "UBS")];
  const r = calcularIndicadores(lista, config);
  assert.equal(r.economia.potencial, 230);
  assert.equal(r.economia.comDesfechoConfirmado, 115);
});

test("encaminhamento que precisou ser refeito não conta como economia", () => {
  assert.equal(economiaDoAtendimento(a("UPA", "UBS", { resultado: "reencaminhado" }), config), 0);
});

test("sem custo configurado não inventa valor", () => {
  const r = calcularIndicadores([a("HOSPITAL", "UBS")], config);
  assert.equal(r.economia.potencial, 0);
  assert.equal(r.economia.casosSemCusto, 1);
  assert.deepEqual(r.economia.custosFaltando, ["HOSPITAL", "EMERGENCIA"]);
});

test("encaminhar para MAIOR complexidade não gera economia e não conta como otimização", () => {
  const r = calcularIndicadores([a("UBS", "UPA"), a("UPA", "UPA")], config);
  assert.equal(r.redirecionados, 1);
  assert.equal(r.menorComplexidade, 0);
  assert.equal(r.economia.potencial, 0);
  assert.equal(r.otimizacaoPct, 0);
});

test("concordância e direcionamento correto", () => {
  const lista = [
    a("UPA", "UBS", { resultado: "atendido_no_destino" }),
    a("UPA", "UBS", { resultado: "reencaminhado" }),
    a("UBS", "UPA", { destino_recomendado: "UBS", justificativa: "piora" }),
  ];
  const r = calcularIndicadores(lista, config);
  assert.equal(r.concordancia.pct, (2 / 3) * 100);
  assert.equal(r.desfecho.pct, 50);
});

test("lista vazia não quebra e não mostra percentuais inventados", () => {
  const r = calcularIndicadores([], config);
  assert.equal(r.total, 0);
  assert.equal(r.otimizacaoPct, null);
  assert.equal(r.desfecho.pct, null);
});

test("custo operacional é descontado da economia potencial líquida", () => {
  const r = calcularIndicadores([a("UPA", "UBS")], config, { custoOperacionalMeses: 1 });
  assert.equal(r.economia.liquidaPotencial, 15);
});

test("períodos", () => {
  const ref = new Date(2026, 10, 5, 15); // qui 05/11/2026
  const s = intervaloDoPeriodo("semana", ref);
  assert.equal(s.inicio.getDay(), 1); // segunda
  assert.equal(s.inicio.getDate(), 2);
  const m = intervaloDoPeriodo("mes", ref);
  assert.equal(baldes("mes", m.inicio, m.fim).length, 30);
  const y = intervaloDoPeriodo("ano", ref);
  assert.equal(baldes("ano", y.inicio, y.fim).length, 12);
  assert.equal(baldes("dia", ...Object.values(intervaloDoPeriodo("dia", ref))).length, 24);
  assert.ok(Math.abs(mesesNoIntervalo(y.inicio, y.fim) - 12) < 0.05);
});

test("série temporal e acumulado mensal", () => {
  const lista = [
    a("UPA", "UBS", { created_at: "2026-09-03T10:00:00" }),
    a("UPA", "UBS", { created_at: "2026-10-03T10:00:00" }),
    a("UPA", "UBS", { created_at: "2026-10-04T10:00:00" }),
  ];
  const y = intervaloDoPeriodo("ano", new Date(2026, 9, 1));
  const r = calcularIndicadores(lista, config, { granularidade: "ano", ...y });
  assert.equal(r.serie.length, 12);
  assert.equal(r.serie[9].menorComplexidade, 2);
  assert.deepEqual(r.porMes.map((m) => m.acumulado), [115, 345]);
});

test("antes × depois usa somente a linha de base informada", () => {
  const vazio = antesDepois([], []);
  assert.equal(vazio.temBase, false);
  const base = [
    { competencia: "2025-01-01", tipo_unidade: "UPA", atendimentos: 1000 },
    { competencia: "2025-02-01", tipo_unidade: "UPA", atendimentos: 800 },
    { competencia: "2025-01-01", tipo_unidade: "UBS", atendimentos: 400 },
  ];
  const porMes = [{ porDestino: { UBS: 600, UPA: 500, HOSPITAL: 0, EMERGENCIA: 0 } }];
  const r = antesDepois(base, porMes);
  assert.equal(r.antes[r.tipos.indexOf("UPA")], 900);
  assert.equal(r.antes[r.tipos.indexOf("UBS")], 200);
  assert.equal(r.depois[r.tipos.indexOf("UBS")], 600);
});

test("tempo de espera evitado usa só os tempos configurados", () => {
  const cfg = { ...config, espera_ubs_min: 30, espera_upa_min: 150, espera_hospital_min: null };
  assert.equal(tempoDoAtendimento(a("UPA", "UBS"), cfg), 120);
  assert.equal(tempoDoAtendimento(a("HOSPITAL", "UBS"), cfg), null);
  assert.equal(tempoDoAtendimento(a("UPA", "UBS", { resultado: "reencaminhado" }), cfg), 0);
  const r = calcularIndicadores([a("UPA", "UBS"), a("UPA", "UBS"), a("HOSPITAL", "UBS")], cfg);
  assert.equal(r.tempo.minutosEvitados, 240);
  assert.equal(r.tempo.casosSemTempo, 1);
});

test("consultas do site: origem é a intenção inicial do cidadão", () => {
  const site = { created_at: "2026-10-10T10:00:00", canal: "site", origem_tipo: "UPA", destino_escolhido: "UBS", destino_recomendado: "UBS", resultado: "pendente" };
  const semIntencao = { ...site, origem_tipo: null };
  const r = calcularIndicadores([site, semIntencao], config);
  assert.equal(r.porCanal.site, 2);
  assert.equal(r.menorComplexidade, 1);
  assert.equal(r.economia.potencial, 115);
  assert.equal(r.chegadasAltaComplexidade, 1);
});
