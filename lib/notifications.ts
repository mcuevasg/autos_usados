import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type CrearNotificacionParams = {
  userId: string;
  eventType: string;
  message: string;
};

/**
 * Crea una notificación in-app (T-19) para el usuario afectado por un
 * cambio de estado (verificación de vendedor, estado de anuncio,
 * aprobación de venta).
 *
 * Usa `createSupabaseAdminClient()` (service_role) porque no existe
 * ninguna política de INSERT sobre `notifications` para `authenticated`
 * en `supabase/migrations/0002_rls_policies.sql` (solo
 * `notifications_select_own` y `notifications_update_own`): la intención
 * ya estaba documentada desde 0004_profiles_and_roles.sql — "las
 * notificaciones se crean desde el servidor (service_role, que bypassa
 * RLS) al ocurrir los eventos correspondientes (T-19)".
 *
 * DECISIÓN DE DISEÑO ("fire and forget" sin tragarse errores en
 * silencio): si el insert falla, se deja constancia con `console.error`
 * (incluyendo `eventType`/`userId` para poder correlacionar en los logs),
 * pero esta función NUNCA lanza ni devuelve un error que el llamador deba
 * propagar. Motivo: para cuando se invoca esta función, el cambio de
 * estado principal (sellers.verification_status, listings.status,
 * sales.status) ya se aplicó con éxito — una notificación fallida es un
 * problema secundario (el usuario simplemente no verá el aviso en
 * /notificaciones) y NO debe hacer fallar ni revertir la Server Action
 * del moderador que la originó (ej. no queremos que aprobar una venta
 * responda con error solo porque no se pudo insertar la notificación).
 */
export async function crearNotificacion({
  userId,
  eventType,
  message,
}: CrearNotificacionParams): Promise<void> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: userId,
      event_type: eventType,
      message,
    });

    if (error) {
      console.error(
        `[notifications] No se pudo crear la notificación ` +
          `(event_type=${eventType}, user_id=${userId}): ${error.message}`
      );
    }
  } catch (err) {
    console.error(
      `[notifications] Error inesperado al crear la notificación ` +
        `(event_type=${eventType}, user_id=${userId}):`,
      err
    );
  }
}
