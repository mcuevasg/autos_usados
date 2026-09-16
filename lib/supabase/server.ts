import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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
 * Cliente Supabase para Server Components y Server Actions (App Router).
 *
 * Usa `createServerClient` de `@supabase/ssr`, leyendo/escribiendo la
 * sesión desde las cookies de la petición actual (`next/headers`). Debe
 * crearse una instancia nueva por request (no reutilizar un singleton
 * como en `lib/supabase/client.ts`), porque las cookies dependen de cada
 * petición.
 *
 * En un Server Component puro no se pueden escribir cookies (Next.js
 * lanza si se intenta), por eso el `set` se envuelve en try/catch: en ese
 * caso el refresco de sesión lo hace `middleware.ts` en cada request.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl!, supabaseAnonKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Se llama desde un Server Component (no se pueden escribir
          // cookies ahí). El middleware se encarga de refrescar la
          // sesión en cada request.
        }
      },
    },
  });
}
