import { detectarAlertas, interpretarLocalmente, recomendar, ROTULO_NIVEL, ROTULO_DESTINO } from "../core/triagem.js";
import { interpretarComIA, listarRegras, salvarAtendimento } from "../servicos/dados.js";
import { icone } from "../ui/icones.js";
import {
  esc, $, $$, aviso, toast, tagDestino, ROTULO_TIPO_ATENDIMENTO, ROTULO_FAIXA, ROTULO_RESULTADO, ROTULO_TIPO_CURTO,
} from "../ui/comum.js";

export const subtitulo = "Registro do relato, interpretação e encaminhamento";

const PADRAO_DOC = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{15}\b/; // CPF ou Cartão SUS
const DESC_DESTINO = {
  UBS: "Atenção primária, acompanhamento e prevenção",
  UPA: "Urgência de média complexidade",
  HOSPITAL: "Alta complexidade e internação",
  EMERGENCIA: "SAMU 192 / pronto-socorro",
};

export async function render(el, ctx) {
  if (!ctx.unidades.length) {
    el.innerHTML = aviso("atencao", "Nenhuma unidade de saúde cadastrada", '<p>Um administrador precisa cadastrar as unidades em <a href="#/configuracoes">Configurações</a>.</p>');
    return;
  }
  let regras = [];
  try { regras = await listarRegras({ somenteAtivas: true }); } catch (e) { toast(e.message, "erro"); }

  const estado = { interpretacao: null, fonte: null, iaId: null, modelo: null, relatoInterpretado: null, rec: null };
  const minhaUnidade = ctx.perfil.unidade_id && ctx.unidades.some((u) => u.id === ctx.perfil.unidade_id) ? ctx.perfil.unidade_id : "";

  el.innerHTML = `
    <div class="passos" aria-label="Etapas">
      <span class="passo ativo" data-passo="1"><b>1</b>Relato</span>
      <span class="passo" data-passo="2"><b>2</b>Interpretação</span>
      <span class="passo" data-passo="3"><b>3</b>Encaminhamento</span>
    </div>
    <div id="sucesso"></div>
    <form id="form-atend" class="grade" novalidate>
      <div class="card">
        <div class="card-cab"><div><h3>Dados do atendimento</h3><p>Não registre nome, CPF ou Cartão SUS do paciente (LGPD — minimização de dados).</p></div></div>
        <div class="grade-form">
          <label class="campo"><span>Unidade de atendimento (origem) *</span>
            <select class="entrada" name="unidade_origem_id" required>
              <option value="">Selecione…</option>
              ${ctx.unidades.filter((u) => u.tipo !== "EMERGENCIA").map((u) => `<option value="${esc(u.id)}" data-tipo="${esc(u.tipo)}" ${u.id === minhaUnidade ? "selected" : ""}>${esc(u.nome)} (${esc(ROTULO_TIPO_CURTO[u.tipo])})</option>`).join("")}
            </select></label>
          <label class="campo"><span>Tipo de atendimento</span>
            <select class="entrada" name="tipo_atendimento">${Object.entries(ROTULO_TIPO_ATENDIMENTO).map(([v, r]) => `<option value="${v}">${r}</option>`).join("")}</select></label>
          <label class="campo"><span>Faixa etária</span>
            <select class="entrada" name="faixa_etaria">${Object.entries(ROTULO_FAIXA).map(([v, r]) => `<option value="${v}" ${v === "nao_informada" ? "selected" : ""}>${r}</option>`).join("")}</select></label>
          <label class="campo"><span>Código do paciente (opcional)</span>
            <input class="entrada" name="codigo_paciente" maxlength="40" placeholder="Ex.: senha da recepção, nº do prontuário local" autocomplete="off">
            <small>Use um código interno. Nunca CPF ou nome.</small></label>
        </div>
      </div>

      <div class="card">
        <div class="card-cab"><div><h3>Relato dos sintomas</h3><p>Escreva como o paciente contou, com as palavras dele. A IA organiza em linguagem técnica.</p></div></div>
        <label class="campo"><span class="sr-only">Relato</span>
          <textarea class="entrada" name="relato" maxlength="2000" rows="5" required placeholder="Ex.: Paciente com dor nas costas desde ontem, tá com dificuldade de respirar."></textarea>
          <small><span id="contador">0</span>/2000</small></label>
        <div id="alertas" style="margin-top:12px" aria-live="assertive"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
          <button class="btn btn-primario" type="button" id="btn-interpretar">${icone("ia")} Interpretar relato</button>
          <span id="status-interp" class="carregando oculto"><span class="spinner"></span>Interpretando com IA…</span>
        </div>
      </div>

      <div id="bloco-interp" class="oculto"></div>
      <div id="bloco-decisao" class="oculto"></div>
    </form>`;

  const form = $("#form-atend", el);
  const relatoEl = form.relato;
  const alertasEl = $("#alertas", el);

  // ---------- Sinais de alerta em tempo real (sem esperar a IA) ----------
  let temporizador;
  const atualizarAlertas = () => {
    $("#contador", el).textContent = relatoEl.value.length;
    const doc = PADRAO_DOC.test(relatoEl.value) || PADRAO_DOC.test(form.codigo_paciente.value);
    const lista = detectarAlertas(relatoEl.value);
    const ativos = lista.filter((a) => !a.negado);
    const negados = lista.filter((a) => a.negado);
    let h = "";
    if (doc) h += aviso("erro", "Possível CPF ou Cartão SUS no texto", "<p>Remova números de documentos. O sistema não armazena dados que identifiquem o paciente.</p>");
    if (ativos.length) {
      h += `<div class="alerta-critico" role="alert">${icone("alerta")}<div>
        <h3>Avaliação imediata por profissional habilitado</h3>
        <p>O relato contém sinal(is) potencialmente grave(s). Não aguarde a interpretação da IA: acione a avaliação clínica conforme o protocolo da unidade${ativos.some((a) => a.id === "risco_suicidio") ? " (CVV 188 para apoio emocional)" : ""}. Em ambiente extra-hospitalar: SAMU 192.</p>
        <ul>${ativos.map((a) => `<li><strong>${esc(a.rotulo)}</strong> — “${esc(a.trecho)}”</li>`).join("")}</ul></div></div>`;
    }
    if (negados.length) {
      h += aviso("atencao", "Sinal mencionado com negação — confirme com o paciente", `<p>${negados.map((a) => `${esc(a.rotulo)} (“${esc(a.trecho)}”)`).join("; ")}</p>`);
    }
    alertasEl.innerHTML = h;
    marcarDesatualizado();
  };
  relatoEl.addEventListener("input", () => { clearTimeout(temporizador); temporizador = setTimeout(atualizarAlertas, 200); });
  form.codigo_paciente.addEventListener("input", atualizarAlertas);
  form.unidade_origem_id.addEventListener("change", () => estado.rec && desenharDecisao());

  function marcarDesatualizado() {
    const aviso2 = $("#aviso-desatualizado", el);
    if (estado.relatoInterpretado !== null && relatoEl.value.trim() !== estado.relatoInterpretado) {
      if (!aviso2) $("#bloco-interp", el).insertAdjacentHTML("afterbegin", `<div id="aviso-desatualizado">${aviso("atencao", "O relato mudou depois da interpretação", "<p>Interprete novamente antes de salvar.</p>")}</div>`);
      const b = $("#btn-salvar", el); if (b) b.disabled = true;
    } else if (aviso2) {
      aviso2.remove();
      const b = $("#btn-salvar", el); if (b) b.disabled = false;
    }
  }

  function passo(n) {
    $$(".passo", el).forEach((p) => {
      const k = Number(p.dataset.passo);
      p.classList.toggle("ativo", k === n);
      p.classList.toggle("feito", k < n);
    });
  }

  // ---------- Interpretação ----------
  $("#btn-interpretar", el).addEventListener("click", async () => {
    const relato = relatoEl.value.trim();
    if (relato.length < 3) { relatoEl.setAttribute("aria-invalid", "true"); relatoEl.focus(); return toast("Escreva o relato dos sintomas.", "erro"); }
    if (PADRAO_DOC.test(relato)) return toast("Remova CPF/Cartão SUS do relato antes de continuar.", "erro");
    relatoEl.removeAttribute("aria-invalid");
    const btn = $("#btn-interpretar", el);
    btn.disabled = true;
    $("#status-interp", el).classList.remove("oculto");
    let falhaIA = null;
    try {
      const r = await interpretarComIA(relato);
      Object.assign(estado, { interpretacao: r.interpretacao, fonte: "ia", iaId: r.id, modelo: r.modelo, descartados: r.descartados });
    } catch (e) {
      falhaIA = e.message;
      Object.assign(estado, { interpretacao: interpretarLocalmente(relato), fonte: "regras", iaId: null, modelo: null, descartados: 0 });
    } finally {
      btn.disabled = false;
      $("#status-interp", el).classList.add("oculto");
    }
    if (!ctx.ativo()) return;
    estado.relatoInterpretado = relato;
    estado.rec = recomendar({ relato, interpretacao: estado.interpretacao, regras });
    desenharInterpretacao(falhaIA);
    desenharDecisao();
    passo(3);
  });

  function itemTexto(i) {
    return i ? `${esc(i.termo_tecnico)} <span class="evidencia">— “${esc(i.trecho_original)}”</span>` : "—";
  }

  function desenharInterpretacao(falhaIA) {
    const i = estado.interpretacao;
    const bloco = $("#bloco-interp", el);
    bloco.classList.remove("oculto");
    const fonte = estado.fonte === "ia"
      ? `<span class="tag tag-ia">${icone("ia", 'width="13" height="13"')} IA · ${esc(estado.modelo)}</span>`
      : '<span class="tag tag-neutra">Regras locais (sem IA)</span>';
    bloco.innerHTML = `<div class="grade grade-2">
      <div class="card">
        <div class="card-cab"><div><h3>Interpretação do relato</h3><p>Organização das informações — não é diagnóstico.</p></div>${fonte}</div>
        ${falhaIA ? aviso("atencao", "IA indisponível", `<p>${esc(falhaIA)} Foi usada a interpretação por regras locais; revise com atenção.</p>`) : ""}
        ${estado.descartados ? aviso("info", "", `<p>${estado.descartados} item(ns) sugerido(s) pela IA foram descartados por não aparecerem no relato.</p>`) : ""}
        <p class="resumo-tecnico" style="margin:12px 0">${esc(i.resumo_tecnico)}</p>
        <dl class="interp">
          <div class="interp-linha"><dt>Sintoma principal</dt><dd>${itemTexto(i.sintoma_principal)}</dd></div>
          <div class="interp-linha"><dt>Sintomas associados</dt><dd>${i.sintomas_associados?.length ? i.sintomas_associados.map(itemTexto).join("<br>") : "—"}</dd></div>
          <div class="interp-linha"><dt>Início dos sintomas</dt><dd>${i.inicio ? `${esc(i.inicio.descricao)} <span class="evidencia">— “${esc(i.inicio.trecho_original)}”</span>` : '<span class="tag tag-atencao">Não informado</span>'}</dd></div>
          <div class="interp-linha"><dt>Intensidade</dt><dd>${i.intensidade ? esc(i.intensidade.descricao) : '<span class="tag tag-atencao">Não informada</span>'}</dd></div>
          ${i.negados?.length ? `<div class="interp-linha"><dt>Nega</dt><dd>${i.negados.map(itemTexto).join("<br>")}</dd></div>` : ""}
          <div class="interp-linha"><dt>Informações pendentes</dt><dd><ul class="lista-criterios">${(i.informacoes_pendentes ?? []).map((p) => `<li>${esc(p)}</li>`).join("") || "<li>—</li>"}</ul></dd></div>
        </dl>
        <div class="campo" style="margin-top:12px"><span>Complementar o relato</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><input class="entrada" id="complemento" style="flex:1 1 220px" placeholder="Ex.: dor nota 8, início há 2 horas, SpO₂ 94%">
          <button type="button" class="btn btn-secundario" id="btn-complementar">Adicionar e reinterpretar</button></div></div>
      </div>
      <div class="card">
        <div class="card-cab"><div><h3>Recomendação do protocolo</h3><p>Regras de encaminhamento cadastradas + sinais de alerta</p></div>
          ${estado.rec.destino ? tagDestino(estado.rec.destino) : '<span class="tag tag-neutra">Sem recomendação</span>'}</div>
        <p style="font-size:18px;font-weight:800;margin-bottom:4px">${esc(ROTULO_NIVEL[estado.rec.nivel])}</p>
        <p style="color:var(--texto-2);margin-bottom:12px">${estado.rec.destino ? `Destino recomendado: <strong>${esc(ROTULO_DESTINO[estado.rec.destino])}</strong>` : "Nenhuma regra corresponde: o destino é definido pelo profissional."}</p>
        <span class="rotulo">Critérios utilizados</span>
        <ul class="lista-criterios" style="margin-top:6px">${estado.rec.criterios.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <div style="margin-top:14px">${aviso("info", "", "<p>A recomendação apoia, mas não substitui, a avaliação profissional e os protocolos clínicos oficiais (ex.: classificação de risco). A decisão final é do profissional responsável.</p>")}</div>
      </div>
    </div>`;
    $("#btn-complementar", el).addEventListener("click", () => {
      const c = $("#complemento", el).value.trim();
      if (!c) return;
      relatoEl.value = `${relatoEl.value.trim()} ${c}`.slice(0, 2000);
      atualizarAlertas();
      $("#btn-interpretar", el).click();
    });
  }

  // ---------- Decisão do profissional ----------
  function desenharDecisao() {
    const bloco = $("#bloco-decisao", el);
    bloco.classList.remove("oculto");
    const atual = form.destino_escolhido?.value || estado.rec.destino || "";
    bloco.innerHTML = `<div class="card">
      <div class="card-cab"><div><h3>Decisão do profissional</h3><p>Escolha o destino do paciente. Se for diferente do recomendado, informe a justificativa.</p></div></div>
      <div class="destinos" role="radiogroup" aria-label="Destino">
        ${["UBS", "UPA", "HOSPITAL", "EMERGENCIA"].map((t) => `<div class="destino-opcao">
          <input type="radio" name="destino_escolhido" id="d-${t}" value="${t}" ${atual === t ? "checked" : ""}>
          <label for="d-${t}">${icone(t)}<strong>${esc(ROTULO_TIPO_CURTO[t])}</strong><small>${esc(DESC_DESTINO[t])}</small></label>
          ${estado.rec.destino === t ? '<span class="recomendado">RECOMENDADO</span>' : ""}
        </div>`).join("")}
      </div>
      <div class="grade-form" style="margin-top:16px">
        <label class="campo"><span>Unidade de destino</span><select class="entrada" name="destino_unidade_id"></select></label>
        <label class="campo"><span>Desfecho (se já conhecido)</span>
          <select class="entrada" name="resultado">${Object.entries(ROTULO_RESULTADO).map(([v, r]) => `<option value="${v}">${r}</option>`).join("")}</select></label>
      </div>
      <label class="campo oculto" id="campo-just" style="margin-top:14px"><span>Justificativa da divergência *</span>
        <textarea class="entrada" name="justificativa" rows="2" maxlength="500" placeholder="Ex.: sinais vitais alterados na avaliação; paciente já em acompanhamento na UPA…"></textarea></label>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px;flex-wrap:wrap">
        <button type="button" class="btn btn-secundario" id="btn-limpar">Limpar</button>
        <button type="submit" class="btn btn-primario" id="btn-salvar">${icone("ok")} Registrar encaminhamento</button>
      </div>
    </div>`;
    const atualizarDestino = () => {
      const tipo = form.destino_escolhido.value;
      const sel = form.destino_unidade_id;
      const opcoes = ctx.unidades.filter((u) => u.tipo === tipo);
      sel.innerHTML = `<option value="">${opcoes.length ? "Não especificada" : "Nenhuma unidade deste tipo cadastrada"}</option>${opcoes.map((u) => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join("")}`;
      if (opcoes.length === 1) sel.value = opcoes[0].id;
      const diverge = estado.rec.destino && tipo && tipo !== estado.rec.destino;
      $("#campo-just", el).classList.toggle("oculto", !diverge);
      form.justificativa.required = Boolean(diverge);
    };
    $$("[name=destino_escolhido]", bloco).forEach((r) => r.addEventListener("change", atualizarDestino));
    if (form.destino_escolhido.value) atualizarDestino();
    $("#btn-limpar", el).addEventListener("click", () => render(el, ctx));
    marcarDesatualizado();
  }

  // ---------- Salvar ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const relato = relatoEl.value.trim();
    if (!form.unidade_origem_id.value) { form.unidade_origem_id.focus(); return toast("Selecione a unidade de atendimento.", "erro"); }
    if (!estado.rec || relato !== estado.relatoInterpretado) return toast("Interprete o relato antes de registrar.", "erro");
    const destino = form.destino_escolhido?.value;
    if (!destino) return toast("Escolha o destino do paciente.", "erro");
    const just = form.justificativa.value.trim();
    if (form.justificativa.required && just.length < 5) { form.justificativa.focus(); return toast("Informe a justificativa da divergência.", "erro"); }
    if (PADRAO_DOC.test(relato) || PADRAO_DOC.test(form.codigo_paciente.value)) return toast("Remova CPF/Cartão SUS antes de salvar.", "erro");

    const btn = $("#btn-salvar", el);
    btn.disabled = true;
    try {
      const salvo = await salvarAtendimento({
        created_by: ctx.perfil.id,
        unidade_origem_id: form.unidade_origem_id.value,
        codigo_paciente: form.codigo_paciente.value.trim() || null,
        faixa_etaria: form.faixa_etaria.value,
        tipo_atendimento: form.tipo_atendimento.value,
        relato,
        interpretacao: estado.interpretacao,
        interpretacao_fonte: estado.fonte,
        ia_interpretacao_id: estado.iaId,
        alertas: estado.rec.alertas.filter((a) => !a.negado).map((a) => a.rotulo),
        nivel_recomendado: estado.rec.nivel,
        destino_recomendado: estado.rec.destino,
        criterios: estado.rec.criterios,
        destino_escolhido: destino,
        destino_unidade_id: form.destino_unidade_id.value || null,
        justificativa: just || null,
        resultado: form.resultado.value,
      });
      if (!ctx.ativo()) return;
      toast(`Atendimento nº ${salvo.protocolo} registrado.`);
      form.classList.add("oculto");
      $(".passos", el).classList.add("oculto");
      $("#sucesso", el).innerHTML = `<div class="card" style="text-align:center;padding:36px 20px">
        <div class="kpi-icone positivo" style="margin:0 auto 12px;width:48px;height:48px">${icone("ok")}</div>
        <h2>Atendimento nº ${esc(salvo.protocolo)} registrado</h2>
        <p style="color:var(--texto-2);margin:6px 0 18px">Encaminhado para ${tagDestino(destino)}. O desfecho pode ser atualizado no histórico.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a class="btn btn-secundario" href="#/fluxograma?id=${esc(salvo.id)}">${icone("fluxo")} Ver no fluxograma</a>
          <button class="btn btn-primario" id="btn-novo">${icone("mais")} Novo atendimento</button>
        </div></div>`;
      $("#btn-novo", el).addEventListener("click", () => render(el, ctx));
    } catch (err) {
      toast(err.message, "erro");
    } finally {
      btn.disabled = false;
    }
  });
}
