"use client";

import { useActionState } from "react";
import { marcarLeida, initialMarcarLeidaState } from "./actions";

/**
 * Botón "Marcar como leída" para una notificación no leída (T-19).
 * `marcarLeida` ya está atada a este `notificationId` particular vía
 * closure (mismo patrón que `VentaAcciones`,
 * app/moderador/ventas/venta-acciones.tsx, T-16).
 */
export function NotificacionAcciones({
  notificationId,
}: {
  notificationId: string;
}) {
  const marcarLeidaConId = marcarLeida.bind(null, notificationId);
  const [state, formAction, isPending] = useActionState(
    marcarLeidaConId,
    initialMarcarLeidaState
  );

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.2] dark:hover:bg-white/[.08]"
      >
        {isPending ? "Marcando..." : "Marcar como leída"}
      </button>

      {state.error && (
        <p className="text-xs text-red-600" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
