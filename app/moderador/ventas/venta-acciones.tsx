"use client";

import { useActionState } from "react";
import { aprobarVenta, initialAprobarVentaState } from "./actions";

/**
 * Botón "Aprobar venta" para una fila del panel de moderador de ventas
 * (T-16). A diferencia de `AnuncioAcciones` (T-12, varios estados
 * destino posibles), acá hay una única acción posible desde
 * 'pendiente_aprobacion': aprobar. `aprobarVenta` ya está atada a este
 * `saleId` particular vía closure (mismo patrón usado para acciones con
 * un solo argumento identificador en el resto del proyecto).
 */
export function VentaAcciones({ saleId }: { saleId: string }) {
  const aprobarVentaConId = aprobarVenta.bind(null, saleId);
  const [state, formAction, isPending] = useActionState(
    aprobarVentaConId,
    initialAprobarVentaState
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
      >
        {isPending ? "Aprobando..." : "Aprobar venta"}
      </button>

      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
