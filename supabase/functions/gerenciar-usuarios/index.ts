// Função serverless: criação de usuários pelo administrador.
// Usa a SERVICE ROLE KEY, que existe somente no servidor (o Supabase a injeta
// automaticamente nas Edge Functions) e nunca vai para o navegador.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, json, usuarioDaRequisicao } from "../_shared/comum.ts";

const PAPEIS = ["admin", "gestor", "profissional"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "metodo_nao_permitido" }, 405);

  const u = await usuarioDaRequisicao(req);
  if (!u.ok) return u.resposta;
  if (u.perfil.papel !== "admin") return json({ erro: "acesso_negado" }, 403);

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: "requisicao_invalida" }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (corpo.acao === "criar") {
    const email = String(corpo.email ?? "").trim().toLowerCase();
    const nome = String(corpo.nome ?? "").trim();
    const senha = String(corpo.senha ?? "");
    const papel = String(corpo.papel ?? "");
    const unidade_id = corpo.unidade_id ? String(corpo.unidade_id) : null;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ erro: "email_invalido" }, 400);
    if (nome.length < 2) return json({ erro: "nome_invalido" }, 400);
    if (senha.length < 8) return json({ erro: "senha_curta" }, 400);
    if (!PAPEIS.includes(papel)) return json({ erro: "papel_invalido" }, 400);

    const { data: criado, error } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome },
    });
    if (error || !criado?.user) {
      const ja = /already|registered|exists/i.test(error?.message ?? "");
      return json({ erro: ja ? "email_ja_cadastrado" : "falha_criar_usuario" }, ja ? 409 : 500);
    }

    // O gatilho do banco cria o perfil inativo; aqui o admin define papel e libera o acesso.
    // Feito com o cliente do próprio admin para que a auditoria registre quem alterou.
    const { error: ep } = await u.db
      .from("perfis")
      .update({ nome, papel, unidade_id, ativo: true })
      .eq("id", criado.user.id);
    if (ep) {
      await admin.auth.admin.deleteUser(criado.user.id);
      return json({ erro: "falha_definir_perfil" }, 500);
    }
    return json({ ok: true, id: criado.user.id });
  }

  return json({ erro: "acao_desconhecida" }, 400);
});
