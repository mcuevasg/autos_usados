"use client";

import { useActionState } from "react";
import { borrarFoto, type FotosFormState } from "./actions";

const initialFotosFormState: FotosFormState = { error: null };

/**
 * Preview de una foto ya subida, con botón para borrarla (buena práctica
 * menor de T-10, no exigida por el criterio de aceptación).
 */
export function FotoItem({
  listingId,
  photoId,
  signedUrl,
}: {
  listingId: string;
  photoId: string;
  signedUrl: string | null;
}) {
  const borrarFotoDelAnuncio = borrarFoto.bind(null, listingId);
  const [state, formAction, isPending] = useActionState(
    borrarFotoDelAnuncio,
    initialFotosFormState
  );

  return (
    <li className="flex flex-col gap-2 rounded border border-black/[.15] p-2 text-sm dark:border-white/[.2]">
      {signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={signedUrl}
          alt="Foto del anuncio"
          className="h-32 w-full rounded object-cover"
        />
      ) : (
        <div className="flex h-32 w-full items-center justify-center rounded bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-900">
          No disponible
        </div>
      )}

      <form action={formAction}>
        <input type="hidden" name="photo_id" value={photoId} />
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:opacity-60 dark:border-white/[.2] dark:hover:bg-white/[.08]"
        >
          {isPending ? "Borrando..." : "Borrar"}
        </button>
      </form>

      {state.error && (
        <p className="text-xs text-red-600" role="alert">
          {state.error}
        </p>
      )}
    </li>
  );
}
