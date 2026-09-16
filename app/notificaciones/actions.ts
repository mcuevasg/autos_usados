"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MarcarLeidaState = {
  error: string | null;
};

export const initialMarcarLeidaState: MarcarLeidaState = {
  error: null,
};

/**
 * Server Action (T-19): marca una notificación propia como leída.
 *
 * Usa el cliente SSR autenticado normal (no el admin, a diferencia de
 * `crearNotificacion` en lib/notifications.ts): la política
 * `notifications_update_own` (0002_rls_policies.sql) ya garantiza, tanto
 * en `using` como en `with check`, que `auth.uid() = user_id` — un
 * usuario solo puede marcar como leídas SUS PROPIAS notificaciones, así
 * que no hace falta volver a verificar manualmente el dueño en esta
 * función (si intenta marcar una ajena, RLS simplemente no afecta
 * ninguna fila).
 */
export async function marcarLeida(
  notificationId: string,
  // Requeridos por la firma de acción de useActionState (prevState,
  // formData), pero no se usan: el botón "Marcar como leída" no envía
  // ningún input adicional, mismo patrón que `aprobarVenta`
  // (app/moderador/ventas/actions.ts).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: MarcarLeidaState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<MarcarLeidaState> {
  if (!notificationId) {
    return { error: "Falta el identificador de la notificación." };
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Debes iniciar sesión para marcar notificaciones." };
  }

  const { error: updateError } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId);

  if (updateError) {
    return {
      error: `No se pudo marcar la notificación como leída: ${updateError.message}`,
    };
  }

  revalidatePath("/notificaciones");

  return { error: null };
}
