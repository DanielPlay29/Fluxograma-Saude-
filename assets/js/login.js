import { configurado, sb } from "./servicos/supabase.js";
import { entrar, recuperarSenha } from "./servicos/sessao.js";
import { LOGO } from "./ui/icones.js";
import { $, aviso, esc } from "./ui/comum.js";

$("#marca").innerHTML = `${LOGO}<span><strong>FluxoSaúde</strong><small>Gestão da rede SUS</small></span>`;
const msg = $("#mensagem");
const mostrar = (tipo, titulo, texto = "") => { msg.innerHTML = aviso(tipo, titulo, texto ? `<p>${esc(texto)}</p>` : ""); };

if (!configurado) {
  $("#form-login").classList.add("oculto");
  msg.innerHTML = aviso(
    "atencao",
    "Sistema ainda não conectado ao banco de dados",
    `<p>Preencha <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> no arquivo <code>assets/js/config.js</code>.
     O passo a passo está no arquivo <code>GUIA_DE_CONFIGURACAO.md</code> do projeto.</p>`,
  );
} else {
  const { data } = await sb.auth.getSession();
  if (data?.session) location.replace("app.html");
  if (new URLSearchParams(location.search).get("motivo") === "inativo") {
    mostrar("atencao", "Acesso não liberado", "Seu usuário está inativo. Procure o administrador do sistema.");
  }
}

$("#ir-recuperar").addEventListener("click", () => {
  $("#form-login").classList.add("oculto");
  $("#form-recuperar").classList.remove("oculto");
  $("#form-recuperar [name=email]").value = $("#form-login [name=email]").value;
  msg.innerHTML = "";
  $("#form-recuperar [name=email]").focus();
});
$("#voltar-login").addEventListener("click", () => {
  $("#form-recuperar").classList.add("oculto");
  $("#form-login").classList.remove("oculto");
  msg.innerHTML = "";
});

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const email = f.email.value.trim();
  const senha = f.senha.value;
  if (!email || !senha) return mostrar("erro", "Informe e-mail e senha.");
  const btn = $("#btn-entrar");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Entrando…';
  try {
    await entrar(email, senha);
    location.replace("app.html");
  } catch (err) {
    mostrar("erro", err.message);
    f.senha.value = "";
    f.senha.focus();
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});

$("#form-recuperar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return mostrar("erro", "Informe um e-mail válido.");
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    await recuperarSenha(email);
    msg.innerHTML = aviso("ok", "Verifique seu e-mail", `<p>Se ${esc(email)} estiver cadastrado, enviamos um link para criar uma nova senha.</p>`);
  } catch (err) {
    mostrar("erro", err.message);
  } finally {
    btn.disabled = false;
  }
});

