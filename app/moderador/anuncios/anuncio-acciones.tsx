"use client";

import { useActionState } from "react";
import {
  actualizarEstadoAnuncio,
  type ModeradorAnuncioAccionState,
} from "./actions";

const initialModeradorAnuncioAccionState: ModeradorAnuncioAccionState = {
  error: null,
};

const OPCIONES_ESTADO: { value: string; label: string }[] = [
  { value: "borrador", label: "Borrador" },
  { value: "publicado", label: "Publicado" },
  { value: "pausado", label: "Pausado" },
  { value: "vendido", label: "Vendido" },
  { value: "rechazado", label: "Rechazado" },
];

/**
 * Control de cambio de estado para una fila del panel de moderador de
 * anuncios (T-12). A diferencia de `VendedorAcciones` (T-08, solo 2
 * estados destino), acá hay 5 estados posibles, así que se usa un
 * `<select>` con botón "Aplicar" en vez de un botón por estado.
 */
export function AnuncioAcciones({
  listingId,
  estadoActual,
}: {
  listingId: string;
  estadoActual: string;
}) {
  const [state, formAction, isPending] = useActionState(
    actualizarEstadoAnuncio,
    initialModeradorAnuncioAccionState
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="listing_id" value={listingId} />

      <div className="flex items-center gap-2">
        <select
          name="status"
          defaultValue={estadoActual}
          disabled={isPending}
          className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm disabled:opacity-60 dark:border-white/[.2]"
        >
          {OPCIONES_ESTADO.map((opcion) => (
            <option key={opcion.value} value={opcion.value}>
              {opcion.label}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
        >
          Aplicar
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
