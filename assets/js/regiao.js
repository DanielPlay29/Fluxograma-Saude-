// =====================================================================
// Região do cidadão (cidade onde ele procura atendimento)
//  - Região padrão: CONFIG.REGIAO_PADRAO (Uberaba - MG).
//  - O visitante pode trocar a região; a escolha fica salva no navegador.
//  - As unidades vêm do banco (tabela "unidades", campo "cidade"). Quando o
//    banco ainda não tem unidades de um tipo para a região, usamos a lista
//    embutida abaixo (Uberaba). Se nem assim houver, mostramos busca no mapa.
// =====================================================================
import { CONFIG } from "./config.js";
import { normalizar } from "./core/triagem.js";

export const REGIAO_PADRAO = CONFIG.REGIAO_PADRAO || "Uberaba - MG";

export const REGIOES_SUGERIDAS = [
  "Uberaba - MG", "Uberlândia - MG", "Araxá - MG", "Frutal - MG", "Conceição das Alagoas - MG",
  "Sacramento - MG", "Patos de Minas - MG", "Belo Horizonte - MG",
];

// Fontes (consultadas em nov/2026): Prefeitura de Uberaba (lista de UPAs),
// gov.br (Unidade de Urgência e Emergência do HC-UFTM). Confira com a
// Secretaria Municipal de Saúde antes de usar em produção.
export const UNIDADES_EMBUTIDAS = [
  {
    nome: "Pronto-Socorro do Hospital de Clínicas da UFTM",
    tipo: "HOSPITAL", cidade: "Uberaba - MG",
    endereco: "Rua Frei Paulino, s/nº – Abadia",
    telefone: "(34) 3318-5160",
    servicos: "Pronto-socorro hospitalar de referência da região, 24 horas. Casos graves chegam principalmente pelo SAMU (192), pelos Bombeiros ou encaminhados pela UPA.",
    pronto_socorro: true,
  },
  {
    nome: "Hospital Regional José Alencar",
    tipo: "HOSPITAL", cidade: "Uberaba - MG",
    endereco: "Av. Edelweiss Teixeira, 101 – Mercês",
    telefone: null,
    servicos: "Hospital 100% SUS. Internações e atendimentos encaminhados pela rede (regulação).",
    pronto_socorro: false,
  },
  {
    nome: "UPA São Benedito",
    tipo: "UPA", cidade: "Uberaba - MG",
    endereco: "Rua Major Eustáquio, 1030 – São Benedito",
    telefone: "(34) 3313-5962",
    servicos: "Urgência e emergência 24 horas, com classificação de risco. Estabiliza e transfere ao hospital quando necessário.",
  },
  {
    nome: "UPA Mirante (Dr. Humberto Ferreira)",
    tipo: "UPA", cidade: "Uberaba - MG",
    endereco: "Av. Leopoldino de Oliveira, 534 – Parque do Mirante",
    telefone: "(34) 3317-3268",
    servicos: "Urgência e emergência 24 horas, com classificação de risco. Estabiliza e transfere ao hospital quando necessário.",
  },
];

const SAMU = {
  nome: "SAMU 192 – Ambulância", tipo: "EMERGENCIA", cidade: null, endereco: null, telefone: "192",
  servicos: "Atendimento móvel de urgência. A ligação é gratuita e a ambulância leva ao hospital de referência.",
};

const CHAVE = "fluxosaude.regiao";

export function lerRegiao() {
  try { return localStorage.getItem(CHAVE) || REGIAO_PADRAO; } catch { return REGIAO_PADRAO; }
}
export function salvarRegiao(regiao) {
  try { localStorage.setItem(CHAVE, regiao); } catch { /* navegador sem armazenamento: vale só nesta visita */ }
}

/** "Uberaba - MG", "uberaba/mg", "Uberaba" → "uberaba" */
function cidadeChave(texto) {
  return normalizar(String(texto ?? "").split(/\s[-–]\s|\/|,/)[0]);
}
export function mesmaCidade(a, b) {
  const x = cidadeChave(a), y = cidadeChave(b);
  return Boolean(x && y && x === y);
}

/**
 * Unidades da região, por tipo: as do banco têm prioridade; se o banco não
 * tem nenhuma daquele tipo na cidade, usa a lista embutida. SAMU sempre aparece.
 */
export function unidadesDaRegiao(doBanco, regiao) {
  const banco = (doBanco ?? []).filter((u) => mesmaCidade(u.cidade, regiao));
  const embutidas = UNIDADES_EMBUTIDAS.filter((u) => mesmaCidade(u.cidade, regiao));
  const tipos = ["HOSPITAL", "UPA", "UBS"];
  const lista = tipos.flatMap((t) => {
    const b = banco.filter((u) => u.tipo === t);
    return b.length ? b : embutidas.filter((u) => u.tipo === t);
  });
  const samu = banco.find((u) => u.tipo === "EMERGENCIA") ?? SAMU;
  return [...lista, samu];
}

/** Lista de cidades para o seletor: sugeridas + as que existem no banco. */
export function cidadesConhecidas(doBanco) {
  const vistas = new Map();
  for (const c of [...REGIOES_SUGERIDAS, ...(doBanco ?? []).map((u) => u.cidade).filter(Boolean)]) {
    const k = cidadeChave(c);
    if (k && !vistas.has(k)) vistas.set(k, c);
  }
  return [...vistas.values()];
}

const BUSCA = {
  HOSPITAL: "hospital pronto-socorro",
  EMERGENCIA: "hospital pronto-socorro",
  UPA: "UPA 24 horas",
  UBS: "UBS posto de saúde",
};
/** Link do Google Maps para procurar unidades daquele tipo na região. */
export function linkBuscaMapa(tipo, regiao) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${BUSCA[tipo] ?? "unidade de saúde"} ${regiao}`)}`;
}
/** Link "perto de mim" (o Google usa a localização do aparelho, se permitida). */
export function linkPertoDeMim(tipo) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${BUSCA[tipo] ?? "unidade de saúde"} perto de mim`)}`;
}
