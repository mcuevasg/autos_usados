import { createBrowserClient } from "@supabase/ssr";

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
 * Cliente Supabase para uso en el navegador (Client Components).
 *
 * Usa `createBrowserClient` de `@supabase/ssr` (en vez del `createClient`
 * genérico de `@supabase/supabase-js`) para que la sesión quede persistida
 * en cookies y sea compartida/legible por el servidor (Server Components,
 * Server Actions, middleware) a través de `lib/supabase/server.ts` y
 * `middleware.ts`.
 *
 * Nota: esta instancia se puede seguir usando también desde el servidor
 * (ej. el endpoint de salud de T-02) para llamadas que no dependen de la
 * sesión del usuario (como `storage.listBuckets()`), pero para cualquier
 * lógica que dependa de la sesión (auth.getUser(), RLS con auth.uid())
 * en un Server Component/Server Action se debe usar el cliente de
 * `lib/supabase/server.ts`.
 */
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
