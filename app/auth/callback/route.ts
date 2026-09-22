import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Callback de Supabase para verificación de email (OAuth flow).
 * Intercambia el código de autorización por una sesión válida.
 *
 * @route GET /auth/callback
 * @query {string} code - Código de verificación de Supabase Auth
 * @returns Redirige a /cuenta si es exitoso, o a /login con error si falla
 */
// T-28 (spike cacheComponents): route handler que lee `searchParams`/
// código de OAuth y crea sesión; no debe prerenderizarse como estático.
export const instant = false;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim() || null;

  // Validar presencia y formato del código
  if (
    !code ||
    typeof code !== "string" ||
    code.length > 128 ||
    !/^[a-zA-Z0-9_-]{20,128}$/.test(code)
  ) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_code", request.url)
    );
  }

  try {
    const supabase = await createSupabaseServerClient();

    // exchangeCodeForSession NO lanza excepciones, retorna { data, error }
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Error en intercambio de código de email:", error.message);
      return NextResponse.redirect(
        new URL("/login?error=verification_failed", request.url)
      );
    }

    // Verificar que la sesión se creó correctamente
    if (!data.session) {
      return NextResponse.redirect(
        new URL("/login?error=verification_failed", request.url)
      );
    }

    return NextResponse.redirect(new URL("/cuenta", request.url));
  } catch (error) {
    console.error("Error inesperado en verificación de email:", error);
    return NextResponse.redirect(
      new URL("/login?error=verification_failed", request.url)
    );
  }
}
