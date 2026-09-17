"use client";

import { useState } from "react";

/**
 * Foto de portada de un anuncio en los resultados de búsqueda (T-21).
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
 * T-25: antes esto era una miniatura fija de 64x64px pensada para una
 * columna de tabla. Ahora el componente ya no fija su propio tamaño: llena
 * el 100% del contenedor (`h-full w-full`) y es responsabilidad de quien lo
 * use (la card de `app/buscar/page.tsx`) definir el tamaño/aspect-ratio a
 * través de un contenedor con `aspect-*` — así una misma pieza sirve tanto
 * para una miniatura pequeña como para la imagen dominante de una card
 * visual, sin duplicar el componente.
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
      <div className="flex h-full w-full items-center justify-center bg-surface-muted text-center text-body-sm text-foreground-subtle">
        Sin foto
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Foto del anuncio"
      className="h-full w-full object-cover"
      onError={() => setFallo(true)}
    />
  );
}
