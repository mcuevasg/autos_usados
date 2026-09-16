import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error(
    "Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL. Define su valor en .env.local (ver .env.local.example)."
  );
}

if (!supabaseAnonKey) {
  throw new Error(
    "Falta la variable de entorno NEXT_PUBLIC_SUPABASE_ANON_KEY. Define su valor en .env.local (ver .env.local.example)."
  );
}

/**
 * Cliente Supabase básico (browser/servidor sin SSR helpers).
 * Reutilizar esta instancia en toda la app en lugar de crear clientes nuevos.
 * La configuración de SSR/auth helpers (cookies, middleware, etc.) se
 * implementará en T-05.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);
