import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizar, corrigirDigitacao, detectarAlertas, interpretarLocalmente, recomendar,
  REGRAS_ORIGINAIS, regrasOriginaisComoLista,
} from "../assets/js/core/triagem.js";

const termos = (i) => [i.sintoma_principal, ...i.sintomas_associados].filter(Boolean).map((x) => x.termo_tecnico);

test("regras originais preservadas integralmente (21 + 20 + 19)", () => {
  assert.equal(REGRAS_ORIGINAIS.primaria.length, 21);
  assert.equal(REGRAS_ORIGINAIS.secundaria.length, 20);
  assert.equal(REGRAS_ORIGINAIS.terciaria.length, 19);
  assert.equal(regrasOriginaisComoLista().length, 60);
});

test("normalização remove acentos, caixa e pontuação", () => {
  assert.equal(normalizar("  Infecção URINÁRIA, simples!! "), "infeccao urinaria simples");
});

test("correção de digitação em palavras-chave", () => {
  assert.equal(corrigirDigitacao("barriag doendo"), "barriga doendo");
  assert.equal(corrigirDigitacao("respirr"), "respirar");
  assert.equal(corrigirDigitacao("casa"), "casa"); // palavras curtas não são alteradas
});

test("mesmo comportamento do site original para os termos cadastrados", () => {
  assert.equal(recomendar({ relato: "Gripe" }).destino, "UBS");
  assert.equal(recomendar({ relato: "Pneumonia comunitária moderada" }).destino, "UPA");
  assert.equal(recomendar({ relato: "Câncer com radioterapia ou quimioterapia" }).destino, "HOSPITAL");
  assert.equal(recomendar({ relato: "infeccao urinaria simples" }).destino, "UBS"); // sem acento agora funciona
});

test("vale o nível de maior complexidade quando há termos de níveis diferentes", () => {
  const r = recomendar({ relato: "paciente com gripe e histórico de câncer" });
  assert.equal(r.nivel, "terciaria");
  assert.equal(r.correspondencias.length, 2);
});

test("exemplos de linguagem popular do projeto", () => {
  const casos = [
    ["Costas dói muito.", "Dor nas costas"],
    ["Tô com falta de ar", "Dificuldade respiratória"],
    ["Minha barriga tá doendo", "Dor abdominal"],
    ["Tô com dor no peito", "Dor torácica"],
    ["Minha cabeça tá explodindo", "Cefaleia intensa"],
  ];
  for (const [entrada, esperado] of casos) {
    assert.ok(termos(interpretarLocalmente(entrada)).includes(esperado), `${entrada} → ${esperado}`);
  }
  const mv = termos(interpretarLocalmente("Tô passando mal e vomitando"));
  assert.ok(mv.includes("Mal-estar") && mv.includes("Vômitos"));
});

test("exemplo completo: dor nas costas desde ontem com dificuldade de respirar", () => {
  const i = interpretarLocalmente("Paciente com dor nas costas desde ontem, tá com dificuldade de respirar.");
  assert.equal(i.sintoma_principal.termo_tecnico, "Dor nas costas");
  assert.equal(i.sintomas_associados[0].termo_tecnico, "Dificuldade respiratória");
  assert.deepEqual(new Set(termos(i)), new Set(["Dor nas costas", "Dificuldade respiratória"]));
  assert.equal(i.inicio.descricao, "desde ontem");
  assert.ok(i.informacoes_pendentes.some((p) => /intensidade da dor/i.test(p)));
  assert.ok(i.informacoes_pendentes.some((p) => /satura/i.test(p)));
});

test("interpretação local não inventa: relato sem sintoma não gera sintoma", () => {
  const i = interpretarLocalmente("Veio buscar atestado");
  assert.equal(i.sintoma_principal, null);
  assert.equal(i.sintomas_associados.length, 0);
});

test("sinais de alerta disparam avaliação imediata independentemente da IA", () => {
  for (const t of ["Tô com dor no peito", "tô com falta de ar", "boca torta e fala enrolada", "desmaiou na fila", "vomitando sangue"]) {
    const r = recomendar({ relato: t });
    assert.equal(r.nivel, "emergencia", t);
    assert.equal(r.destino, "EMERGENCIA", t);
  }
});

test("alerta tem prioridade sobre regra de baixa complexidade", () => {
  const r = recomendar({ relato: "gripe forte e agora com falta de ar" });
  assert.equal(r.nivel, "emergencia");
  assert.ok(r.criterios[0].startsWith("Sinal de alerta"));
});

test("sintoma negado não dispara alerta nem regra", () => {
  const a = detectarAlertas("febre há 2 dias, sem falta de ar e sem dor no peito");
  assert.ok(a.length === 2 && a.every((x) => x.negado));
  assert.notEqual(recomendar({ relato: "sem falta de ar, nega gripe" }).nivel, "emergencia");
  assert.equal(recomendar({ relato: "nega gripe" }).nivel, "indefinido");
});

test("termos da IA também alimentam as regras e os alertas", () => {
  const interp = { sintoma_principal: { termo_tecnico: "Dor torácica", trecho_original: "peito" }, sintomas_associados: [] };
  assert.equal(recomendar({ relato: "tá doendo aqui ó", interpretacao: interp }).nivel, "emergencia");
  const interp2 = { sintoma_principal: { termo_tecnico: "Conjuntivite", trecho_original: "olho" }, sintomas_associados: [] };
  assert.equal(recomendar({ relato: "olho vermelho", interpretacao: interp2 }).destino, "UBS");
});

test("sem correspondência: indefinido, decisão do profissional", () => {
  const r = recomendar({ relato: "dor no joelho" });
  assert.equal(r.nivel, "indefinido");
  assert.equal(r.destino, null);
});

test("regras complementares cadastradas pelo administrador são usadas", () => {
  const regras = [...regrasOriginaisComoLista(), { termo: "dor no joelho", nivel: "primaria", origem: "personalizada" }];
  const r = recomendar({ relato: "dor no joelho", regras });
  assert.equal(r.destino, "UBS");
  assert.match(r.criterios[0], /Regra complementar/);
  const inativa = recomendar({ relato: "dor no joelho", regras: [{ termo: "dor no joelho", nivel: "primaria", ativa: false }] });
  assert.equal(inativa.nivel, "indefinido");
});
