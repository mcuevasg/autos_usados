import { esDestacadoVigente } from "@/lib/listings";
import { FotoMiniatura } from "./foto-miniatura";

const formateadorPrecio = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

export type AnuncioCardData = {
  id: string;
  year: number;
  mileage: number;
  price: number;
  location: string;
  vehicle_condition: string;
  papers_up_to_date: boolean;
  featured_active: boolean;
  featured_expires_at: string | null;
};

/**
 * Tarjeta visual de un anuncio dentro de un grupo comparativo de `/buscar`
 * (T-25). Reemplaza la fila de tabla HTML que usaba esta página desde T-13:
 * mismos datos (foto, precio, año, kilometraje, estado, papeles al día,
 * vendedor, ubicación, badge de destacado de T-18), presentados como card
 * al estilo de los referentes de mercado (Kavak, Cars.com, CarGurus) —
 * imagen dominante, precio prominente, badges y specs con iconografía en
 * vez de columnas de tabla.
 *
 * Vive en su propio archivo (y no inline en `page.tsx`) para poder
 * testearla como componente aislado, sin tener que montar la página
 * completa ni tocar Supabase.
 */
export function AnuncioCard({
  anuncio,
  fotoUrl,
  tipoVendedorLabel,
}: {
  anuncio: AnuncioCardData;
  fotoUrl: string | null;
  tipoVendedorLabel: string;
}) {
  const destacado = esDestacadoVigente(anuncio);

  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
      {/* Imagen dominante: aspect-ratio fijo para que la grilla no salte de
       * alto entre cards con foto real y cards con placeholder. */}
      <div className="relative aspect-[4/3] w-full shrink-0 bg-surface-muted">
        <FotoMiniatura url={fotoUrl} />
        {destacado && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-pill bg-accent-soft px-2.5 py-1 text-caption font-semibold text-foreground shadow-card">
            ⭐ Destacado
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="font-display text-heading-2 text-foreground">
          {formateadorPrecio.format(Number(anuncio.price))}
        </p>

        {/* Specs con iconografía simple (emojis): no se agregó ninguna
         * librería de iconos nueva porque el proyecto no traía una (ver
         * package.json). */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-body-sm text-foreground-muted">
          <div className="flex items-center gap-1.5">
            <dt aria-hidden="true">📅</dt>
            <dd>{anuncio.year}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt aria-hidden="true">🛣️</dt>
            <dd>{anuncio.mileage.toLocaleString("es-CL")} km</dd>
          </div>
          <div className="col-span-2 flex items-center gap-1.5">
            <dt aria-hidden="true">🔧</dt>
            <dd className="truncate">{anuncio.vehicle_condition}</dd>
          </div>
          <div className="col-span-2 flex items-center gap-1.5">
            <dt aria-hidden="true">{anuncio.papers_up_to_date ? "✅" : "⚠️"}</dt>
            <dd>
              {anuncio.papers_up_to_date
                ? "Papeles al día"
                : "Papeles pendientes"}
            </dd>
          </div>
        </dl>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-caption text-foreground-subtle">
          <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true">👤</span>
            <span className="truncate">{tipoVendedorLabel}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span aria-hidden="true">📍</span>
            {anuncio.location}
          </span>
        </div>
      </div>
    </article>
  );
}
