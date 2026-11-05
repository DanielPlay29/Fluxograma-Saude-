// =====================================================================
// Função PÚBLICA de interpretação de sintomas (página inicial, sem login).
// Arquivo único, sem dependências: pode ser colado direto no painel do
// Supabase (Edge Functions → Deploy a new function → Via Editor).
//
// Segredos necessários (Edge Functions → Secrets):
//   GEMINI_API_KEY  — chave da Gemini API (obrigatória)
//   GEMINI_MODEL    — opcional (padrão: gemini-3.6-flash)
//   ALLOWED_ORIGIN  — opcional, ex.: https://danielplay29.github.io
//
// IMPORTANTE: desative "Enforce JWT verification" / verify_jwt nesta função,
// pois ela é chamada por visitantes sem login.
// =====================================================================

const MODELO = (typeof Deno !== "undefined" && Deno.env.get("GEMINI_MODEL")) || "gemini-3.6-flash";
const cors = {
  "Access-Control-Allow-Origin": (typeof Deno !== "undefined" && Deno.env.get("ALLOWED_ORIGIN")) || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

// Limite simples por IP (por instância): 8 interpretações por minuto
const usos = new Map<string, number[]>();
function permitido(ip: string): boolean {
  const agora = Date.now();
  const lista = (usos.get(ip) ?? []).filter((t) => agora - t < 60_000);
  if (lista.length >= 8) return false;
  lista.push(agora);
  usos.set(ip, lista);
  if (usos.size > 5000) usos.clear();
  return true;
}

const INSTRUCOES = `Você é um assistente de organização de informações de saúde do SUS. O relato foi escrito pelo próprio cidadão.
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

// ---------------- Validação anti-invenção (igual a _shared/validacao.ts) ----------------
export function normalizar(t: string): string {
  return (t ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type Item = { termo_tecnico: string; trecho_original: string };
export type Desc = { descricao: string; trecho_original: string };

export function validar(relato: string, bruto: Record<string, unknown>) {
  const base = ` ${normalizar(relato)} `;
  const descartados: Array<{ campo: string; item: unknown }> = [];
  const comprova = (trecho: unknown) => {
    const n = normalizar(String(trecho ?? ""));
    // O trecho precisa aparecer no relato como palavras inteiras (sem acento/caixa)
    return n.length >= 2 && base.includes(` ${n} `);
  };
  const filtraItem = (campo: string, it: unknown): Item | null => {
    const i = it as Item | null;
    if (!i || typeof i.termo_tecnico !== "string" || !i.termo_tecnico.trim()) return null;
    if (!comprova(i.trecho_original)) {
      descartados.push({ campo, item: i });
      return null;
    }
    return { termo_tecnico: i.termo_tecnico.trim(), trecho_original: String(i.trecho_original).trim() };
  };
  const filtraDesc = (campo: string, d: unknown): Desc | null => {
    const x = d as Desc | null;
    if (!x || typeof x.descricao !== "string") return null;
    if (!comprova(x.trecho_original)) {
      descartados.push({ campo, item: x });
      return null;
    }
    return { descricao: x.descricao.trim(), trecho_original: String(x.trecho_original).trim() };
  };
  const lista = (campo: string) =>
    (Array.isArray(bruto[campo]) ? (bruto[campo] as unknown[]) : [])
      .map((x) => filtraItem(campo, x))
      .filter((x): x is Item => !!x);

  let principal = filtraItem("sintoma_principal", bruto.sintoma_principal);
  let associados = lista("sintomas_associados");
  if (!principal && associados.length) {
    principal = associados[0];
    associados = associados.slice(1);
  }
  const negados = lista("negados");
  const inicio = filtraDesc("inicio", bruto.inicio);
  const intensidade = filtraDesc("intensidade", bruto.intensidade);
  const pendentes = (Array.isArray(bruto.informacoes_pendentes) ? bruto.informacoes_pendentes : [])
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim())
    .slice(0, 8);

  const partes: string[] = [];
  if (principal) partes.push(`Paciente relata ${principal.termo_tecnico.toLowerCase()}`);
  if (associados.length) {
    partes.push(`associado a ${associados.map((a) => a.termo_tecnico.toLowerCase()).join(", ")}`);
  }
  let resumo = partes.length ? partes.join(", ") + "." : "Nenhum sintoma identificado no relato.";
  if (inicio) resumo += ` Início: ${inicio.descricao}.`;
  if (intensidade) resumo += ` Intensidade relatada: ${intensidade.descricao}.`;
  if (negados.length) resumo += ` Nega: ${negados.map((n) => n.termo_tecnico.toLowerCase()).join(", ")}.`;

  return {
    interpretacao: {
      sintoma_principal: principal,
      sintomas_associados: associados,
      negados,
      inicio,
      intensidade,
      informacoes_pendentes: pendentes,
      resumo_tecnico: resumo,
    },
    descartados,
  };
}


if (typeof Deno !== "undefined") {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ erro: "metodo_nao_permitido" }, 405);

    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
    if (!permitido(ip)) return json({ erro: "limite_excedido" }, 429);

    const chave = Deno.env.get("GEMINI_API_KEY");
    if (!chave) return json({ erro: "ia_nao_configurada" }, 503);

    let relato = "";
    try {
      relato = String((await req.json())?.relato ?? "").trim();
    } catch {
      return json({ erro: "requisicao_invalida" }, 400);
    }
    if (relato.length < 3 || relato.length > 1000) return json({ erro: "relato_tamanho_invalido" }, 400);
    if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{15}\b/.test(relato)) return json({ erro: "documento_no_relato" }, 400);

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
            generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: ESQUEMA },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch {
      return json({ erro: "ia_indisponivel" }, 502);
    }
    if (!resp.ok) {
      console.error("Gemini API respondeu", resp.status, await resp.text());
      return json({ erro: resp.status === 429 ? "ia_cota_excedida" : "ia_indisponivel" }, 502);
    }
    let bruto: Record<string, unknown>;
    try {
      const corpo = await resp.json();
      bruto = JSON.parse(corpo?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "");
    } catch {
      return json({ erro: "ia_resposta_invalida" }, 502);
    }
    const { interpretacao, descartados } = validar(relato, bruto);
    return json({ modelo: MODELO, interpretacao, descartados: descartados.length });
  });
}
