import { sb } from "./supabase.js";

export const ROTULO_PAPEL = {
  admin: "Administrador",
  gestor: "Gestor hospitalar",
  profissional: "Profissional de saúde",
};

/** Quem pode acessar cada tela. O banco (RLS) aplica as mesmas regras nos dados. */
export const PERMISSOES = {
  dashboard: ["admin", "gestor"],
  "novo-atendimento": ["admin", "profissional"],
  fluxograma: ["admin", "gestor", "profissional"],
  historico: ["admin", "gestor", "profissional"],
  otimizacao: ["admin", "gestor"],
  economia: ["admin", "gestor"],
  relatorios: ["admin", "gestor"],
  usuarios: ["admin"],
  configuracoes: ["admin"],
};

export const podeAcessar = (papel, rota) => (PERMISSOES[rota] ?? []).includes(papel);
export const rotaInicial = (papel) => (papel === "profissional" ? "novo-atendimento" : "dashboard");

function traduzirErroAuth(e) {
  const m = e?.message ?? "";
  if (/invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(m)) return "E-mail ainda não confirmado.";
  if (/rate limit|too many/i.test(m)) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (/fetch|network/i.test(m)) return "Não foi possível conectar ao servidor. Verifique sua internet.";
  if (/password/i.test(m) && /least|short|weak/i.test(m)) return "A senha não atende aos requisitos mínimos (8 caracteres ou mais).";
  return "Não foi possível concluir a operação. Tente novamente.";
}

export async function carregarPerfil() {
  const { data: s } = await sb.auth.getSession();
  if (!s?.session) return null;
  const { data, error } = await sb
    .from("perfis")
    .select("id, nome, email, papel, ativo, unidade_id, unidade:unidades(id, nome, tipo)")
    .eq("id", s.session.user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function entrar(email, senha) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha });
  if (error) throw new Error(traduzirErroAuth(error));
  let perfil;
  try {
    perfil = await carregarPerfil();
  } catch {
    await sb.auth.signOut();
    throw new Error("Não foi possível carregar seu perfil de acesso.");
  }
  if (!perfil?.ativo) {
    await sb.auth.signOut();
    throw new Error("Seu acesso ainda não foi liberado por um administrador.");
  }
  return perfil;
}

export async function sair() {
  await sb.auth.signOut();
  location.replace("entrar.html");
}

export async function recuperarSenha(email) {
  const redirectTo = new URL("redefinir-senha.html", location.href).href;
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw new Error(traduzirErroAuth(error));
}

export async function definirNovaSenha(senha) {
  const { error } = await sb.auth.updateUser({ password: senha });
  if (error) throw new Error(traduzirErroAuth(error));
}
