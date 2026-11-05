import { listarPerfis, atualizarPerfil, criarUsuario } from "../servicos/dados.js";
import { ROTULO_PAPEL } from "../servicos/sessao.js";
import { icone } from "../ui/icones.js";
import { esc, $, aviso, carregando, vazio, modal, toast, fmtData } from "../ui/comum.js";

export const subtitulo = "Cadastro de usuários e perfis de acesso";

const DESC_PAPEL = {
  admin: "Indicadores gerais, configurações, usuários e relatórios",
  gestor: "Otimização, economia, encaminhamentos e relatórios",
  profissional: "Novo atendimento, fluxo e histórico da sua unidade",
};

function opcoesUnidades(unidades, sel) {
  return `<option value="">Sem unidade fixa</option>${unidades.map((u) => `<option value="${esc(u.id)}" ${u.id === sel ? "selected" : ""}>${esc(u.nome)}</option>`).join("")}`;
}
function opcoesPapel(sel) {
  return Object.entries(ROTULO_PAPEL).map(([v, r]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${r}</option>`).join("");
}

export async function render(el, ctx) {
  ctx.acoes.innerHTML = `<button class="btn btn-primario" id="btn-novo-usuario">${icone("mais")} Novo usuário</button>`;
  el.innerHTML = `
    <div class="grade grade-3">${Object.entries(ROTULO_PAPEL).map(([p, r]) => `<div class="card kpi"><div class="kpi-topo"><span class="kpi-rotulo">${esc(r)}</span><span class="kpi-icone">${icone(p === "admin" ? "escudo" : p === "gestor" ? "otimizacao" : "estetoscopio")}</span></div><div class="kpi-valor" data-conta="${p}">—</div><div class="kpi-nota">${esc(DESC_PAPEL[p])}</div></div>`).join("")}</div>
    <div class="card"><div class="card-cab"><div><h3>Usuários</h3><p>Usuários inativos não conseguem entrar nem ver dados.</p></div></div><div id="lista">${carregando()}</div></div>`;

  async function carregar() {
    let perfis;
    try { perfis = await listarPerfis(); } catch (e) { $("#lista", el).innerHTML = aviso("erro", e.message); return; }
    if (!ctx.ativo()) return;
    for (const p of Object.keys(ROTULO_PAPEL)) $(`[data-conta="${p}"]`, el).textContent = perfis.filter((x) => x.papel === p && x.ativo).length;
    $("#lista", el).innerHTML = perfis.length ? `<div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Unidade</th><th>Situação</th><th>Desde</th><th></th></tr></thead>
      <tbody>${perfis.map((p) => `<tr>
        <td><strong>${esc(p.nome)}</strong>${p.id === ctx.perfil.id ? ' <span class="tag tag-neutra">você</span>' : ""}</td>
        <td>${esc(p.email ?? "—")}</td><td>${esc(ROTULO_PAPEL[p.papel])}</td><td>${esc(p.unidade?.nome ?? "—")}</td>
        <td>${p.ativo ? '<span class="tag tag-ok">Ativo</span>' : '<span class="tag tag-atencao">Inativo</span>'}</td>
        <td>${esc(fmtData(p.created_at))}</td>
        <td class="num"><button class="btn btn-fantasma btn-sm" data-editar="${esc(p.id)}">${icone("editar")} Editar</button></td></tr>`).join("")}</tbody></table></div>`
      : vazio("Nenhum usuário");
    el.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => editar(perfis.find((p) => p.id === b.dataset.editar))));
  }

  function editar(p) {
    const proprio = p.id === ctx.perfil.id;
    const m = modal({
      titulo: `Editar ${p.nome}`,
      corpo: `<label class="campo"><span>Nome</span><input class="entrada" name="nome" value="${esc(p.nome)}" maxlength="120"></label>
        <div class="grade-form">
          <label class="campo"><span>Perfil de acesso</span><select class="entrada" name="papel" ${proprio ? "disabled" : ""}>${opcoesPapel(p.papel)}</select></label>
          <label class="campo"><span>Unidade de lotação</span><select class="entrada" name="unidade_id">${opcoesUnidades(ctx.unidades, p.unidade_id)}</select></label>
        </div>
        <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="ativo" ${p.ativo ? "checked" : ""} ${proprio ? "disabled" : ""}> Acesso liberado (ativo)</label>
        ${proprio ? aviso("info", "", "<p>Você não pode alterar o próprio perfil nem se desativar.</p>") : ""}
        ${aviso("info", "", "<p>A troca de senha é feita pelo próprio usuário em “Esqueci minha senha”, na tela de login.</p>")}`,
      acoes: [{ rotulo: "Cancelar" }, {
        rotulo: "Salvar", classe: "btn-primario",
        aoClicar: async () => {
          const q = (n) => $(`[name=${n}]`, m.corpo);
          const patch = { nome: q("nome").value.trim(), unidade_id: q("unidade_id").value || null };
          if (patch.nome.length < 2) { toast("Informe o nome.", "erro"); return false; }
          if (!proprio) { patch.papel = q("papel").value; patch.ativo = q("ativo").checked; }
          await atualizarPerfil(p.id, patch);
          toast("Usuário atualizado.");
          carregar();
        },
      }],
    });
  }

  $("#btn-novo-usuario").addEventListener("click", () => {
    const m = modal({
      titulo: "Novo usuário",
      corpo: `<div class="grade-form">
          <label class="campo"><span>Nome completo *</span><input class="entrada" name="nome" maxlength="120" autocomplete="off"></label>
          <label class="campo"><span>E-mail *</span><input class="entrada" type="email" name="email" autocomplete="off"></label>
          <label class="campo"><span>Perfil de acesso *</span><select class="entrada" name="papel">${opcoesPapel("profissional")}</select></label>
          <label class="campo"><span>Unidade de lotação</span><select class="entrada" name="unidade_id">${opcoesUnidades(ctx.unidades, "")}</select></label>
        </div>
        <label class="campo"><span>Senha temporária * (mín. 8 caracteres)</span><input class="entrada" type="text" name="senha" autocomplete="off" minlength="8">
          <small>Entregue a senha ao usuário por um canal seguro e oriente-o a trocá-la em “Esqueci minha senha”.</small></label>`,
      acoes: [{ rotulo: "Cancelar" }, {
        rotulo: "Criar usuário", classe: "btn-primario",
        aoClicar: async () => {
          const q = (n) => $(`[name=${n}]`, m.corpo).value.trim();
          const dados = { nome: q("nome"), email: q("email"), papel: q("papel"), unidade_id: q("unidade_id") || null, senha: $("[name=senha]", m.corpo).value };
          if (dados.nome.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email) || dados.senha.length < 8) {
            toast("Preencha nome, e-mail válido e senha com 8+ caracteres.", "erro");
            return false;
          }
          await criarUsuario(dados);
          toast("Usuário criado.");
          carregar();
        },
      }],
    });
  });

  await carregar();
}
