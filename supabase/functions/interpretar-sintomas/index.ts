// Função serverless: interpreta o relato livre de sintomas usando a Gemini API.
// A chave GEMINI_API_KEY fica somente no servidor (Supabase Secrets).
//
// Garantias contra "alucinação":
//  1. O modelo é instruído a extrair SOMENTE o que está escrito.
//  2. Cada item devolvido precisa trazer o trecho literal do relato que o comprova;
//     itens cujo trecho não aparece no relato são DESCARTADOS aqui no servidor.
//  3. O resumo técnico é montado pelo servidor a partir dos itens validados,
//     e não pelo modelo.
import { cors, json, usuarioDaRequisicao } from "../_shared/comum.ts";
import { validar } from "../_shared/validacao.ts";

const MODELO = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash";

const INSTRUCOES = `Você é um assistente de organização de informações clínicas para profissionais do SUS.
Sua única tarefa é transformar o relato escrito (que pode ter erros de ortografia, abreviações,
gírias ou expressões populares) em termos técnicos organizados.

REGRAS OBRIGATÓRIAS:
- Extraia APENAS o que está explicitamente escrito no relato. Nunca invente sintomas, sinais vitais,
  diagnósticos, medicações, duração ou intensidade.
- Não sugira diagnósticos nem classificação de risco. Não recomende conduta.
- Para cada item extraído, copie em "trecho_original" o trecho EXATO do relato que o comprova.
- Use terminologia técnica em português (ex.: "barriga doendo" → "dor abdominal";
  "falta de ar" → "dificuldade respiratória"; "dor no peito" → "dor torácica";
  "cabeça explodindo" → "cefaleia intensa"; "costas dói" → "dor nas costas").
- Se o relato negar um sintoma (ex.: "sem febre"), coloque-o em "negados", não em sintomas.
- Em "informacoes_pendentes", liste perguntas objetivas sobre dados clínicos que faltam e seriam
  pertinentes (ex.: intensidade da dor de 0 a 10, tempo de início, sinais vitais), sem afirmar nada.
- Se não houver sintoma identificável, devolva sintoma_principal como null.`;

const ITEM = {
  type: "OBJECT",
  properties: {
    termo_tecnico: { type: "STRING" },
    trecho_original: { type: "STRING" },
  },
  required: ["termo_tecnico", "trecho_original"],
};

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    sintoma_principal: { ...ITEM, nullable: true },
    sintomas_associados: { type: "ARRAY", items: ITEM },
    negados: { type: "ARRAY", items: ITEM },
    inicio: {
      type: "OBJECT",
      nullable: true,
      properties: { descricao: { type: "STRING" }, trecho_original: { type: "STRING" } },
      required: ["descricao", "trecho_original"],
    },
    intensidade: {
      type: "OBJECT",
      nullable: true,
      properties: { descricao: { type: "STRING" }, trecho_original: { type: "STRING" } },
      required: ["descricao", "trecho_original"],
    },
    informacoes_pendentes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["sintoma_principal", "sintomas_associados", "negados", "informacoes_pendentes"],
};

async function sha256(t: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo_nao_permitido" }, 405);

  const u = await usuarioDaRequisicao(req);
  if (!u.ok) return u.resposta;
  if (!["admin", "profissional"].includes(u.perfil.papel)) return json({ erro: "acesso_negado" }, 403);

  const chave = Deno.env.get("GEMINI_API_KEY");
  if (!chave) return json({ erro: "ia_nao_configurada" }, 503);

  let relato = "";
  try {
    relato = String((await req.json())?.relato ?? "").trim();
  } catch {
    return json({ erro: "requisicao_invalida" }, 400);
  }
  if (relato.length < 3 || relato.length > 2000) return json({ erro: "relato_tamanho_invalido" }, 400);

  const inicio = Date.now();
  let resp: Response;
  try {
    resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODELO)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCOES }] },
          contents: [{ role: "user", parts: [{ text: `Relato:\n"""${relato}"""` }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: ESQUEMA,
          },
        }),
        signal: AbortSignal.timeout(25_000),
      },
    );
  } catch (e) {
    console.error("Falha de rede com a Gemini API", e);
    return json({ erro: "ia_indisponivel" }, 502);
  }
  if (!resp.ok) {
    console.error("Gemini API respondeu", resp.status, await resp.text());
    return json({ erro: resp.status === 429 ? "ia_cota_excedida" : "ia_indisponivel" }, 502);
  }

  let bruto: Record<string, unknown>;
  try {
    const corpo = await resp.json();
    const texto = corpo?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    bruto = JSON.parse(texto);
  } catch (e) {
    console.error("Resposta da IA em formato inesperado", e);
    return json({ erro: "ia_resposta_invalida" }, 502);
  }

  const { interpretacao, descartados } = validar(relato, bruto);
  const latencia = Date.now() - inicio;

  const { data: reg, error } = await u.db
    .from("ia_interpretacoes")
    .insert({
      created_by: u.perfil.id,
      modelo: MODELO,
      entrada_sha256: await sha256(relato),
      saida: interpretacao,
      itens_descartados: descartados,
      latencia_ms: latencia,
    })
    .select("id")
    .single();
  if (error) console.error("Não foi possível registrar a interpretação", error);

  return json({ id: reg?.id ?? null, modelo: MODELO, interpretacao, descartados: descartados.length, latencia_ms: latencia });
});
