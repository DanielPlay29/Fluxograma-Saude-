// Página inicial pública: o cidadão descreve o sintoma e recebe a orientação.
import { detectarAlertas, interpretarLocalmente, recomendar } from "./core/triagem.js";
import { unidadesPublicas, regrasPublicas, interpretarPublico, registrarConsulta } from "./servicos/publico.js";
import { LOGO, icone } from "./ui/icones.js";
import { $, $$, esc } from "./ui/comum.js";

$("#marca").innerHTML = `${LOGO}<span><strong>FluxoSaúde</strong><small>Orientação de atendimento</small></span>`;

const PADRAO_DOC = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{15}\b/;
const PAGINA = { UBS: "UBS.html", UPA: "UPA.html", HOSPITAL: "Hospital.html" };
const TEXTO = {
  UBS: {
    titulo: "Procure uma UBS (posto de saúde)",
    texto: "Pelo que você contou, seu caso pode ser atendido na atenção primária. Vá ao posto de saúde mais próximo da sua casa, no horário de funcionamento.",
    depois: "Se os sintomas piorarem (falta de ar, dor muito forte, febre alta que não passa ou desmaio), procure a UPA ou ligue 192.",
  },
  UPA: {
    titulo: "Procure a UPA",
    texto: "Seu relato indica que você precisa de atendimento de urgência. A UPA funciona 24 horas por dia.",
    depois: "Se houver piora rápida, falta de ar intensa ou desmaio, ligue 192.",
  },
  HOSPITAL: {
    titulo: "Procure o hospital",
    texto: "Seu relato indica uma condição que costuma precisar de atendimento hospitalar especializado.",
    depois: "Se não conseguir se locomover com segurança, ligue 192.",
  },
  EMERGENCIA: {
    titulo: "Procure atendimento de emergência agora",
    texto: "Seu relato tem sinal(is) que podem indicar uma situação grave. Não espere: ligue 192 (SAMU) ou vá imediatamente ao pronto-socorro mais próximo.",
    depois: "Se estiver sozinho(a), peça ajuda a alguém próximo enquanto aguarda o atendimento.",
  },
};

const form = $("#form");
const relatoEl = $("#relato");
const resultado = $("#resultado");
const unidadesP = unidadesPublicas();
const regrasP = regrasPublicas();

// ---------- Avisos enquanto digita ----------
function atualizarAvisos() {
  $("#contador").textContent = relatoEl.value.length;
  const ativos = detectarAlertas(relatoEl.value).filter((a) => !a.negado);
  let h = "";
  if (PADRAO_DOC.test(relatoEl.value)) {
    h += `<div class="aviso aviso-erro" role="alert">${icone("alerta")}<div><strong>Não informe documentos</strong><p>Apague o número de CPF ou Cartão SUS. Não precisamos dele.</p></div></div>`;
  }
  if (ativos.length) {
    h += `<div class="alerta-critico" role="alert">${icone("alerta")}<div><h3>Isso pode ser grave</h3>
      <p>${esc(ativos.map((a) => a.rotulo).join(", "))}. Se estiver acontecendo agora, <a href="tel:192"><strong>ligue 192</strong></a> ou vá ao pronto-socorro mais próximo.</p></div></div>`;
  }
  $("#alertas").innerHTML = h;
}
let tempo;
relatoEl.addEventListener("input", () => { clearTimeout(tempo); tempo = setTimeout(atualizarAvisos, 200); });
$$("[data-exemplo]").forEach((b) => b.addEventListener("click", () => {
  relatoEl.value = b.dataset.exemplo;
  atualizarAvisos();
  relatoEl.focus();
}));

// ---------- Consulta ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const relato = relatoEl.value.trim();
  if (relato.length < 3) {
    relatoEl.setAttribute("aria-invalid", "true");
    relatoEl.focus();
    $("#alertas").innerHTML = `<div class="aviso aviso-atencao">${icone("info")}<div><p>Conte com algumas palavras o que você está sentindo.</p></div></div>`;
    return;
  }
  if (PADRAO_DOC.test(relato)) { atualizarAvisos(); return; }
  relatoEl.removeAttribute("aria-invalid");

  const btn = $("#btn-enviar");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Analisando seu relato…';

  const regras = await regrasP;
  // Sinais de alerta: resposta imediata, sem esperar a IA
  let interp = interpretarLocalmente(relato);
  let fonte = "regras";
  let r = recomendar({ relato, interpretacao: interp, regras });
  if (r.nivel !== "emergencia") {
    const ia = await interpretarPublico(relato);
    if (ia) {
      interp = ia.interpretacao;
      fonte = "ia";
      r = recomendar({ relato, interpretacao: interp, regras });
    }
  }
  if (r.nivel === "indefinido") {
    r.destino = "UBS";
    r.criterios = [...r.criterios, "Orientação padrão: a UBS é a porta de entrada do SUS para avaliação inicial"];
  }

  btn.disabled = false;
  btn.textContent = "Ver onde ser atendido";
  await mostrar({ relato, interp, fonte, r });

  registrarConsulta({
    relato,
    faixaEtaria: form.faixa.value,
    intencao: form.querySelector("[name=intencao]:checked")?.value,
    interpretacao: interp,
    fonte,
    alertas: r.alertas.filter((a) => !a.negado).map((a) => a.rotulo),
    nivel: r.nivel,
    destino: r.destino,
    criterios: r.criterios,
  });
});

async function mostrar({ interp, fonte, r }) {
  const t = TEXTO[r.destino];
  const unidades = await unidadesP;
  const locais = r.destino === "EMERGENCIA"
    ? unidades.filter((u) => ["EMERGENCIA", "UPA", "HOSPITAL"].includes(u.tipo))
    : unidades.filter((u) => u.tipo === r.destino);
  const pendentes = (interp.informacoes_pendentes ?? []).filter((p) => !/sinais vitais|comorbidades/i.test(p)).slice(0, 4);
  const mapa = (u) => {
    const q = u.latitude && u.longitude ? `${u.latitude},${u.longitude}` : encodeURIComponent(`${u.nome} ${u.endereco ?? ""} ${u.cidade ?? ""}`);
    return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  };

  resultado.innerHTML = `
    <div class="pub-resultado pub-${esc(r.destino)}">
      <div class="pub-resultado-cab">
        <span class="pub-resultado-icone">${icone(r.destino)}</span>
        <div><span class="pub-resultado-rotulo">Nossa orientação</span><h2>${esc(t.titulo)}</h2></div>
      </div>
      <p class="pub-resultado-texto">${esc(t.texto)}</p>
      ${r.destino === "EMERGENCIA" ? '<a class="btn pub-btn-192" href="tel:192">Ligar 192 agora</a>' : ""}
      <p class="pub-depois">${icone("info")} ${esc(t.depois)}</p>
    </div>

    <div class="grade grade-2">
      <div class="card">
        <div class="card-cab"><div><h3>O que entendemos do seu relato</h3></div>
          <span class="tag ${fonte === "ia" ? "tag-ia" : "tag-neutra"}">${fonte === "ia" ? "Interpretado com IA" : "Interpretação automática"}</span></div>
        <p class="resumo-tecnico">${esc(interp.resumo_tecnico)}</p>
        ${pendentes.length ? `<p class="rotulo" style="margin-top:14px">Ao ser atendido(a), vale informar:</p><ul class="lista-criterios">${pendentes.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="card">
        <div class="card-cab"><div><h3>${r.destino === "EMERGENCIA" ? "Serviços de urgência e emergência" : "Onde ir"}</h3></div></div>
        ${locais.length ? `<div class="pub-locais">${locais.map((u) => `<div class="pub-local">
            <strong>${esc(u.nome)}</strong>
            ${u.endereco ? `<span>${esc(u.endereco)}${u.cidade ? ` · ${esc(u.cidade)}` : ""}</span>` : ""}
            <div class="pub-local-acoes">
              ${u.telefone ? `<a class="btn btn-secundario btn-sm" href="tel:${esc(u.telefone.replace(/\D/g, ""))}">Ligar ${esc(u.telefone)}</a>` : ""}
              ${u.endereco || u.latitude ? `<a class="btn btn-secundario btn-sm" href="${mapa(u)}" target="_blank" rel="noopener">Como chegar</a>` : ""}
              ${u.pagina_publica ? `<a class="btn btn-fantasma btn-sm" href="${esc(u.pagina_publica)}">Mais informações</a>` : ""}
            </div></div>`).join("")}</div>`
          : `<p>${PAGINA[r.destino] ? `<a class="btn btn-secundario" href="${PAGINA[r.destino]}">Ver endereços e mapa</a>` : '<a class="btn btn-secundario" href="tel:192">Ligar 192</a>'}</p>`}
      </div>
    </div>
    <p class="pub-aviso">Esta é uma orientação automática e não substitui a avaliação de um profissional de saúde. Ao chegar à unidade, você passará pelo acolhimento da equipe.</p>
    <div style="display:flex;justify-content:center"><button class="btn btn-secundario" id="nova">Fazer outra consulta</button></div>`;
  resultado.classList.remove("oculto");
  form.classList.add("oculto");
  resultado.focus();
  resultado.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#nova").addEventListener("click", () => {
    resultado.classList.add("oculto");
    form.classList.remove("oculto");
    form.reset();
    relatoEl.value = "";
    atualizarAvisos();
    relatoEl.focus();
  });
}
