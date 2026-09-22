import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotificacionAcciones } from "./notificacion-acciones";

type Notification = {
  id: string;
  event_type: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
};

// Etiquetas amigables para los `event_type` conocidos, generados por las
// Server Actions de moderador (T-19: app/moderador/vendedores/actions.ts,
// app/moderador/anuncios/actions.ts, app/moderador/ventas/actions.ts).
// Un `event_type` desconocido (futuro, ej. T-20) se muestra tal cual.
const ETIQUETAS_EVENTO: Record<string, string> = {
  seller_verification_changed: "Verificación de vendedor",
  listing_status_changed: "Estado de anuncio",
  sale_approved: "Venta aprobada",
};

/**
 * Página de notificaciones in-app (T-19): lista las notificaciones del
 * usuario autenticado (cualquier rol), ordenadas de más reciente a más
 * antigua, indicando si ya fueron leídas y permitiendo marcarlas como
 * leídas.
 *
 * Requiere sesión activa (cualquier rol, a diferencia de las páginas de
 * `/moderador/*`); en caso contrario redirige a `/login`. La lista se
 * obtiene con el cliente SSR normal (no el admin): la política
 * `notifications_select_own` (0002_rls_policies.sql) ya permite que un
 * usuario lea SUS PROPIAS notificaciones (auth.uid() = user_id).
 *
 * Las notificaciones en sí se crean del lado del servidor (service_role,
 * `lib/notifications.ts`) al ocurrir los eventos correspondientes: no hay
 * ninguna acción de creación en esta página.
 */
// T-28 (spike cacheComponents): lee sesión/datos al tope sin Suspense.
// Ver nota en app/cuenta/page.tsx.
export const instant = false;

export default async function NotificacionesPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: notificationsData, error: notificationsError } =
    await supabase
      .from("notifications")
      .select("id, event_type, message, is_read, created_at")
      .order("created_at", { ascending: false });

  const notificaciones = (notificationsData ?? []) as Notification[];
  const noLeidas = notificaciones.filter((n) => !n.is_read).length;

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-col gap-2">
        <h1 className="text-2xl font-semibold">Notificaciones</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {noLeidas > 0
            ? `Tienes ${noLeidas} notificación${
                noLeidas === 1 ? "" : "es"
              } sin leer.`
            : "No tienes notificaciones sin leer."}
        </p>
      </div>

      {notificationsError && (
        <p className="text-sm text-red-600" role="alert">
          No se pudo leer la lista de notificaciones (
          {notificationsError.message}). Verifica que la migración
          0001_initial_schema.sql esté aplicada en Supabase.
        </p>
      )}

      {!notificationsError && notificaciones.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Todavía no tienes notificaciones.
        </p>
      )}

      <ul className="flex w-full max-w-2xl flex-col gap-4">
        {notificaciones.map((notificacion) => (
          <li
            key={notificacion.id}
            className={`flex items-start justify-between gap-4 rounded border p-4 text-sm ${
              notificacion.is_read
                ? "border-black/[.15] dark:border-white/[.2]"
                : "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
            }`}
          >
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-2">
                <strong>
                  {ETIQUETAS_EVENTO[notificacion.event_type] ??
                    notificacion.event_type}
                </strong>
                {!notificacion.is_read && (
                  <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">
                    Nueva
                  </span>
                )}
              </p>
              <p>{notificacion.message}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(notificacion.created_at).toLocaleString("es-CL")}
              </p>
            </div>

            {!notificacion.is_read && (
              <NotificacionAcciones notificationId={notificacion.id} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
