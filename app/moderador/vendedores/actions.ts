"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ModeradorAccionState = {
  error: string | null;
};

export const initialModeradorAccionState: ModeradorAccionState = {
  error: null,
};

const ESTADOS_DESTINO = ["verificado", "rechazado"] as const;
type EstadoDestino = (typeof ESTADOS_DESTINO)[number];

function esEstadoDestinoValido(valor: string): valor is EstadoDestino {
  return (ESTADOS_DESTINO as readonly string[]).includes(valor);
}

/**
 * Confirma en servidor (no confía en la UI) que el usuario autenticado
 * tiene `profiles.role === 'moderador'`. Devuelve el user autenticado si
 * corresponde, o null si no hay sesión o no es moderador.
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
 * Server Action del panel de moderador (T-08): cambia
 * `sellers.verification_status` a 'verificado' o 'rechazado'.
 *
 * Vuelve a verificar en servidor que quien invoca la acción es
 * moderador (no basta con que la UI solo muestre el botón a
 * moderadores). Usa el cliente SSR normal (no el admin): la política
 * `sellers_update_moderator` (0006_moderator_seller_review.sql) ya
 * permite esta actualización para un moderador.
 */
export async function actualizarEstadoVendedor(
  _prevState: ModeradorAccionState,
  formData: FormData
): Promise<ModeradorAccionState> {
  const sellerId = String(formData.get("seller_id") ?? "");
  const nuevoEstado = String(formData.get("verification_status") ?? "");

  if (!sellerId) {
    return { error: "Falta el identificador del vendedor." };
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
    .from("sellers")
    .update({ verification_status: nuevoEstado })
    .eq("id", sellerId);

  if (updateError) {
    return {
      error: `No se pudo actualizar el estado del vendedor: ${updateError.message}`,
    };
  }

  revalidatePath("/moderador/vendedores");

  return { error: null };
}
