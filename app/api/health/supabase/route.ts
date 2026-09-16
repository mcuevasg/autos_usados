import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

/**
 * Endpoint de salud para verificar conectividad con Supabase.
 *
 * Usa `storage.listBuckets()` porque dispara una petición HTTP real
 * contra la API de Storage de Supabase y no depende de tablas del
 * esquema de negocio (T-04 aún no existe).
 *
 * Nota: NO usar `auth.getSession()` / `auth.getUser()` para esto: el
 * SDK de Supabase resuelve esas llamadas localmente desde el storage
 * de sesión cuando no hay sesión guardada, sin hacer ninguna petición
 * de red. Eso hacía que este endpoint respondiera `ok:true` siempre,
 * incluso con URL/key inválidas o un proyecto inexistente/pausado.
 */
export async function GET() {
  const { error } = await supabase.storage.listBuckets();

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        message: "Error al conectar con Supabase",
        error: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message: "Conexión con Supabase establecida correctamente",
    },
    { status: 200 }
  );
}
