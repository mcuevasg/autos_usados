"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { crearNotificacion } from "@/lib/notifications";
import { enviarEmailEvento, obtenerEmailUsuario } from "@/lib/email";

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

// Etiquetas amigables para el mensaje de notificación (T-19); mismos
// valores que `OPCIONES_ESTADO` en anuncio-acciones.tsx.
const ETIQUETAS_ESTADO: Record<EstadoDestino, string> = {
  borrador: "Borrador",
  publicado: "Publicado",
  pausado: "Pausado",
  vendido: "Vendido",
  rechazado: "Rechazado",
};

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

  const { data: updatedListing, error: updateError } = await supabase
    .from("listings")
    .update({ status: nuevoEstado })
    .eq("id", listingId)
    .select("brand, model, seller_id")
    .maybeSingle();

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

  // Notifica al dueño del anuncio (T-19) DESPUÉS de que el cambio de
  // estado principal haya tenido éxito. `updatedListing` viene del mismo
  // UPDATE (select("brand, model, seller_id")); resolver el `user_id` del
  // vendedor sí requiere una consulta adicional a `sellers`
  // (`listings_select_moderator`/`sellers_select_moderator`,
  // 0006/0010, ya permiten esta lectura a un moderador). Una notificación
  // fallida no debe bloquear esta Server Action (ver comentario en
  // lib/notifications.ts).
  if (updatedListing?.seller_id) {
    const { data: seller } = await supabase
      .from("sellers")
      .select("user_id")
      .eq("id", updatedListing.seller_id)
      .maybeSingle();

    if (seller?.user_id) {
      await crearNotificacion({
        userId: seller.user_id,
        eventType: "listing_status_changed",
        message:
          `Tu anuncio ${updatedListing.brand} ${updatedListing.model} ` +
          `pasó a estado ${ETIQUETAS_ESTADO[nuevoEstado]}.`,
      });

      // Email (T-20), además de la notificación in-app: ver
      // lib/email.ts para el diseño "fire and forget" y la limitación de
      // Resend en modo sandbox (sin dominio propio verificado).
      const email = await obtenerEmailUsuario(seller.user_id);
      if (email) {
        await enviarEmailEvento({
          to: email,
          subject: "Tu anuncio cambió de estado",
          html:
            `<p>Tu anuncio <strong>${updatedListing.brand} ${updatedListing.model}</strong> ` +
            `pasó a estado <strong>${ETIQUETAS_ESTADO[nuevoEstado]}</strong>.</p>`,
        });
      }
    }
  }

  revalidatePath("/moderador/anuncios");

  return { error: null };
}
