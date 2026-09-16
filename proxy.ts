import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Proxy (equivalente al "middleware" de versiones anteriores de Next.js;
 * ver https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
 * estándar de `@supabase/ssr` para Next.js App Router: refresca el access
 * token (via `auth.getUser()`) en cada request y reescribe las cookies de
 * sesión tanto en la request entrante como en la respuesta, para que
 * Server Components/Server Actions siempre vean una sesión vigente.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  if (!supabaseUrl || !supabaseAnonKey) {
    // Sin credenciales configuradas (ej. entorno local sin .env.local
    // aún): no bloqueamos la request, solo no refrescamos sesión.
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // No usar el resultado directamente; el propósito de esta llamada es
  // disparar el refresco del token cuando corresponda (efecto secundario
  // sobre las cookies vía setAll de arriba).
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Excluye archivos estáticos y de imágenes para no refrescar sesión
     * innecesariamente en cada asset.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
