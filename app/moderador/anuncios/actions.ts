"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ModeradorAnuncioAccionState = {
  error: string | null;
};

export const initialModeradorAnuncioAccionState: ModeradorAnuncioAccionState =
  {
    error: null,
  };

const ESTADOS_DESTINO = [
  "borrador",
  "publicado",
  "pausado",
  "vendido",
  "rechazado",
] as const;
type EstadoDestino = (typeof ESTADOS_DESTINO)[number];

function esEstadoDestinoValido(valor: string): valor is EstadoDestino {
  return (ESTADOS_DESTINO as readonly string[]).includes(valor);
}

/**
 * Confirma en servidor (no confía en la UI) que el usuario autenticado
 * tiene `profiles.role === 'moderador'`. Devuelve el user autenticado si
 * corresponde, o null si no hay sesión o no es moderador. Mismo patrón
 * que `requireModerador` en app/moderador/vendedores/actions.ts (T-08).
 */
async function requireModerador(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "moderador") return null;

  return user;
}

/**
 * Server Action del panel de moderador de anuncios (T-12): cambia
 * `listings.status` a cualquiera de los 5 valores válidos del ciclo de
 * vida (borrador, publicado, pausado, vendido, rechazado).
 *
 * Vuelve a verificar en servidor que quien invoca la acción es
 * moderador (no basta con que la UI solo muestre el control a
 * moderadores). Usa el cliente SSR normal (no el admin): la política
 * `listings_update_moderator` (0010_listing_status_lifecycle.sql) ya
 * permite esta actualización para un moderador; el trigger
 * `listings_protect_status_update` (misma migración) es la última línea
 * de defensa a nivel de base de datos, sin importar quién invoque el
 * UPDATE.
 *
 * Si el trigger `listings_require_min_photos_to_publish` (T-10, 0009)
 * rechaza la transición a 'publicado' por falta de fotos, se traduce el
 * error crudo de Postgres a un mensaje amigable en vez de mostrarlo tal
 * cual.
 */
export async function actualizarEstadoAnuncio(
  _prevState: ModeradorAnuncioAccionState,
  formData: FormData
): Promise<ModeradorAnuncioAccionState> {
  const listingId = String(formData.get("listing_id") ?? "");
  const nuevoEstado = String(formData.get("status") ?? "");

  if (!listingId) {
    return { error: "Falta el identificador del anuncio." };
  }

  if (!esEstadoDestinoValido(nuevoEstado)) {
    return { error: "Estado de destino inválido." };
  }

  const supabase = await createSupabaseServerClient();

  const moderador = await requireModerador(supabase);
  if (!moderador) {
    return {
      error: "No tienes permisos de moderador para realizar esta acción.",
    };
  }

  const { error: updateError } = await supabase
    .from("listings")
    .update({ status: nuevoEstado })
    .eq("id", listingId);

  if (updateError) {
    if (updateError.message.includes("al menos 3 fotos")) {
      return {
        error:
          "El anuncio necesita al menos 3 fotos para poder publicarse.",
      };
    }

    return {
      error: `No se pudo actualizar el estado del anuncio: ${updateError.message}`,
    };
  }

  revalidatePath("/moderador/anuncios");

  return { error: null };
}
