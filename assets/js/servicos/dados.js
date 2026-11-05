// Acesso a dados. Toda leitura/escrita passa pelo Supabase com o token do
// usuário logado, então as regras de segurança (RLS) do banco sempre valem.
import { sb } from "./supabase.js";
import { regrasOriginaisComoLista } from "../core/triagem.js";

/** AAAA-MM-DD no horário local (sem deslocamento de fuso). */
export const dataLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function falha(error, padrao = "Não foi possível concluir a operação.") {
  if (!error) return;
  console.error(error);
  const m = error.message ?? "";
  if (/justificativa_divergencia/.test(m)) throw new Error("Informe a justificativa para escolher um destino diferente do recomendado.");
  if (/row-level security|permission denied/i.test(m)) throw new Error("Seu perfil não tem permissão para esta ação.");
  if (/duplicate key/i.test(m)) throw new Error("Já existe um registro com esses dados.");
  if (/fetch|network/i.test(m)) throw new Error("Sem conexão com o servidor. Verifique sua internet.");
  throw new Error(padrao);
}

// ---------------- Unidades ----------------
export async function listarUnidades({ incluirInativas = false } = {}) {
  let q = sb.from("unidades").select("*").order("tipo").order("nome");
  if (!incluirInativas) q = q.eq("ativa", true);
  const { data, error } = await q;
  falha(error, "Não foi possível carregar as unidades.");
  return data;
}
export async function salvarUnidade(u) {
  const { id, ...campos } = u;
  const { error } = id
    ? await sb.from("unidades").update(campos).eq("id", id)
    : await sb.from("unidades").insert(campos);
  falha(error, "Não foi possível salvar a unidade.");
}

// ---------------- Configurações ----------------
export async function obterConfig() {
  const { data, error } = await sb.from("configuracoes").select("*").eq("id", 1).maybeSingle();
  falha(error, "Não foi possível carregar as configurações.");
  return data ?? {};
}
export async function salvarConfig(patch, usuarioId) {
  const { error } = await sb
    .from("configuracoes")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: usuarioId })
    .eq("id", 1);
  falha(error, "Não foi possível salvar as configurações.");
}

// ---------------- Regras de encaminhamento ----------------
export async function listarRegras({ somenteAtivas = false } = {}) {
  let q = sb.from("regras_encaminhamento").select("*").order("nivel").order("termo");
  if (somenteAtivas) q = q.eq("ativa", true);
  const { data, error } = await q;
  falha(error, "Não foi possível carregar as regras.");
  // Se a tabela ainda não foi semeada, usa as regras originais embutidas
  return data?.length ? data : regrasOriginaisComoLista();
}
export async function criarRegra(termo, nivel, usuarioId) {
  const { error } = await sb.from("regras_encaminhamento").insert({ termo: termo.trim().toLowerCase(), nivel, origem: "personalizada", created_by: usuarioId });
  falha(error, "Não foi possível criar a regra.");
}
export async function alterarRegra(id, patch) {
  const { error } = await sb.from("regras_encaminhamento").update(patch).eq("id", id);
  falha(error, "Não foi possível alterar a regra.");
}
export async function excluirRegra(id) {
  const { error } = await sb.from("regras_encaminhamento").delete().eq("id", id);
  falha(error, "Não foi possível excluir a regra.");
}

// ---------------- Inteligência artificial ----------------
const ERROS_IA = {
  ia_nao_configurada: "A IA ainda não foi configurada no servidor (falta a GEMINI_API_KEY).",
  ia_cota_excedida: "A cota gratuita da IA foi atingida. Tente novamente mais tarde.",
  ia_indisponivel: "O serviço de IA não respondeu.",
  ia_resposta_invalida: "A IA devolveu uma resposta em formato inesperado.",
  acesso_negado: "Seu perfil não pode usar a interpretação por IA.",
  relato_tamanho_invalido: "O relato deve ter entre 3 e 2.000 caracteres.",
};
export async function interpretarComIA(relato) {
  const { data, error } = await sb.functions.invoke("interpretar-sintomas", { body: { relato } });
  if (error) {
    let codigo = null;
    try { codigo = (await error.context?.json?.())?.erro; } catch { /* sem corpo */ }
    const e = new Error(ERROS_IA[codigo] ?? "Não foi possível falar com o serviço de IA.");
    e.codigo = codigo ?? "falha_rede";
    throw e;
  }
  return data;
}

// ---------------- Atendimentos ----------------
const SELECT_ATENDIMENTO = `*,
  origem:unidades!atendimentos_unidade_origem_id_fkey(id, nome, tipo),
  destino_unidade:unidades!atendimentos_destino_unidade_id_fkey(id, nome, tipo),
  autor:perfis!atendimentos_created_by_fkey(nome)`;

/** Achata o registro para os cálculos de indicadores. */
export const ROTULO_INTENCAO = { UBS: "UBS", UPA: "UPA", HOSPITAL: "hospital" };
export function achatar(a) {
  if (a.canal === "site") {
    // Consulta pública: a "origem" é para onde o cidadão iria sem a orientação
    return {
      ...a,
      origem_tipo: a.intencao_inicial ?? null,
      origem_nome: a.intencao_inicial ? `Site · iria à ${ROTULO_INTENCAO[a.intencao_inicial]}` : "Site · não sabia aonde ir",
    };
  }
  return { ...a, origem_tipo: a.origem?.tipo, origem_nome: a.origem?.nome };
}

export async function salvarAtendimento(registro) {
  const { data, error } = await sb.from("atendimentos").insert(registro).select("id, protocolo").single();
  falha(error, "Não foi possível salvar o atendimento.");
  if (registro.ia_interpretacao_id) {
    await sb.from("ia_interpretacoes").update({ atendimento_id: data.id }).eq("id", registro.ia_interpretacao_id);
  }
  return data;
}

export async function listarAtendimentos({ inicio, fim, unidadeId, tipoAtendimento, destino, resultado, canal, limite = 5000 } = {}) {
  let q = sb.from("atendimentos").select(SELECT_ATENDIMENTO).order("created_at", { ascending: false }).limit(limite);
  if (inicio) q = q.gte("created_at", inicio.toISOString());
  if (fim) q = q.lt("created_at", fim.toISOString());
  if (unidadeId) q = q.eq("unidade_origem_id", unidadeId);
  if (tipoAtendimento) q = q.eq("tipo_atendimento", tipoAtendimento);
  if (destino) q = q.eq("destino_escolhido", destino);
  if (resultado) q = q.eq("resultado", resultado);
  if (canal) q = q.eq("canal", canal);
  const { data, error } = await q;
  falha(error, "Não foi possível carregar os atendimentos.");
  return data.map(achatar);
}

export async function obterAtendimento(id) {
  const { data, error } = await sb.from("atendimentos").select(SELECT_ATENDIMENTO).eq("id", id).single();
  falha(error, "Atendimento não encontrado.");
  return achatar(data);
}

export async function atualizarAtendimento(id, patch) {
  const { error } = await sb.from("atendimentos").update(patch).eq("id", id);
  falha(error, "Não foi possível atualizar o atendimento.");
}

export async function historicoDoRegistro(tabela, id) {
  const { data, error } = await sb
    .from("auditoria")
    .select("id, ocorrido_em, usuario_id, acao, antes, depois")
    .eq("tabela", tabela)
    .eq("registro_id", id)
    .order("ocorrido_em", { ascending: true });
  falha(error, "Não foi possível carregar o histórico.");
  return data;
}

export async function listarAuditoria(limite = 200) {
  const { data, error } = await sb.from("auditoria").select("*").order("ocorrido_em", { ascending: false }).limit(limite);
  falha(error, "Não foi possível carregar a auditoria.");
  return data;
}

// ---------------- Usuários ----------------
export async function listarPerfis() {
  const { data, error } = await sb.from("perfis").select("*, unidade:unidades(id, nome)").order("nome");
  falha(error, "Não foi possível carregar os usuários.");
  return data;
}
export async function atualizarPerfil(id, patch) {
  const { error } = await sb.from("perfis").update(patch).eq("id", id);
  falha(error, "Não foi possível atualizar o usuário.");
}
const ERROS_USUARIO = {
  email_invalido: "E-mail inválido.",
  nome_invalido: "Informe o nome completo.",
  senha_curta: "A senha temporária precisa ter pelo menos 8 caracteres.",
  papel_invalido: "Perfil de acesso inválido.",
  email_ja_cadastrado: "Já existe um usuário com este e-mail.",
  acesso_negado: "Somente administradores podem criar usuários.",
};
export async function criarUsuario(dados) {
  const { error } = await sb.functions.invoke("gerenciar-usuarios", { body: { acao: "criar", ...dados } });
  if (error) {
    let codigo = null;
    try { codigo = (await error.context?.json?.())?.erro; } catch { /* sem corpo */ }
    throw new Error(ERROS_USUARIO[codigo] ?? "Não foi possível criar o usuário. Verifique se a função gerenciar-usuarios foi publicada.");
  }
}

// ---------------- Linha de base e economia comprovada ----------------
export async function listarLinhaBase() {
  const { data, error } = await sb.from("linha_base").select("*").order("competencia", { ascending: false });
  falha(error, "Não foi possível carregar a linha de base.");
  return data;
}
export async function salvarLinhaBase(reg) {
  const { error } = await sb.from("linha_base").upsert(reg, { onConflict: "competencia,tipo_unidade" });
  falha(error, "Não foi possível salvar a linha de base.");
}
export async function excluirLinhaBase(id) {
  const { error } = await sb.from("linha_base").delete().eq("id", id);
  falha(error, "Não foi possível excluir o registro.");
}
export async function listarEconomiaComprovada({ inicio, fim } = {}) {
  let q = sb.from("economia_comprovada").select("*").order("competencia", { ascending: false });
  if (inicio) q = q.gte("competencia", dataLocal(inicio));
  if (fim) q = q.lt("competencia", dataLocal(fim));
  const { data, error } = await q;
  falha(error, "Não foi possível carregar a economia comprovada.");
  return data;
}
export async function salvarEconomiaComprovada(reg) {
  const { error } = await sb.from("economia_comprovada").insert(reg);
  falha(error, "Não foi possível salvar o registro.");
}
export async function excluirEconomiaComprovada(id) {
  const { error } = await sb.from("economia_comprovada").delete().eq("id", id);
  falha(error, "Não foi possível excluir o registro.");
}
