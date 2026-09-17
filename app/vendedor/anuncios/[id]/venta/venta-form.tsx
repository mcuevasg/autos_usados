"use client";

import { useActionState } from "react";
import { solicitarVenta, type VentaFormState } from "./actions";

const initialVentaFormState: VentaFormState = { error: null };

/**
 * Formulario de solicitud de venta concretada de un anuncio (T-15).
 *
 * Se apoya en el patrón `Server Action.bind(null, listingId)` (mismo
 * usado en `app/vendedor/anuncios/[id]/fotos/fotos-form.tsx`) para
 * pasarle el id del anuncio a la Server Action usada con
 * `useActionState`.
 */
export function VentaForm({ listingId }: { listingId: string }) {
  const solicitarVentaDelAnuncio = solicitarVenta.bind(null, listingId);

  const [state, formAction, isPending] = useActionState<
    VentaFormState,
    FormData
  >(solicitarVentaDelAnuncio, initialVentaFormState);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="final_price" className="text-sm font-medium">
          Precio final de venta
        </label>
        <input
          id="final_price"
          name="final_price"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
      </div>

      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
      >
        {isPending ? "Enviando..." : "Solicitar venta concretada"}
      </button>
    </form>
  );
}
