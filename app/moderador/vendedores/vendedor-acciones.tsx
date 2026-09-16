"use client";

import { useActionState } from "react";
import {
  actualizarEstadoVendedor,
  initialModeradorAccionState,
} from "./actions";

/**
 * Botones "Verificar" / "Rechazar" para una fila del panel de moderador
 * (T-08). Cada botón envía el mismo Server Action con un
 * `verification_status` de destino distinto, vía su propio `<button
 * formAction>` con un hidden input de `seller_id` (patrón simple sin
 * necesitar un formulario por botón).
 */
export function VendedorAcciones({ sellerId }: { sellerId: string }) {
  const [state, formAction, isPending] = useActionState(
    actualizarEstadoVendedor,
    initialModeradorAccionState
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="seller_id" value={sellerId} />

      <div className="flex gap-2">
        <button
          type="submit"
          name="verification_status"
          value="verificado"
          disabled={isPending}
          className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
        >
          Verificar
        </button>
        <button
          type="submit"
          name="verification_status"
          value="rechazado"
          disabled={isPending}
          className="rounded-full border border-black/[.15] px-4 py-1.5 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.2] dark:hover:bg-white/[.08]"
        >
          Rechazar
        </button>
      </div>

      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
