import { listarAtendimentos, atualizarAtendimento, historicoDoRegistro, listarPerfis, dataLocal } from "../servicos/dados.js";
import { ROTULO_NIVEL } from "../core/triagem.js";
import { icone } from "../ui/icones.js";
import { dataDeTexto } from "../ui/filtros.js";
import {
  esc, $, aviso, carregando, vazio, modal, toast, fmtNum, fmtDataHora, tagDestino, tagResultado,
  ROTULO_RESULTADO, ROTULO_TIPO_ATENDIMENTO, ROTULO_TIPO_CURTO, ROTULO_FAIXA,
} from "../ui/comum.js";

export const subtitulo = "Atendimentos registrados, desfechos e histórico de alterações";

const CAMPOS_AUDITADOS = {
  resultado: "Resultado",
  destino_escolhido: "Destino escolhido",
  destino_unidade_id: "Unidade de destino",
  justificativa: "Justificativa",
  codigo_paciente: "Código do paciente",
};

export async function render(el, ctx) {
  const podeEditar = ["admin", "profissional"].includes(ctx.perfil.papel);
  const hoje = new Date();
  const ha30 = new Date(); ha30.setDate(ha30.getDate() - 29);
  let nomes = {};
  listarPerfis().then((ps) => { nomes = Object.fromEntries(ps.map((p) => [p.id, p.nome])); }).catch(() => {});

  el.innerHTML = `
    <div class="card"><form class="filtros" id="filtros">
      <label class="campo"><span>De</span><input class="entrada" type="date" name="de" value="${dataLocal(ha30)}"></label>
      <label class="campo"><span>Até</span><input class="entrada" type="date" name="ate" value="${dataLocal(hoje)}"></label>
      <label class="campo"><span>Unidade</span><select class="entrada" name="unidade"><option value="">Todas</option>${ctx.unidades.map((u) => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Destino</span><select class="entrada" name="destino"><option value="">Todos</option>${Object.entries(ROTULO_TIPO_CURTO).map(([v, r]) => `<option value="${v}">${r}</option>`).join("")}</select></label>
      <label class="campo"><span>Resultado</span><select class="entrada" name="resultado"><option value="">Todos</option>${Object.entries(ROTULO_RESULTADO).map(([v, r]) => `<option value="${v}">${r}</option>`).join("")}</select></label>
      <label class="campo"><span>Nº ou código</span><input class="entrada" name="busca" placeholder="Ex.: 128" autocomplete="off"></label>
    </form></div>
    <div class="card"><div class="card-cab"><div><h3>Atendimentos</h3><p id="contagem"></p></div></div><div id="tabela">${carregando()}</div></div>`;

  const f = $("#filtros", el);
  let dados = [];

  async function carregar() {
    $("#tabela", el).innerHTML = carregando();
    const fim = dataDeTexto(f.ate.value || dataLocal(hoje)); fim.setDate(fim.getDate() + 1);
    try {
      dados = await listarAtendimentos({
        inicio: dataDeTexto(f.de.value || dataLocal(ha30)), fim,
        unidadeId: f.unidade.value || null, destino: f.destino.value || null, resultado: f.resultado.value || null, limite: 2000,
      });
    } catch (e) {
      $("#tabela", el).innerHTML = aviso("erro", e.message);
      return;
    }
    if (ctx.ativo()) desenhar();
  }

  function desenhar() {
    const b = f.busca.value.trim().toLowerCase();
    const lista = b ? dados.filter((a) => String(a.protocolo) === b || (a.codigo_paciente ?? "").toLowerCase().includes(b)) : dados;
    $("#contagem", el).textContent = `${fmtNum(lista.length)} registro(s)${dados.length >= 2000 ? " — exibindo os 2.000 mais recentes" : ""}`;
    if (!lista.length) { $("#tabela", el).innerHTML = vazio("Nenhum atendimento encontrado", "Ajuste os filtros.", "historico"); return; }
    $("#tabela", el).innerHTML = `<div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Nº</th><th>Data</th><th>Unidade de origem</th><th>Código</th><th>Recomendado</th><th>Escolhido</th><th>Alerta</th><th>Resultado</th></tr></thead>
      <tbody>${lista.map((a) => `<tr class="clicavel" data-id="${esc(a.id)}" tabindex="0">
        <td class="num"><strong>${esc(a.protocolo)}</strong></td><td>${esc(fmtDataHora(a.created_at))}</td>
        <td>${esc(a.origem_nome)}</td><td>${esc(a.codigo_paciente ?? "—")}</td>
        <td>${tagDestino(a.destino_recomendado)}</td><td>${tagDestino(a.destino_escolhido)}</td>
        <td>${a.alertas?.length ? `<span class="tag tag-erro" title="${esc(a.alertas.join(", "))}">${icone("alerta", 'width="12" height="12"')} ${a.alertas.length}</span>` : "—"}</td>
        <td>${tagResultado(a.resultado)}</td></tr>`).join("")}</tbody></table></div>`;
    $("#tabela tbody", el).addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) abrir(tr.dataset.id); });
    $("#tabela tbody", el).addEventListener("keydown", (e) => { if (e.key === "Enter") { const tr = e.target.closest("tr[data-id]"); if (tr) abrir(tr.dataset.id); } });
  }

  async function abrir(id) {
    const a = dados.find((x) => x.id === id);
    if (!a) return;
    const i = a.interpretacao ?? {};
    const corpo = document.createElement("div");
    corpo.innerHTML = `
      <div class="fluxo-detalhe"><dl>
        <dt>Data</dt><dd>${esc(fmtDataHora(a.created_at))} · por ${esc(a.autor?.nome ?? "—")}</dd>
        <dt>Origem</dt><dd>${esc(a.origem_nome)} · ${esc(ROTULO_TIPO_ATENDIMENTO[a.tipo_atendimento])} · ${esc(ROTULO_FAIXA[a.faixa_etaria] ?? "—")}</dd>
        <dt>Código do paciente</dt><dd>${esc(a.codigo_paciente ?? "—")}</dd>
        <dt>Relato</dt><dd>“${esc(a.relato)}”</dd>
        <dt>Interpretação</dt><dd>${esc(i.resumo_tecnico ?? "—")} ${a.interpretacao_fonte === "ia" ? '<span class="tag tag-ia">IA</span>' : '<span class="tag tag-neutra">Regras locais</span>'}</dd>
        ${a.alertas?.length ? `<dt>Sinais de alerta</dt><dd><span class="tag tag-erro">${esc(a.alertas.join(", "))}</span></dd>` : ""}
        <dt>Protocolo</dt><dd>${esc(ROTULO_NIVEL[a.nivel_recomendado])} → ${tagDestino(a.destino_recomendado)}<ul class="lista-criterios" style="margin-top:6px">${(a.criterios ?? []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul></dd>
        <dt>Destino escolhido</dt><dd>${tagDestino(a.destino_escolhido)} ${esc(a.destino_unidade?.nome ?? "")}${a.justificativa ? `<br><span class="evidencia">Justificativa: ${esc(a.justificativa)}</span>` : ""}</dd>
      </dl></div>
      ${podeEditar ? `<div class="card" style="box-shadow:none;background:var(--superficie-2)">
        <label class="campo"><span>Atualizar resultado do encaminhamento</span>
          <select class="entrada" id="novo-resultado">${Object.entries(ROTULO_RESULTADO).map(([v, r]) => `<option value="${v}" ${v === a.resultado ? "selected" : ""}>${r}</option>`).join("")}</select>
          <small>Registrar o desfecho permite medir quantos pacientes foram direcionados corretamente.</small></label></div>`
        : `<p>Resultado: ${tagResultado(a.resultado)}</p>`}
      <div><span class="rotulo">Histórico de alterações</span><div id="hist" style="margin-top:8px">${carregando()}</div></div>`;

    modal({
      titulo: `Atendimento nº ${a.protocolo}`,
      corpo,
      largura: 760,
      acoes: podeEditar
        ? [{ rotulo: "Fechar" }, {
          rotulo: "Salvar resultado", classe: "btn-primario",
          aoClicar: async () => {
            const novo = $("#novo-resultado", corpo).value;
            if (novo === a.resultado) return true;
            await atualizarAtendimento(a.id, { resultado: novo });
            toast("Resultado atualizado.");
            carregar();
            return true;
          },
        }]
        : [{ rotulo: "Fechar" }],
    });

    try {
      const hist = await historicoDoRegistro("atendimentos", a.id);
      $("#hist", corpo).innerHTML = hist.length
        ? `<ul class="linha-tempo">${hist.map((h) => {
          let desc = h.acao === "INSERT" ? "Atendimento registrado" : h.acao === "DELETE" ? "Registro excluído" : "";
          if (h.acao === "UPDATE") {
            const mud = Object.entries(CAMPOS_AUDITADOS).filter(([c]) => JSON.stringify(h.antes?.[c]) !== JSON.stringify(h.depois?.[c]));
            desc = mud.length
              ? mud.map(([c, r]) => `${r}: ${c === "resultado" ? `${ROTULO_RESULTADO[h.antes?.[c]] ?? "—"} → ${ROTULO_RESULTADO[h.depois?.[c]] ?? "—"}` : "alterado"}`).join("; ")
              : "Atualização sem mudança nos campos de negócio";
          }
          return `<li><div>${esc(desc)}<br><small>${esc(fmtDataHora(h.ocorrido_em))} · ${esc(nomes[h.usuario_id] ?? "usuário")}</small></div></li>`;
        }).join("")}</ul>`
        : '<p class="evidencia">Sem registros de auditoria.</p>';
    } catch (e) {
      $("#hist", corpo).innerHTML = aviso("erro", e.message);
    }
  }

  for (const n of ["de", "ate", "unidade", "destino", "resultado"]) f[n].addEventListener("change", carregar);
  f.busca.addEventListener("input", () => desenhar());
  f.addEventListener("submit", (e) => e.preventDefault());
  await carregar();
}
