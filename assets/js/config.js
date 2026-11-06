// =====================================================================
// Configuração da conexão com o Supabase.
// Preencha com os dados do SEU projeto (Supabase → Project Settings → API).
//
// A "anon key" (chave pública) PODE ficar no frontend: ela não dá acesso a
// nada sozinha — todo dado é protegido pelas regras de segurança (RLS) do
// banco. NUNCA coloque aqui a "service_role key" nem a chave da Gemini API.
// =====================================================================
export const CONFIG = {
  SUPABASE_URL: "https://feutydmhtrqxflsiumij.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_u1VPeW_ISURDpFDM7KsYqw_hefmagmJ",
  // Cidade mostrada por padrão na página pública (o visitante pode trocar).
  REGIAO_PADRAO: "Uberaba - MG",
};
