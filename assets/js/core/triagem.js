// =====================================================================
// Motor de encaminhamento
//  - Preserva as regras ORIGINAIS do fluxograma (listas de palavras-chave
//    por nível de atenção: primária → UBS, secundária → UPA, terciária → Hospital).
//  - Detecta sinais de alerta de forma determinística (não depende da IA),
//    para que casos potencialmente graves sejam sinalizados imediatamente.
//  - Oferece uma interpretação por regras locais quando a IA não está
//    disponível (sempre identificada como tal, nunca apresentada como IA).
// Este módulo é puro (sem acesso a rede/DOM) e é testado em tests/.
// =====================================================================

/** Regras originais, copiadas sem alteração do index.html anterior. */
export const REGRAS_ORIGINAIS = {
  primaria: [
    "resfriado", "dor de garganta", "diarreia leve", "cefaleia tensional", "gripe",
    "infecção urinária simples", "febre baixa", "hipertensão leve", "diabetes tipo 2 controlado",
    "alergias respiratórias leves", "pequenas feridas", "cortes", "dor muscular", "verminoses",
    "vacinação", "planejamento familiar", "ansiedade leve", "conjuntivite", "gastrite leve",
    "otite externa", "insônia leve",
  ],
  secundaria: [
    "apendicite", "pneumonia", "depressão moderada", "endometriose", "diabetes tipo 2 descontrolado",
    "hipertensão severa", "insuficiência cardíaca leve", "cálculo renal", "hérnia de disco",
    "asma grave", "lúpus leve", "distúrbios de tireoide", "refluxo crônico", "catarata",
    "toc moderado", "obesidade mórbida", "doença de crohn", "transtornos alimentares",
    "insuficiência venosa crônica", "dst avançada",
  ],
  terciaria: [
    "transplante de órgãos", "câncer", "avc agudo", "infarto", "insuficiência renal",
    "lesões graves", "cirurgias cardíacas", "transtornos psiquiátricos graves", "sepse",
    "grandes queimaduras", "dpoc grave", "hemorragias internas", "lesão medular",
    "meningite bacteriana", "neuropatias severas", "aids avançada", "cirurgias ortopédicas complexas",
    "cirrose descompensada", "cuidados paliativos",
  ],
};

/** Regras originais no formato da tabela regras_encaminhamento. */
export function regrasOriginaisComoLista() {
  return Object.entries(REGRAS_ORIGINAIS).flatMap(([nivel, termos]) =>
    termos.map((termo) => ({ termo, nivel, origem: "original", ativa: true })),
  );
}

export const NIVEL_DESTINO = {
  primaria: "UBS",
  secundaria: "UPA",
  terciaria: "HOSPITAL",
  emergencia: "EMERGENCIA",
};

export const ROTULO_NIVEL = {
  primaria: "Atenção Primária",
  secundaria: "Atenção Secundária",
  terciaria: "Atenção Terciária",
  emergencia: "Avaliação imediata",
  indefinido: "Sem correspondência no protocolo",
};

export const ROTULO_DESTINO = {
  UBS: "UBS / Estratégia Saúde da Família",
  UPA: "UPA",
  HOSPITAL: "Hospital",
  EMERGENCIA: "Serviço de emergência (SAMU 192 / pronto-socorro)",
};

const PESO_NIVEL = { primaria: 1, secundaria: 2, terciaria: 3, emergencia: 4 };

/** Minúsculas, sem acentos, sem pontuação, espaços simples. */
export function normalizar(texto) {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------
// Correção ortográfica leve (distância de edição 1) para palavras-chave
// ---------------------------------------------------------------------
const VOCABULARIO = [
  "dor", "doi", "doendo", "costas", "barriga", "peito", "cabeca", "garganta", "ouvido",
  "respirar", "respirando", "febre", "vomitando", "vomito", "vomitos", "diarreia", "tosse",
  "tossindo", "tontura", "tonto", "desmaio", "desmaiou", "sangramento", "sangrando",
  "convulsao", "falta", "aperto", "explodindo", "enjoo", "enjoado", "nausea", "fraqueza",
  "formigamento", "inchaco", "inchado", "coceira", "urinar", "ardendo", "ardencia",
  "gripe", "resfriado", "pneumonia", "infarto", "apendicite", "conjuntivite", "verminoses",
  "gastrite", "insonia", "ansiedade", "cefaleia", "hipertensao", "diabetes", "asma",
  "abdominal", "lombar", "muscular", "torax", "toracica", "dificuldade", "queimadura",
];
const VOCAB_SET = new Set(VOCABULARIO);

function distanciaMaxUm(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  // Letras vizinhas trocadas ("barriag" → "barriga") contam como um único erro
  if (a.length === b.length) {
    const d = [...a].map((c, k) => (c !== b[k] ? k : -1)).filter((k) => k >= 0);
    if (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]) return true;
  }
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}

/** Corrige erros de digitação simples em palavras-chave (ex.: "barriag" → "barriga"). */
export function corrigirDigitacao(textoNormalizado) {
  return textoNormalizado
    .split(" ")
    .map((p) => {
      if (p.length < 5 || VOCAB_SET.has(p)) return p;
      const alvo = VOCABULARIO.find((v) => v.length >= 5 && distanciaMaxUm(p, v));
      return alvo ?? p;
    })
    .join(" ");
}

/** Texto pronto para comparação: normalizado + correção de digitação. */
export function prepararTexto(texto) {
  return corrigirDigitacao(normalizar(texto));
}

const NEGACOES = new Set(["sem", "nega", "negou", "nao", "nenhum", "nenhuma", "ausencia"]);

/** Verifica se as até 3 palavras anteriores à posição contêm negação. */
function negadoAntes(texto, indice) {
  const anteriores = texto.slice(0, indice).trim().split(" ").slice(-3);
  return anteriores.some((p) => NEGACOES.has(p));
}

// ---------------------------------------------------------------------
// Sinais de alerta (determinísticos e não desativáveis)
// ---------------------------------------------------------------------
export const SINAIS_ALERTA = [
  {
    id: "dor_toracica",
    rotulo: "Dor torácica",
    padroes: [/\b(dor|dores|aperto|pontada|pressao|queimacao)( forte| muito forte| intensa)? (no|do|na|em) peito\b/, /\bpeito (doi|doendo|apertado|apertando)\b/, /\bdor toracica\b/, /\bangina\b/],
  },
  {
    id: "dificuldade_respiratoria",
    rotulo: "Dificuldade respiratória",
    padroes: [/\bfalta de ar\b/, /\b(dificuldade|dificil|custando) (de |pra |para |p )?respirar\b/, /\b(nao|n) (consigo|consegue|esta conseguindo|ta conseguindo) respirar\b/, /\bsem ar\b/, /\bdispneia\b/, /\bcansaco (pra|para) respirar\b/, /\bsufoc/, /\brespiracao (dificil|curta|ofegante)\b/, /\bdificuldade respiratoria\b/],
  },
  {
    id: "sinais_avc",
    rotulo: "Possíveis sinais de AVC",
    padroes: [/\bboca torta\b/, /\bfala (enrolada|arrastada|embolada)\b/, /\b(fraqueza|dormencia|formigamento) (de|em|no|na) (um|uma|so um|so uma) (lado|braco|perna)\b/, /\bperdeu (a )?forca\b/, /\bderrame\b/, /\bavc\b/, /\brosto (torto|caido)\b/],
  },
  {
    id: "rebaixamento_consciencia",
    rotulo: "Desmaio / alteração de consciência",
    padroes: [/\bdesmai/, /\bperdeu (a )?(consciencia|os sentidos)\b/, /\bdesacordad/, /\binconsciente\b/, /\bnao (responde|acorda)\b/, /\bsincope\b/, /\bconfus[ao] mental\b/],
  },
  {
    id: "convulsao",
    rotulo: "Convulsão",
    padroes: [/\bconvuls/, /\bataque epileptico\b/, /\bcrise epileptica\b/],
  },
  {
    id: "hemorragia",
    rotulo: "Sangramento importante",
    padroes: [/\bsangramento (intenso|forte|grande|abundante)\b/, /\bhemorragia/, /\b(vomitando|vomito|vomitou|tossindo|tosse) (com )?sangue\b/, /\bsangue (nas|na) (fezes|urina)\b/, /\bsangrando muito\b/, /\bfezes pretas\b/],
  },
  {
    id: "trauma_grave",
    rotulo: "Trauma / acidente grave",
    padroes: [/\batropel/, /\bacidente (de carro|de moto|de transito|grave)\b/, /\bqueda de altura\b/, /\b(baleado|tiro|esfaquead|facada)\b/, /\bqueimadura (grave|extensa|grande)\b/, /\bgrandes queimaduras\b/],
  },
  {
    id: "anafilaxia",
    rotulo: "Reação alérgica grave",
    padroes: [/\bgarganta fechando\b/, /\b(inchaco|inchada|inchado) (na|no|da|do) (boca|lingua|labio|labios|rosto|garganta|olho|olhos)\b/, /\banafila/],
  },
  {
    id: "risco_suicidio",
    rotulo: "Risco de autoagressão",
    padroes: [/\bsuicid/, /\bse matar\b/, /\b(me|se) machucar de proposito\b/, /\bquero morrer\b/, /\bquer morrer\b/, /\btirar (a )?(propria )?vida\b/],
  },
  {
    id: "intoxicacao",
    rotulo: "Intoxicação / envenenamento",
    padroes: [/\benvenen/, /\bintoxica/, /\boverdose\b/, /\btomou (muitos|varios|um monte de) (remedios|comprimidos)\b/],
  },
];

/**
 * Detecta sinais de alerta no texto.
 * Retorna [{id, rotulo, trecho, negado}] — "negado" quando precedido de negação
 * (ex.: "sem falta de ar"); esses aparecem como "confirmar", não disparam emergência.
 */
export function detectarAlertas(texto) {
  const t = prepararTexto(texto);
  const achados = [];
  for (const s of SINAIS_ALERTA) {
    for (const p of s.padroes) {
      const m = p.exec(t);
      if (m) {
        achados.push({ id: s.id, rotulo: s.rotulo, trecho: m[0].trim(), negado: negadoAntes(t, m.index) });
        break;
      }
    }
  }
  return achados;
}

// ---------------------------------------------------------------------
// Interpretação por regras locais (fallback quando a IA não está disponível)
// ---------------------------------------------------------------------
const EXPRESSOES = [
  { termo: "Dor torácica", p: [/\b(dor|dores|aperto|pontada) (no|do|na) peito\b/, /\bpeito (doi|doendo|apertado)\b/] },
  { termo: "Dificuldade respiratória", p: [/\bfalta de ar\b/, /\b(dificuldade|dificil) (de |pra |para )?respirar\b/, /\bnao (consigo|consegue) respirar\b/, /\bsem ar\b/, /\bcansaco (pra|para) respirar\b/, /\bdificuldade respiratoria\b/, /\bdispneia\b/, /\brespiracao (dificil|curta|ofegante)\b/] },
  { termo: "Cefaleia intensa", p: [/\bcabeca (ta |esta )?explodindo\b/, /\bdor de cabeca (muito )?(forte|intensa|insuportavel)\b/] },
  { termo: "Cefaleia", p: [/\bdor de cabeca\b/, /\bcabeca (doi|doendo|latejando)\b/, /\bdor na cabeca\b/, /\benxaqueca\b/] },
  { termo: "Dor nas costas", p: [/\bcostas (ta |esta )?(doi|doendo|dolorida)\b/, /\bdor (nas|na|das) costas\b/, /\bdor lombar\b/, /\blombar (doi|doendo)\b/] },
  { termo: "Dor abdominal", p: [/\bbarriga (ta |esta )?(doi|doendo|dolorida)\b/, /\bdor (na|de) barriga\b/, /\bdor abdominal\b/, /\bdor no estomago\b/, /\bestomago (doi|doendo)\b/] },
  { termo: "Dor de garganta", p: [/\bdor de garganta\b/, /\bgarganta (doi|doendo|inflamada|arranhando)\b/] },
  { termo: "Otalgia (dor de ouvido)", p: [/\bdor de ouvido\b/, /\bouvido (doi|doendo)\b/] },
  { termo: "Vômitos", p: [/\bvomit/, /\bgomit/, /\bpondo tudo pra fora\b/] },
  { termo: "Náusea", p: [/\benjo(o|ado|ada)\b/, /\bnausea/, /\bembrulhado\b/] },
  { termo: "Mal-estar", p: [/\bpassando mal\b/, /\bmal estar\b/, /\bme sentindo mal\b/, /\bindisposto\b/] },
  { termo: "Febre", p: [/\bfebre\b/, /\bfebril\b/, /\bquente de febre\b/] },
  { termo: "Tosse", p: [/\btosse\b/, /\btossindo\b/] },
  { termo: "Diarreia", p: [/\bdiarreia\b/, /\bintestino solto\b/, /\bcaganeira\b/] },
  { termo: "Tontura", p: [/\btontura\b/, /\btont[oa]\b/, /\bzonz[oa]\b/] },
  { termo: "Disúria (dor ou ardência ao urinar)", p: [/\b(ardencia|ardendo|arde|dor) (ao|pra|para|quando) (urinar|fazer xixi|faz xixi)\b/, /\bxixi (arde|ardendo)\b/] },
  { termo: "Edema (inchaço)", p: [/\binchac/, /\binchad[oa]\b/] },
  { termo: "Prurido (coceira)", p: [/\bcoceira\b/, /\bcocando\b/] },
  { termo: "Dor muscular", p: [/\bdor muscular\b/, /\bdor no corpo\b/, /\bcorpo (doi|doendo)\b/] },
  { termo: "Fraqueza", p: [/\bfraqueza\b/, /\bsem forca\b/] },
  { termo: "Síncope (desmaio)", p: [/\bdesmai/] },
  { termo: "Sangramento", p: [/\bsangramento\b/, /\bsangrando\b/] },
  { termo: "Convulsão", p: [/\bconvuls/] },
];

const PADRAO_INICIO = /\b(desde (ontem|anteontem|hoje|cedo|a noite|de manha|semana passada|o fim de semana)|ha (\d+|um|uma|dois|duas|tres|quatro|cinco|alguns|algumas) (minuto|minutos|hora|horas|dia|dias|semana|semanas|mes|meses)|faz (\d+|um|uma|dois|duas|tres|alguns|algumas) (hora|horas|dia|dias|semana|semanas|mes|meses)|(hoje|ontem) (de manha|a tarde|a noite|cedo))\b/;
const PADRAO_INTENSIDADE = /\b(muito forte|muito|forte|intensa|intenso|insuportavel|demais|explodindo|fraca|fraco|leve)\b/;

/**
 * Interpreta o relato SEM IA, usando expressões conhecidas.
 * Só registra o que tem trecho correspondente no texto.
 */
export function interpretarLocalmente(relato) {
  const t = prepararTexto(relato);
  const encontrados = [];
  const negados = [];
  for (const e of EXPRESSOES) {
    for (const p of e.p) {
      const m = p.exec(t);
      if (m) {
        const item = { termo_tecnico: e.termo, trecho_original: m[0].trim(), _pos: m.index };
        (negadoAntes(t, m.index) ? negados : encontrados).push(item);
        break;
      }
    }
  }
  // Ordem em que aparecem no relato (o primeiro citado é o sintoma principal);
  // "Cefaleia intensa" já cobre "Cefaleia"
  const limpar = (l) => l.sort((x, y) => x._pos - y._pos).map(({ _pos, ...x }) => x);
  const unicos = limpar(encontrados).filter(
    (x, _, arr) => !(x.termo_tecnico === "Cefaleia" && arr.some((y) => y.termo_tecnico === "Cefaleia intensa")),
  );
  negados.splice(0, negados.length, ...limpar(negados));
  const mi = PADRAO_INICIO.exec(t);
  const mt = PADRAO_INTENSIDADE.exec(t);
  const inicio = mi ? { descricao: mi[0], trecho_original: mi[0] } : null;
  const intensidade = mt ? { descricao: `${mt[0]} (relato do paciente)`, trecho_original: mt[0] } : null;

  const principal = unicos[0] ?? null;
  const associados = unicos.slice(1);
  const temDor = unicos.some((x) => /^dor|cefaleia|otalgia/i.test(x.termo_tecnico));
  const termos = unicos.map((x) => x.termo_tecnico);

  const pendentes = [];
  if (!inicio) pendentes.push("Quando os sintomas começaram?");
  if (temDor && !intensidade) pendentes.push("Intensidade da dor (escala de 0 a 10)");
  if (termos.includes("Dificuldade respiratória")) pendentes.push("Frequência respiratória e saturação de O₂");
  if (termos.includes("Dor torácica")) pendentes.push("Características da dor torácica (irradiação, duração), PA e FC");
  if (termos.includes("Febre")) pendentes.push("Temperatura aferida");
  if (termos.includes("Vômitos") || termos.includes("Diarreia")) pendentes.push("Frequência dos episódios e sinais de desidratação");
  pendentes.push("Sinais vitais (PA, FC, FR, temperatura, SpO₂)");
  pendentes.push("Comorbidades e medicações em uso");

  const partes = [];
  if (principal) partes.push(`Paciente relata ${principal.termo_tecnico.toLowerCase()}`);
  if (associados.length) partes.push(`associado a ${associados.map((a) => a.termo_tecnico.toLowerCase()).join(", ")}`);
  let resumo = partes.length ? partes.join(", ") + "." : "Nenhum sintoma reconhecido pelas regras locais.";
  if (inicio) resumo += ` Início: ${inicio.descricao}.`;
  if (intensidade) resumo += ` Intensidade relatada: ${intensidade.descricao}.`;
  if (negados.length) resumo += ` Nega: ${negados.map((n) => n.termo_tecnico.toLowerCase()).join(", ")}.`;

  return {
    sintoma_principal: principal,
    sintomas_associados: associados,
    negados,
    inicio,
    intensidade,
    informacoes_pendentes: pendentes,
    resumo_tecnico: resumo,
  };
}

/** Termos técnicos (não negados) de uma interpretação. */
export function termosDaInterpretacao(interp) {
  if (!interp) return [];
  return [interp.sintoma_principal, ...(interp.sintomas_associados ?? [])]
    .filter(Boolean)
    .map((x) => x.termo_tecnico);
}

/**
 * Recomenda o encaminhamento.
 * @param {object} p
 * @param {string} p.relato           texto livre
 * @param {object} [p.interpretacao]  saída da IA ou das regras locais
 * @param {Array}  [p.regras]         [{termo, nivel, ativa}] — padrão: regras originais
 * Ordem de decisão:
 *  1. Sinal de alerta não negado → avaliação imediata (emergência).
 *  2. Regras de palavras-chave: vale o nível de MAIOR complexidade encontrado
 *     (antes valia o primeiro encontrado, o que podia mandar "infarto e gripe" para a UBS).
 *  3. Sem correspondência → "indefinido": decisão do profissional.
 */
export function recomendar({ relato, interpretacao = null, regras = null }) {
  const listaRegras = (regras && regras.length ? regras : regrasOriginaisComoLista()).filter((r) => r.ativa !== false);
  const termos = termosDaInterpretacao(interpretacao);
  const textoBase = prepararTexto(relato);
  const textoTermos = prepararTexto(termos.join(" . "));

  const alertasRelato = detectarAlertas(relato);
  const alertasTermos = detectarAlertas(termos.join(" . "));
  const porId = new Map();
  for (const a of [...alertasRelato, ...alertasTermos]) {
    const atual = porId.get(a.id);
    // Se em algum lugar o alerta aparece sem negação, ele vale como positivo
    if (!atual || (atual.negado && !a.negado)) porId.set(a.id, a);
  }
  const alertas = [...porId.values()];
  const ativos = alertas.filter((a) => !a.negado);

  const correspondencias = [];
  for (const r of listaRegras) {
    const termo = normalizar(r.termo);
    if (!termo) continue;
    for (const [fonte, texto] of [["relato", textoBase], ["interpretação", textoTermos]]) {
      const i = texto.indexOf(termo);
      if (i >= 0 && !negadoAntes(texto, i)) {
        correspondencias.push({ termo: r.termo, nivel: r.nivel, origem: r.origem ?? "original", fonte });
        break;
      }
    }
  }

  const criterios = [];
  let nivel = "indefinido";

  if (ativos.length) {
    nivel = "emergencia";
    for (const a of ativos) criterios.push(`Sinal de alerta: ${a.rotulo} ("${a.trecho}") — avaliação imediata por profissional habilitado`);
  }
  for (const c of correspondencias) {
    if (nivel === "indefinido" || (nivel !== "emergencia" && PESO_NIVEL[c.nivel] > PESO_NIVEL[nivel])) nivel = c.nivel;
    const tipo = c.origem === "original" ? "Regra original" : "Regra complementar";
    criterios.push(`${tipo}: "${c.termo}" → ${ROTULO_NIVEL[c.nivel]} (encontrado no ${c.fonte})`);
  }
  if (nivel === "indefinido") {
    criterios.push("Nenhuma regra do protocolo corresponde ao relato — o destino depende da avaliação do profissional");
  }

  return {
    nivel,
    destino: NIVEL_DESTINO[nivel] ?? null,
    alertas,
    criterios,
    correspondencias,
  };
}

/** Complexidade de cada tipo de unidade (para otimização e economia). */
export const COMPLEXIDADE = { UBS: 1, UPA: 2, HOSPITAL: 3, EMERGENCIA: 3 };
