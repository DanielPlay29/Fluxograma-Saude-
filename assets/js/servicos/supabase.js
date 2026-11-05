import { CONFIG } from "../config.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const configurado = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

export const sb = configurado
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
