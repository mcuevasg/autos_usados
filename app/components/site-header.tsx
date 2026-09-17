import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HeaderNav } from "./header-nav";

/**
 * Punto de entrada del header global (T-23). Es un Server Component async
 * porque necesita consultar la sesión actual desde las cookies de la
 * petición (mismo patrón que `app/cuenta/page.tsx`, vía
 * `createSupabaseServerClient()`). `app/layout.tsx` lo renderiza una sola
 * vez, así que aparece en TODAS las páginas del sitio.
 *
 * La sesión se resuelve acá, en el servidor, y se le pasa a `HeaderNav`
 * como un dato simple (el email o `null`). `HeaderNav` es Client Component
 * solo porque el menú mobile necesita estado local (`useState`); así el
 * fetch de sesión nunca viaja al navegador.
 */
export async function SiteHeader() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <HeaderNav userEmail={user?.email ?? null} />;
}
