import { test } from "node:test";
import assert from "node:assert/strict";
import { validar as validarCompartilhado } from "../supabase/functions/_shared/validacao.ts";
import { validar as validarPublico } from "../supabase/functions/interpretar-publico/index.ts";

for (const [nome, validar] of [["função dos profissionais", validarCompartilhado], ["função pública", validarPublico]] as const) {

test(`${nome}: ` + "mantém itens comprovados pelo relato e monta o resumo técnico", () => {
  const relato = "Paciente com dor nas costas desde ontem, tá com dificuldade de respirar.";
  const { interpretacao, descartados } = validar(relato, {
    sintoma_principal: { termo_tecnico: "Dor nas costas", trecho_original: "dor nas costas" },
    sintomas_associados: [{ termo_tecnico: "Dificuldade respiratória", trecho_original: "dificuldade de respirar" }],
    negados: [],
    inicio: { descricao: "desde ontem", trecho_original: "desde ontem" },
    intensidade: null,
    informacoes_pendentes: ["Intensidade da dor", "Frequência respiratória"],
  });
  assert.equal(descartados.length, 0);
  assert.equal(
    interpretacao.resumo_tecnico,
    "Paciente relata dor nas costas, associado a dificuldade respiratória. Início: desde ontem.",
  );
});

test(`${nome}: ` + "descarta sintomas, início e intensidade que o relato não contém (anti-invenção)", () => {
  const { interpretacao, descartados } = validar("Minha barriga tá doendo", {
    sintoma_principal: { termo_tecnico: "Dor abdominal", trecho_original: "barriga tá doendo" },
    sintomas_associados: [{ termo_tecnico: "Febre", trecho_original: "febre de 39 graus" }],
    negados: [],
    inicio: { descricao: "há 3 dias", trecho_original: "há 3 dias" },
    intensidade: { descricao: "8/10", trecho_original: "nota 8" },
    informacoes_pendentes: [],
  });
  assert.equal(interpretacao.sintomas_associados.length, 0);
  assert.equal(interpretacao.inicio, null);
  assert.equal(interpretacao.intensidade, null);
  assert.equal(descartados.length, 3);
  assert.doesNotMatch(interpretacao.resumo_tecnico, /febre|3 dias|8/i);
});

test(`${nome}: ` + "trecho parcial de palavra não comprova (ex.: 'ar' dentro de 'barriga')", () => {
  const { interpretacao } = validar("barriga doendo", {
    sintoma_principal: { termo_tecnico: "Dispneia", trecho_original: "ar" },
    sintomas_associados: [], negados: [], informacoes_pendentes: [],
  });
  assert.equal(interpretacao.sintoma_principal, null);
});
}
