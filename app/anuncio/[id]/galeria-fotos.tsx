"use client";

import { useState } from "react";
import { FotoMiniatura } from "@/app/buscar/foto-miniatura";

/**
 * Galería de fotos del detalle de un anuncio (T-26): imagen grande +
 * miniaturas clickeables debajo. Reutiliza `FotoMiniatura` (T-21) tanto
 * para la imagen principal como para cada miniatura, así el fallback a
 * placeholder "Sin foto" ante un `storage_path` roto (archivo borrado del
 * bucket pero fila viva en `listing_photos`) queda cubierto sin duplicar
 * lógica, igual que en `app/buscar/anuncio-card.tsx`.
 *
 * Necesita ser un Client Component porque la selección de foto activa es
 * interactividad pura de UI (no depende de ningún dato del servidor más
 * allá de la lista de URLs ya resueltas que recibe por props).
 *
 * Si el anuncio no tiene fotos (`fotosUrls` vacío), se delega directo en
 * `FotoMiniatura` con `url={null}` para mostrar el mismo placeholder
 * establecido en el resto del sitio, sin fila de miniaturas.
 */
export function GaleriaFotos({ fotosUrls }: { fotosUrls: string[] }) {
  const [indiceSeleccionado, setIndiceSeleccionado] = useState(0);

  if (fotosUrls.length === 0) {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded-card bg-surface-muted">
        <FotoMiniatura url={null} />
      </div>
    );
  }

  // Por si `indiceSeleccionado` quedó apuntando fuera de rango (no debería
  // pasar en uso normal, pero evita un índice inválido si `fotosUrls`
  // cambiara de tamaño entre renders).
  const indiceActivo = Math.min(indiceSeleccionado, fotosUrls.length - 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-[4/3] w-full overflow-hidden rounded-card border border-border bg-surface-muted">
        <FotoMiniatura url={fotosUrls[indiceActivo]} />
      </div>

      {fotosUrls.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {fotosUrls.map((url, indice) => (
            <button
              key={`${indice}-${url}`}
              type="button"
              onClick={() => setIndiceSeleccionado(indice)}
              aria-label={`Ver foto ${indice + 1} de ${fotosUrls.length}`}
              aria-current={indice === indiceActivo}
              className={`h-16 w-20 shrink-0 overflow-hidden rounded-control border-2 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                indice === indiceActivo
                  ? "border-primary"
                  : "border-transparent hover:border-border-strong"
              }`}
            >
              <FotoMiniatura url={url} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
