// Chamadas usadas pela página pública (visitante sem login).
// Só usa funções seguras do banco: o visitante não lê nenhuma tabela.
import { sb, configurado } from "./supabase.js";

export { configurado };

export async function unidadesPublicas() {
  if (!configurado) return [];
  const { data, error } = await sb.rpc("unidades_publicas");
  if (error) { console.warn("unidades_publicas", error.message); return []; }
  return data ?? [];
}

export async function regrasPublicas() {
  if (!configurado) return null;
  const { data, error } = await sb.rpc("regras_publicas");
  if (error) { console.warn("regras_publicas", error.message); return null; }
  return data?.length ? data : null;
}

/** Interpretação por IA. Retorna null quando a IA não está disponível. */
export async function interpretarPublico(relato) {
  if (!configurado) return null;
  try {
    const { data, error } = await sb.functions.invoke("interpretar-publico", { body: { relato } });
    if (error || !data?.interpretacao) return null;
    return data;
  } catch {
    return null;
  }
}

/** Grava a consulta para os indicadores da gestão. Retorna o protocolo ou null. */
export async function registrarConsulta(dados) {
  if (!configurado) return null;
  const { data, error } = await sb.rpc("registrar_consulta_publica", {
    p_relato: dados.relato,
    p_faixa_etaria: dados.faixaEtaria || null,
    p_intencao: dados.intencao || null,
    p_interpretacao: dados.interpretacao,
    p_fonte: dados.fonte,
    p_alertas: dados.alertas,
    p_nivel: dados.nivel,
    p_destino: dados.destino,
    p_criterios: dados.criterios,
  });
  if (error) { console.warn("registrar_consulta_publica", error.message); return null; }
  return data;
}
