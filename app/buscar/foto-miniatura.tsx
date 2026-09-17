"use client";

import { useState } from "react";

/**
 * Miniatura de la primera foto de un anuncio en los resultados de
 * búsqueda (T-21).
 *
 * Necesita ser un Client Component (a diferencia del resto de
 * `app/buscar/page.tsx`, que es un Server Component) porque el fallback a
 * placeholder ante un error de carga de la imagen depende del evento
 * `onError` del navegador, que no existe del lado del servidor. Este caso
 * puede darse incluso con una fila de `listing_photos` válida y una URL
 * firmada bien generada, si el archivo referenciado en `storage_path` ya
 * no existe en el bucket (ej. se borró manualmente en Storage sin borrar
 * la fila).
 *
 * Se usa `<img>` nativo (no `next/image`): `next.config.ts` no declara
 * `images.remotePatterns` para el dominio de Supabase Storage, así que
 * `next/image` fallaría al intentar optimizar una URL externa no
 * permitida.
 */
export function FotoMiniatura({ url }: { url: string | null }) {
  const [fallo, setFallo] = useState(false);

  if (!url || fallo) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-zinc-100 text-center text-[10px] leading-tight text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        Sin foto
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Foto del anuncio"
      className="h-16 w-16 shrink-0 rounded object-cover"
      onError={() => setFallo(true)}
    />
  );
}
