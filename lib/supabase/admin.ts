import "server-only";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error(
    "Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL. Define su valor en .env.local (ver .env.local.example)."
  );
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    "Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY. Define su valor en .env.local (ver .env.local.example)."
  );
}

/**
 * Cliente Supabase con la service role key: bypassa Row Level Security.
 *
 * USO EXCLUSIVAMENTE SERVER-SIDE (Server Actions, Route Handlers). Nunca
 * debe importarse desde un Client Component ni exponerse al navegador: la
 * dependencia `server-only` hace fallar el build si eso ocurriera.
 *
 * Se usa para operaciones que un usuario autenticado no puede hacer por sí
 * mismo por diseño de RLS, como promover `profiles.role` a 'vendedor' al
 * completar el registro de vendedor (T-07): la política
 * `profiles_select_own` (0004_profiles_and_roles.sql) intencionalmente no
 * permite `update` a `authenticated`, para evitar auto-promoción de rol.
 */
export function createSupabaseAdminClient() {
  return createClient(supabaseUrl!, supabaseServiceRoleKey!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
