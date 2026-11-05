// Estrutura da aplicação: proteção de acesso, menu lateral e navegação.
import { configurado, sb } from "./servicos/supabase.js";
import { carregarPerfil, sair, podeAcessar, rotaInicial, ROTULO_PAPEL } from "./servicos/sessao.js";
import { listarUnidades } from "./servicos/dados.js";
import { icone, LOGO } from "./ui/icones.js";
import { esc, $, $$, aviso, toast } from "./ui/comum.js";
import { destruirGraficos } from "./ui/graficos.js";

const TELAS = [
  { rota: "dashboard", rotulo: "Dashboard", icone: "dashboard", grupo: "Visão geral", carregar: () => import("./telas/dashboard.js") },
  { rota: "novo-atendimento", rotulo: "Novo atendimento", icone: "estetoscopio", grupo: "Atendimento", carregar: () => import("./telas/novo-atendimento.js") },
  { rota: "fluxograma", rotulo: "Fluxograma de encaminhamento", icone: "fluxo", grupo: "Atendimento", carregar: () => import("./telas/fluxograma.js") },
  { rota: "historico", rotulo: "Histórico de pacientes", icone: "historico", grupo: "Atendimento", carregar: () => import("./telas/historico.js") },
  { rota: "otimizacao", rotulo: "Otimização da rede", icone: "otimizacao", grupo: "Gestão", carregar: () => import("./telas/otimizacao.js") },
  { rota: "economia", rotulo: "Economia gerada", icone: "economia", grupo: "Gestão", carregar: () => import("./telas/economia.js") },
  { rota: "relatorios", rotulo: "Relatórios", icone: "relatorios", grupo: "Gestão", carregar: () => import("./telas/relatorios.js") },
  { rota: "usuarios", rotulo: "Usuários", icone: "usuarios", grupo: "Administração", carregar: () => import("./telas/usuarios.js") },
  { rota: "configuracoes", rotulo: "Configurações", icone: "configuracoes", grupo: "Administração", carregar: () => import("./telas/configuracoes.js") },
];

const raiz = document.getElementById("app");
const ctx = { perfil: null, unidades: [], navegar: (r) => { location.hash = `#/${r}`; } };
let renderizacao = 0;

function iniciais(nome) {
  return String(nome ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function montarEstrutura() {
  const permitidas = TELAS.filter((t) => podeAcessar(ctx.perfil.papel, t.rota));
  const grupos = [...new Set(permitidas.map((t) => t.grupo))];
  raiz.className = "app";
  raiz.innerHTML = `
    <aside class="sidebar" aria-label="Menu principal">
      <a class="marca" href="#/${rotaInicial(ctx.perfil.papel)}">${LOGO}<span><strong>FluxoSaúde</strong><small>Gestão da rede SUS</small></span></a>
      <nav class="nav">
        ${grupos.map((g) => `<div class="nav-titulo">${esc(g)}</div>
          ${permitidas.filter((t) => t.grupo === g).map((t) => `<a href="#/${t.rota}" data-rota="${t.rota}">${icone(t.icone)}<span>${esc(t.rotulo)}</span></a>`).join("")}`).join("")}
      </nav>
      <div class="sidebar-rodape">
        <div class="usuario">
          <div class="avatar" aria-hidden="true">${esc(iniciais(ctx.perfil.nome))}</div>
          <div><div class="usuario-nome">${esc(ctx.perfil.nome)}</div>
          <div class="usuario-papel">${esc(ROTULO_PAPEL[ctx.perfil.papel])}${ctx.perfil.unidade ? ` · ${esc(ctx.perfil.unidade.nome)}` : ""}</div></div>
        </div>
        <button class="btn btn-fantasma btn-sair" id="btn-sair">${icone("sair")} Sair</button>
      </div>
    </aside>
    <div class="principal">
      <header class="topo">
        <button class="btn btn-fantasma btn-sm btn-menu" id="btn-menu" aria-label="Abrir menu">${icone("menu")}</button>
        <div><h1 id="titulo-tela"></h1><div class="subtitulo" id="subtitulo-tela"></div></div>
        <div class="topo-acoes" id="acoes-tela"></div>
      </header>
      <main class="conteudo" id="conteudo" tabindex="-1"></main>
    </div>`;
  $("#btn-sair").addEventListener("click", sair);
  $("#btn-menu").addEventListener("click", () => raiz.classList.toggle("menu-aberto"));
  raiz.addEventListener("click", (e) => {
    if (raiz.classList.contains("menu-aberto") && (e.target === raiz || e.target.closest(".nav a"))) raiz.classList.remove("menu-aberto");
  });
}

async function navegar() {
  const rota = location.hash.replace(/^#\/?/, "").split("?")[0];
  if (!rota) {
    location.replace(`#/${rotaInicial(ctx.perfil.papel)}`);
    return;
  }
  const tela = TELAS.find((t) => t.rota === rota);
  if (!tela || !podeAcessar(ctx.perfil.papel, rota)) {
    if (tela) toast("Seu perfil não tem acesso a esta área.", "erro");
    location.replace(`#/${rotaInicial(ctx.perfil.papel)}`);
    return;
  }
  const minha = ++renderizacao;
  destruirGraficos();
  $$(".nav a").forEach((a) => { if (a.dataset.rota === rota) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const conteudo = $("#conteudo");
  conteudo.innerHTML = "";
  $("#acoes-tela").innerHTML = "";
  $("#titulo-tela").textContent = tela.rotulo;
  $("#subtitulo-tela").textContent = "";
  document.title = `${tela.rotulo} · FluxoSaúde`;
  try {
    const mod = await tela.carregar();
    if (minha !== renderizacao) return;
    $("#subtitulo-tela").textContent = mod.subtitulo ?? "";
    await mod.render(conteudo, { ...ctx, acoes: $("#acoes-tela"), ativo: () => minha === renderizacao });
  } catch (e) {
    console.error(e);
    if (minha === renderizacao) conteudo.innerHTML = aviso("erro", "Não foi possível abrir esta tela.", `<p>${esc(e.message)}</p>`);
  }
  conteudo.focus({ preventScroll: true });
}

async function iniciar() {
  if (!configurado) {
    location.replace("entrar.html");
    return;
  }
  const { data } = await sb.auth.getSession();
  if (!data?.session) {
    location.replace("entrar.html");
    return;
  }
  try {
    ctx.perfil = await carregarPerfil();
  } catch {
    ctx.perfil = null;
  }
  if (!ctx.perfil?.ativo) {
    await sb.auth.signOut();
    location.replace("entrar.html?motivo=inativo");
    return;
  }
  try {
    ctx.unidades = await listarUnidades();
  } catch {
    ctx.unidades = [];
  }
  ctx.recarregarUnidades = async () => { ctx.unidades = await listarUnidades(); };
  montarEstrutura();
  sb.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") location.replace("entrar.html");
  });
  window.addEventListener("hashchange", navegar);
  navegar();
}

iniciar();
