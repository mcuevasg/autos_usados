"use client";

import { useActionState } from "react";
import { activarDestacado, type DestacarFormState } from "./actions";

const initialDestacarFormState: DestacarFormState = { error: null };

/**
 * Formulario (sin campos, solo un botón de confirmación) de activación del
 * plan "Destacado" sobre un anuncio propio (T-17).
 *
 * Se apoya en el patrón `Server Action.bind(null, listingId)` (mismo usado
 * en `app/vendedor/anuncios/[id]/venta/venta-form.tsx`) para pasarle el id
 * del anuncio a la Server Action usada con `useActionState`.
 */
export function DestacarForm({ listingId }: { listingId: string }) {
  const activarDestacadoDelAnuncio = activarDestacado.bind(null, listingId);

  const [state, formAction, isPending] = useActionState<
    DestacarFormState,
    FormData
  >(activarDestacadoDelAnuncio, initialDestacarFormState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        El plan destacado dura 30 días desde su activación.
      </p>

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
        {isPending ? "Activando..." : "Activar plan Destacado"}
      </button>
    </form>
  );
}
