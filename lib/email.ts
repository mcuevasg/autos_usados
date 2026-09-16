import "server-only";

import { Resend } from "resend";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type EnviarEmailEventoParams = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Remitente de pruebas que Resend permite usar sin verificar un dominio
 * propio (T-20, ver .project/architecture.md: Resend como proveedor de
 * email con tier gratuito).
 *
 * LIMITACIÓN DE LA PLATAFORMA (no del código): mientras la cuenta Resend
 * no tenga un dominio propio verificado, el modo "sandbox" de Resend solo
 * entrega correos a la casilla con la que se creó la cuenta Resend,
 * cualquier otro destinatario será rechazado o simplemente no llegará.
 * Cuando se verifique un dominio propio en producción, esto se resuelve
 * cambiando únicamente este remitente por uno del dominio verificado
 * (ej. notificaciones@tudominio.com), sin tocar el resto de la lógica de
 * `enviarEmailEvento` ni de los llamadores.
 */
const REMITENTE = "onboarding@resend.dev";

/**
 * Envía un email transaccional ligado a un evento de la app (T-20: cambio
 * de estado de anuncio, aprobación de venta), usando Resend.
 *
 * DISEÑO "fire and forget", MISMO PATRÓN que `crearNotificacion` (T-19,
 * lib/notifications.ts): try/catch, si falla se deja constancia con
 * `console.error` (incluyendo destinatario y asunto para poder
 * correlacionar en los logs), pero esta función NUNCA lanza ni bloquea al
 * llamador. Motivo: para cuando se invoca esta función, la acción
 * principal del moderador (aprobar venta, cambiar estado de un anuncio)
 * ya se aplicó con éxito — un email fallido es secundario y no debe hacer
 * fallar ni revertir esa Server Action.
 */
export async function enviarEmailEvento({
  to,
  subject,
  html,
}: EnviarEmailEventoParams): Promise<void> {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: REMITENTE,
      to,
      subject,
      html,
    });

    if (error) {
      console.error(
        `[email] No se pudo enviar el email (to=${to}, subject="${subject}"): ` +
          `${error.message}`
      );
    }
  } catch (err) {
    console.error(
      `[email] Error inesperado al enviar el email (to=${to}, subject="${subject}"):`,
      err
    );
  }
}

/**
 * Obtiene el email de un usuario a partir de su `userId` (auth.users.id).
 *
 * Requiere el cliente admin (`createSupabaseAdminClient()`, service_role)
 * porque el email del usuario vive únicamente en `auth.users`, una tabla
 * gestionada por Supabase Auth que no está expuesta a través de ninguna
 * tabla normal accesible por RLS (`profiles` no tiene columna `email`):
 * solo la API admin (`auth.admin.getUserById`) puede leerlo.
 *
 * Devuelve `null` si el usuario no existe, no tiene email, o la consulta
 * falla (se loguea el error, pero no se lanza, consistente con el diseño
 * "fire and forget" de este módulo: el llamador simplemente omite el
 * envío del email si no hay destinatario).
 */
export async function obtenerEmailUsuario(
  userId: string
): Promise<string | null> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin.auth.admin.getUserById(
      userId
    );

    if (error) {
      console.error(
        `[email] No se pudo obtener el email del usuario (user_id=${userId}): ` +
          `${error.message}`
      );
      return null;
    }

    return data.user?.email ?? null;
  } catch (err) {
    console.error(
      `[email] Error inesperado al obtener el email del usuario (user_id=${userId}):`,
      err
    );
    return null;
  }
}
