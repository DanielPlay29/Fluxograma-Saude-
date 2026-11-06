// Página inicial pública: o cidadão descreve (escrevendo ou falando) o sintoma e recebe a orientação.
import { detectarAlertas, interpretarLocalmente, recomendar } from "./core/triagem.js";
import { unidadesPublicas, regrasPublicas, interpretarPublico, registrarConsulta } from "./servicos/publico.js";
import { lerRegiao, salvarRegiao, unidadesDaRegiao, cidadesConhecidas, linkBuscaMapa, linkPertoDeMim } from "./regiao.js";
import { LOGO, icone } from "./ui/icones.js";
import { $, $$, esc } from "./ui/comum.js";

$("#marca").innerHTML = `${LOGO}<span><strong>FluxoSaúde</strong><small>Orientação de atendimento</small></span>`;

const PADRAO_DOC = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{15}\b/;
const TEXTO = {
  UBS: {
    titulo: "Procure uma UBS (posto de saúde)",
    texto: "Pelo que você contou, seu caso pode ser atendido na atenção primária. Vá ao posto de saúde mais próximo da sua casa, no horário de funcionamento.",
    depois: "Se os sintomas piorarem (falta de ar, dor muito forte, febre alta que não passa ou desmaio), procure o pronto-socorro do hospital ou ligue 192.",
  },
  UPA: {
    titulo: "Procure a UPA",
    texto: "Seu relato indica que você precisa de atendimento de urgência. A UPA funciona 24 horas por dia.",
    depois: "Se houver piora rápida, falta de ar intensa ou desmaio, vá ao pronto-socorro do hospital ou ligue 192.",
  },
  HOSPITAL: {
    titulo: "Procure o hospital",
    texto: "Seu relato indica uma condição que costuma precisar de atendimento hospitalar especializado.",
    depois: "Se não conseguir se locomover com segurança, ligue 192.",
  },
};

// Sinais de alerta → orientação de ida ao HOSPITAL (pronto-socorro).
// "samuPrimeiro": situações em que o mais seguro é chamar a ambulância, que
// leva ao hospital — mesmo assim o hospital é mostrado.
const ALERTA = {
  dificuldade_respiratoria: {
    texto: "Dificuldade para respirar precisa de avaliação rápida, com oxigênio e exames, que o pronto-socorro do hospital oferece. Vá agora ao hospital, de preferência com um acompanhante — não dirija com falta de ar.",
    depois: "Ligue 192 se a falta de ar for forte, se os lábios ou as unhas ficarem roxos, se a pessoa não conseguir falar frases inteiras ou ficar sonolenta ou confusa. A ambulância leva direto ao hospital.",
  },
  dor_toracica: {
    texto: "Dor ou aperto no peito precisa de eletrocardiograma e avaliação médica imediata no pronto-socorro do hospital. Não vá dirigindo.",
    depois: "Se a dor for forte, durar mais de alguns minutos, vier com suor frio, falta de ar ou for para o braço, pescoço ou mandíbula, ligue 192 agora.",
    samuPrimeiro: true,
  },
  sinais_avc: {
    texto: "Boca torta, fala enrolada ou fraqueza de um lado do corpo podem ser AVC. O tratamento só funciona nas primeiras horas, no hospital.",
    depois: "Ligue 192 agora e anote o horário em que os sinais começaram. Não dê comida, bebida ou remédio.",
    samuPrimeiro: true,
  },
  rebaixamento_consciencia: {
    texto: "Desmaio ou confusão precisam de avaliação imediata no pronto-socorro do hospital.",
    depois: "Se a pessoa não acordar, não responder ou respirar com dificuldade, ligue 192 agora e deite-a de lado.",
    samuPrimeiro: true,
  },
  convulsao: {
    texto: "Uma convulsão precisa de avaliação no pronto-socorro do hospital.",
    depois: "Durante a crise, afaste objetos, não coloque nada na boca e vire a pessoa de lado. Se durar mais de 5 minutos ou se repetir, ligue 192.",
    samuPrimeiro: true,
  },
  hemorragia: {
    texto: "Sangramento importante precisa de atendimento imediato no pronto-socorro do hospital.",
    depois: "Pressione o local com um pano limpo. Se o sangramento não parar, ou houver tontura ou desmaio, ligue 192.",
  },
  trauma_grave: {
    texto: "Acidentes e ferimentos graves devem ser atendidos no pronto-socorro do hospital.",
    depois: "Não mova a pessoa se houver suspeita de lesão na coluna. Ligue 192 (SAMU) ou 193 (Bombeiros).",
    samuPrimeiro: true,
  },
  anafilaxia: {
    texto: "Inchaço na boca, língua ou garganta pode fechar a passagem do ar. É preciso atendimento imediato no pronto-socorro do hospital.",
    depois: "Se houver dificuldade para respirar ou engolir, ligue 192 agora.",
    samuPrimeiro: true,
  },
  risco_suicidio: {
    texto: "Você não precisa passar por isso sozinho(a). Se houver risco agora, vá ao pronto-socorro do hospital com alguém de confiança ou ligue 192.",
    depois: "Para conversar a qualquer hora, ligue 188 (CVV) — gratuito, 24 horas.",
    extra: '<a class="btn pub-btn-sec" href="tel:188">Ligar 188 (CVV)</a>',
  },
  intoxicacao: {
    texto: "Intoxicação ou ingestão de remédios em excesso precisa de avaliação imediata no pronto-socorro do hospital. Leve a embalagem do produto.",
    depois: "Não provoque vômito. Orientação: Disque-Intoxicação 0800 722 6001. Se a pessoa ficar sonolenta ou com falta de ar, ligue 192.",
    extra: '<a class="btn pub-btn-sec" href="tel:08007226001">Disque-Intoxicação</a>',
  },
};

const form = $("#form");
const relatoEl = $("#relato");
const resultado = $("#resultado");
const unidadesP = unidadesPublicas();
const regrasP = regrasPublicas();
let regiao = lerRegiao();
let ultimo = null; // último resultado mostrado (para re-renderizar ao trocar a região)
let voltarComResultado = false;

// ---------- Região ----------
function mostrarRegiao() {
  $("#regiao-atual").innerHTML = `${icone("local")} Sua região: <strong>${esc(regiao)}</strong>`;
}
mostrarRegiao();
unidadesP.then((u) => {
  $("#regiao-lista").innerHTML = cidadesConhecidas(u).map((c) => `<option value="${esc(c)}">`).join("");
});
function abrirEditorRegiao(abrir) {
  const ed = $("#regiao-editor");
  const aberto = abrir ?? ed.classList.contains("oculto");
  ed.classList.toggle("oculto", !aberto);
  $("#btn-regiao").setAttribute("aria-expanded", String(aberto));
  if (aberto) { $("#regiao-entrada").value = regiao; $("#regiao-entrada").focus(); $("#regiao-entrada").select(); }
}
function trocarRegiao(nova) {
  nova = nova.trim().replace(/\s+/g, " ");
  if (nova.length < 2) return;
  regiao = nova;
  salvarRegiao(regiao);
  mostrarRegiao();
  abrirEditorRegiao(false);
  if (ultimo && voltarComResultado) { voltarComResultado = false; form.classList.add("oculto"); mostrar(ultimo); }
}
$("#btn-regiao").addEventListener("click", () => abrirEditorRegiao());
$("#regiao-salvar").addEventListener("click", () => trocarRegiao($("#regiao-entrada").value));
$("#regiao-entrada").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); trocarRegiao(e.target.value); }
  if (e.key === "Escape") abrirEditorRegiao(false);
});

// ---------- Avisos enquanto digita ----------
function atualizarAvisos() {
  $("#contador").textContent = relatoEl.value.length;
  const ativos = detectarAlertas(relatoEl.value).filter((a) => !a.negado);
  let h = "";
  if (PADRAO_DOC.test(relatoEl.value)) {
    h += `<div class="aviso aviso-erro" role="alert">${icone("alerta")}<div><strong>Não informe documentos</strong><p>Apague o número de CPF ou Cartão SUS. Não precisamos dele.</p></div></div>`;
  }
  if (ativos.length) {
    h += `<div class="alerta-critico" role="alert">${icone("HOSPITAL")}<div><h3>Procure o hospital</h3>
      <p>${esc(ativos.map((a) => a.rotulo).join(", "))} precisa de avaliação no pronto-socorro do hospital. Toque em <strong>Ver onde ser atendido</strong> para ver o endereço. Se estiver forte ou piorando, <a href="tel:192"><strong>ligue 192</strong></a>.</p></div></div>`;
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

// ---------- Falar em vez de escrever (Web Speech API) ----------
(function configurarVoz() {
  const caixa = $("#voz");
  const btn = $("#btn-falar");
  const status = $("#voz-status");
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
  caixa.classList.remove("oculto");
  const pronto = () => {
    $("#falar-icone").innerHTML = icone("microfone");
    $("#falar-texto").textContent = "Prefere falar? Toque aqui e diga o que sente";
    btn.setAttribute("aria-pressed", "false");
    btn.classList.remove("gravando");
  };
  pronto();

  if (!Reconhecimento || !window.isSecureContext) {
    btn.disabled = true;
    $("#falar-texto").textContent = "Falar não está disponível neste navegador";
    status.textContent = "Dica: no celular, toque no microfone do teclado para ditar. No computador, use o Chrome ou o Edge.";
    return;
  }

  let rec = null;
  let base = "";       // texto que já estava escrito antes de começar a falar
  let finalizado = ""; // trechos já reconhecidos nesta gravação
  let ouvindo = false;

  const juntar = (...partes) => partes.map((p) => p.trim()).filter(Boolean).join(" ").slice(0, 1000);

  function parar() { if (rec && ouvindo) rec.stop(); }

  function iniciar() {
    rec = new Reconhecimento();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    base = relatoEl.value;
    finalizado = "";

    rec.onstart = () => {
      ouvindo = true;
      btn.classList.add("gravando");
      btn.setAttribute("aria-pressed", "true");
      $("#falar-icone").innerHTML = icone("parar");
      $("#falar-texto").textContent = "Ouvindo… toque para parar";
      status.textContent = "Pode falar. O texto aparece no campo acima e você pode corrigir antes de enviar.";
    };
    rec.onresult = (e) => {
      let provisorio = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalizado = juntar(finalizado, t);
        else provisorio += t;
      }
      relatoEl.value = juntar(base, finalizado, provisorio);
      $("#contador").textContent = relatoEl.value.length;
    };
    rec.onerror = (e) => {
      const msg = {
        "not-allowed": "Permita o uso do microfone para falar (ícone de cadeado ao lado do endereço do site).",
        "service-not-allowed": "Permita o uso do microfone para falar (ícone de cadeado ao lado do endereço do site).",
        "no-speech": "Não ouvimos nada. Toque de novo e fale perto do microfone.",
        "audio-capture": "Nenhum microfone encontrado neste aparelho.",
        network: "Sem conexão para reconhecer a fala. Tente de novo ou escreva.",
      }[e.error];
      if (msg) status.textContent = msg;
    };
    rec.onend = () => {
      ouvindo = false;
      relatoEl.value = juntar(base, finalizado);
      pronto();
      if (finalizado && !/microfone|ouvimos|conexão/.test(status.textContent)) status.textContent = "Pronto! Confira o texto e toque em “Ver onde ser atendido”.";
      atualizarAvisos();
    };
    try { rec.start(); } catch { status.textContent = "Não foi possível usar o microfone agora. Tente de novo."; }
  }

  btn.addEventListener("click", () => (ouvindo ? parar() : iniciar()));
  form.addEventListener("submit", parar);
})();

// ---------- Consulta ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const relato = relatoEl.value.trim();
  if (relato.length < 3) {
    relatoEl.setAttribute("aria-invalid", "true");
    relatoEl.focus();
    $("#alertas").innerHTML = `<div class="aviso aviso-atencao">${icone("info")}<div><p>Conte com algumas palavras (escrevendo ou falando) o que você está sentindo.</p></div></div>`;
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

/** Texto do resultado. Sinal de alerta → orientação de ida ao hospital. */
function orientacao(r) {
  if (r.destino !== "EMERGENCIA") return { ...TEXTO[r.destino], local: r.destino, samuPrimeiro: false };
  const ativos = r.alertas.filter((a) => !a.negado);
  const cfg = ativos.map((a) => ALERTA[a.id]).filter(Boolean);
  const principal = cfg[0] ?? {};
  const samuPrimeiro = cfg.some((c) => c.samuPrimeiro);
  return {
    titulo: samuPrimeiro ? "Ligue 192 ou vá agora ao hospital" : "Vá agora ao hospital (pronto-socorro)",
    texto: principal.texto ?? "Seu relato tem sinal(is) que podem indicar uma situação grave. Vá agora ao pronto-socorro do hospital mais próximo.",
    depois: principal.depois ?? "Se não conseguir ir com segurança, ligue 192: a ambulância leva ao hospital.",
    extra: cfg.map((c) => c.extra).filter(Boolean).join(""),
    rotulos: ativos.map((a) => a.rotulo),
    local: "HOSPITAL",
    samuPrimeiro,
  };
}

const mapa = (u) => {
  const q = u.latitude && u.longitude ? `${u.latitude},${u.longitude}` : encodeURIComponent(`${u.nome}, ${u.endereco ?? ""}, ${u.cidade ?? ""}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
};
const tel = (t) => String(t).replace(/\D/g, "");

function cartaoLocal(u, { destaque = false } = {}) {
  return `<div class="pub-local${destaque ? " pub-local-destaque" : ""}">
    <strong>${esc(u.nome)}</strong>
    ${u.endereco ? `<span>${icone("local")} ${esc(u.endereco)}${u.cidade ? ` · ${esc(u.cidade)}` : ""}</span>` : ""}
    ${u.servicos ? `<small class="pub-local-nota">${esc(u.servicos)}</small>` : ""}
    <div class="pub-local-acoes">
      ${u.tipo !== "EMERGENCIA" ? `<a class="btn ${destaque ? "btn-primario" : "btn-secundario"} btn-sm" href="${mapa(u)}" target="_blank" rel="noopener">Como chegar</a>` : ""}
      ${u.telefone ? `<a class="btn btn-secundario btn-sm" href="tel:${esc(tel(u.telefone))}">Ligar ${esc(u.telefone)}</a>` : ""}
      ${u.pagina_publica ? `<a class="btn btn-fantasma btn-sm" href="${esc(u.pagina_publica)}">Mais informações</a>` : ""}
    </div></div>`;
}

async function mostrar(dados) {
  ultimo = dados;
  const { interp, fonte, r } = dados;
  const t = orientacao(r);
  const emergencia = r.destino === "EMERGENCIA";
  const todas = unidadesDaRegiao(await unidadesP, regiao);
  const hospitais = todas.filter((u) => u.tipo === "HOSPITAL" && (!emergencia || u.pronto_socorro !== false));
  const upas = todas.filter((u) => u.tipo === "UPA");
  const samu = todas.find((u) => u.tipo === "EMERGENCIA");
  const doTipo = emergencia ? hospitais : todas.filter((u) => u.tipo === r.destino);
  const pendentes = (interp.informacoes_pendentes ?? []).filter((p) => !/sinais vitais|comorbidades/i.test(p)).slice(0, 4);
  const hospitalPrincipal = emergencia ? hospitais[0] : null;

  const listaPrincipal = doTipo.length
    ? `<div class="pub-locais">${doTipo.map((u, i) => cartaoLocal(u, { destaque: emergencia && i === 0 })).join("")}</div>`
    : `<p class="pub-sem-cadastro">Ainda não temos ${emergencia || r.destino === "HOSPITAL" ? "hospitais" : r.destino === "UPA" ? "UPAs" : "UBS"} cadastrados em <strong>${esc(regiao)}</strong>.</p>`;
  const buscaTipo = emergencia ? "HOSPITAL" : r.destino;

  resultado.innerHTML = `
    <div class="pub-resultado pub-${esc(r.destino)}">
      <div class="pub-resultado-cab">
        <span class="pub-resultado-icone">${icone(t.local)}</span>
        <div><span class="pub-resultado-rotulo">Nossa orientação${t.rotulos?.length ? ` · ${esc(t.rotulos.join(", "))}` : ""}</span><h2>${esc(t.titulo)}</h2></div>
      </div>
      <p class="pub-resultado-texto">${esc(t.texto)}</p>
      ${emergencia ? `<div class="pub-resultado-acoes">
          ${t.samuPrimeiro ? '<a class="btn pub-btn-192" href="tel:192">Ligar 192 agora</a>' : ""}
          ${hospitalPrincipal ? `<a class="btn ${t.samuPrimeiro ? "pub-btn-sec" : "pub-btn-192"}" href="${mapa(hospitalPrincipal)}" target="_blank" rel="noopener">${icone("local")} Ir ao ${esc(hospitalPrincipal.nome)}</a>` : `<a class="btn ${t.samuPrimeiro ? "pub-btn-sec" : "pub-btn-192"}" href="${linkBuscaMapa("HOSPITAL", regiao)}" target="_blank" rel="noopener">${icone("local")} Hospitais em ${esc(regiao)}</a>`}
          ${t.samuPrimeiro ? "" : '<a class="btn pub-btn-sec pub-btn-192-sec" href="tel:192">Ligar 192</a>'}
          ${t.extra}
        </div>` : ""}
      <p class="pub-depois">${icone("info")} ${esc(t.depois)}</p>
    </div>

    <div class="grade grade-2">
      <div class="card pub-onde">
        <div class="card-cab"><div><h3>${emergencia ? "Hospital com pronto-socorro" : "Onde ir"}</h3>
          <p class="pub-regiao-linha">${icone("local")} ${esc(regiao)} · <button type="button" class="pub-link" id="res-regiao">alterar região</button></p></div></div>
        ${listaPrincipal}
        ${emergencia && upas.length ? `<p class="rotulo pub-subtitulo">UPAs 24 horas — também atendem urgências e transferem ao hospital</p>
          <div class="pub-locais">${upas.map((u) => cartaoLocal(u)).join("")}</div>` : ""}
        ${emergencia && samu ? `<p class="rotulo pub-subtitulo">Ambulância</p><div class="pub-locais">${cartaoLocal(samu)}</div>` : ""}
        <p class="pub-busca-mapa">
          <a href="${linkPertoDeMim(buscaTipo)}" target="_blank" rel="noopener">Ver no mapa perto de mim</a> ·
          <a href="${linkBuscaMapa(buscaTipo, regiao)}" target="_blank" rel="noopener">Buscar em ${esc(regiao)}</a>
        </p>
      </div>
      <div class="card">
        <div class="card-cab"><div><h3>O que entendemos do seu relato</h3></div>
          <span class="tag ${fonte === "ia" ? "tag-ia" : "tag-neutra"}">${fonte === "ia" ? "Interpretado com IA" : "Interpretação automática"}</span></div>
        <p class="resumo-tecnico">${esc(interp.resumo_tecnico)}</p>
        ${pendentes.length ? `<p class="rotulo" style="margin-top:14px">Ao ser atendido(a), vale informar:</p><ul class="lista-criterios">${pendentes.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      </div>
    </div>
    <p class="pub-aviso">Esta é uma orientação automática e não substitui a avaliação de um profissional de saúde. Ao chegar à unidade, você passará pelo acolhimento da equipe.</p>
    <div style="display:flex;justify-content:center"><button class="btn btn-secundario" id="nova">Fazer outra consulta</button></div>`;
  resultado.classList.remove("oculto");
  form.classList.add("oculto");
  resultado.focus();
  resultado.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#res-regiao").addEventListener("click", () => {
    // Abre o seletor no formulário; ao salvar, o resultado volta com as unidades da nova cidade
    voltarComResultado = true;
    resultado.classList.add("oculto");
    form.classList.remove("oculto");
    abrirEditorRegiao(true);
    $("#regiao-barra").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#nova").addEventListener("click", () => {
    ultimo = null;
    voltarComResultado = false;
    resultado.classList.add("oculto");
    form.classList.remove("oculto");
    form.reset();
    relatoEl.value = "";
    atualizarAvisos();
    relatoEl.focus();
  });
}
