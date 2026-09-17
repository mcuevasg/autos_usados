"use client";

import { useActionState } from "react";
import { subirFotos, type FotosFormState } from "./actions";

const initialFotosFormState: FotosFormState = { error: null };

/**
 * Formulario de subida de fotos de un anuncio (T-10).
 *
 * Input de archivo múltiple (`accept="image/*"`); se apoya en el patrón
 * `Server Action.bind(null, listingId)` recomendado por Next.js para
 * pasarle un argumento fijo a una Server Action usada con
 * `useActionState`.
 */
export function FotosForm({ listingId }: { listingId: string }) {
  const subirFotosDelAnuncio = subirFotos.bind(null, listingId);

  const [state, formAction, isPending] = useActionState<
    FotosFormState,
    FormData
  >(subirFotosDelAnuncio, initialFotosFormState);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="fotos" className="text-sm font-medium">
          Fotos del anuncio
        </label>
        <input
          id="fotos"
          name="fotos"
          type="file"
          accept="image/*"
          multiple
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
        {isPending ? "Subiendo..." : "Subir fotos"}
      </button>
    </form>
  );
}
