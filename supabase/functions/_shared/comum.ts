import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

export type Perfil = { id: string; nome: string; papel: "admin" | "gestor" | "profissional"; ativo: boolean };

/**
 * Cria um cliente Supabase que age COMO o usuário que chamou a função
 * (as regras de RLS continuam valendo) e devolve o perfil dele.
 */
export async function usuarioDaRequisicao(req: Request): Promise<
  { ok: true; db: SupabaseClient; perfil: Perfil } | { ok: false; resposta: Response }
> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { ok: false, resposta: json({ erro: "nao_autenticado" }, 401) };
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: u, error: eu } = await db.auth.getUser(auth.slice(7));
  if (eu || !u?.user) return { ok: false, resposta: json({ erro: "nao_autenticado" }, 401) };

  const { data: perfil, error } = await db
    .from("perfis")
    .select("id, nome, papel, ativo")
    .eq("id", u.user.id)
    .single();
  if (error || !perfil || !perfil.ativo) {
    return { ok: false, resposta: json({ erro: "acesso_negado" }, 403) };
  }
  return { ok: true, db, perfil: perfil as Perfil };
}
