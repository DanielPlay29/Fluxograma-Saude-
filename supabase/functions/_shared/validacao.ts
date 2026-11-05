// Validação da resposta da IA: descarta todo item cujo "trecho_original"
// não aparece no relato e monta o resumo técnico só com itens comprovados.
// Sem dependências externas, para poder ser testado também no Node.
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

