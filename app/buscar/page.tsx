import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const formateadorPrecio = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

type Anuncio = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number;
  price: number;
  location: string;
};

type FiltrosBusqueda = {
  brand?: string;
  model?: string;
  year?: string;
  location?: string;
};

/**
 * Página pública de búsqueda de anuncios (T-13, REQ-06).
 *
 * No requiere sesión: usa el cliente Supabase normal (SSR, con la
 * cookie de sesión si existe, pero funciona igual sin ella). La policy
 * `listings_select_published` (0002_rls_policies.sql) ya permite a
 * CUALQUIERA -anon o authenticated- leer anuncios en estado
 * "publicado", así que no hace falta el cliente admin ni verificar rol.
 *
 * Los filtros (marca, modelo, año, ubicación) viajan por `searchParams`
 * (query string), no por un formulario controlado del lado cliente: el
 * `<form method="get">` de abajo navega a `/buscar?brand=...` y este
 * Server Component vuelve a renderizar con los nuevos filtros. Esto
 * evita tener que marcar el componente como cliente o usar una Server
 * Action solo para leer texto.
 *
 * Decisión de diseño para `year`: se usa coincidencia EXACTA (no rango),
 * porque el criterio de aceptación (REQ-06) solo pide poder filtrar por
 * año y un rango agregaría complejidad de UI (dos inputs, validación de
 * año mínimo/máximo) que no está pedida para este MVP. Si a futuro se
 * necesita un rango, alcanza con agregar `yearFrom`/`yearTo` y cambiar
 * el `.eq` por `.gte`/`.lte`.
 */
export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<FiltrosBusqueda>;
}) {
  const filtros = await searchParams;

  const brand = filtros.brand?.trim() ?? "";
  const model = filtros.model?.trim() ?? "";
  const year = filtros.year?.trim() ?? "";
  const location = filtros.location?.trim() ?? "";

  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("listings")
    .select("id, brand, model, year, mileage, price, location")
    .eq("status", "publicado");

  if (brand) {
    query = query.ilike("brand", `%${brand}%`);
  }
  if (model) {
    query = query.ilike("model", `%${model}%`);
  }
  if (location) {
    query = query.ilike("location", `%${location}%`);
  }
  if (year) {
    const yearNumero = Number(year);
    if (Number.isInteger(yearNumero)) {
      query = query.eq("year", yearNumero);
    }
  }

  const { data: listingsData, error: listingsError } = await query.order(
    "created_at",
    { ascending: false }
  );

  const listings = (listingsData ?? []) as Anuncio[];

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-2">
        <h1 className="text-2xl font-semibold">Buscar autos</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Filtra entre los anuncios publicados por marca, modelo, año y
          ubicación.
        </p>
      </div>

      <form
        method="get"
        className="flex w-full max-w-3xl flex-col gap-4 rounded border border-black/[.15] p-4 dark:border-white/[.2]"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            Marca
            <input
              type="text"
              name="brand"
              defaultValue={brand}
              placeholder="Ej: Toyota"
              className="rounded border border-black/[.15] px-3 py-2 dark:border-white/[.2] dark:bg-black"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Modelo
            <input
              type="text"
              name="model"
              defaultValue={model}
              placeholder="Ej: Yaris"
              className="rounded border border-black/[.15] px-3 py-2 dark:border-white/[.2] dark:bg-black"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Año
            <input
              type="number"
              name="year"
              defaultValue={year}
              placeholder="Ej: 2020"
              className="rounded border border-black/[.15] px-3 py-2 dark:border-white/[.2] dark:bg-black"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ubicación
            <input
              type="text"
              name="location"
              defaultValue={location}
              placeholder="Ej: Santiago"
              className="rounded border border-black/[.15] px-3 py-2 dark:border-white/[.2] dark:bg-black"
            />
          </label>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded bg-foreground px-5 py-2 text-sm font-medium text-background"
          >
            Buscar
          </button>
          <Link
            href="/buscar"
            className="rounded border border-black/[.15] px-5 py-2 text-sm font-medium dark:border-white/[.2]"
          >
            Limpiar filtros
          </Link>
        </div>
      </form>

      {listingsError && (
        <p className="text-sm text-red-600" role="alert">
          Ocurrió un error al buscar anuncios. Intenta nuevamente más
          tarde.
        </p>
      )}

      {!listingsError && listings.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No se encontraron anuncios con esos filtros.
        </p>
      )}

      {!listingsError && listings.length > 0 && (
        <ul className="flex w-full max-w-3xl flex-col gap-4">
          {listings.map((listing) => (
            <li
              key={listing.id}
              className="flex flex-col gap-1 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]"
            >
              <p>
                <strong>
                  {listing.brand} {listing.model} ({listing.year})
                </strong>
              </p>
              <p>
                Precio:{" "}
                <strong>
                  {formateadorPrecio.format(Number(listing.price))}
                </strong>
              </p>
              <p>
                Kilometraje:{" "}
                <strong>{listing.mileage.toLocaleString("es-CL")} km</strong>
              </p>
              <p>
                Ubicación: <strong>{listing.location}</strong>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
