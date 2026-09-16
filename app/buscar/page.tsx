import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { esDestacadoVigente } from "@/lib/listings";

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
  vehicle_condition: string;
  papers_up_to_date: boolean;
  seller_id: string;
  featured_active: boolean;
  featured_expires_at: string | null;
};

type FiltrosBusqueda = {
  brand?: string;
  model?: string;
  year?: string;
  location?: string;
};

type SellerType = "persona_natural" | "concesionario";

const ETIQUETA_TIPO_VENDEDOR: Record<SellerType, string> = {
  persona_natural: "Persona natural",
  concesionario: "Concesionario",
};

/**
 * Tamaño del "bucket" de años usado para agrupar anuncios por rango de
 * año similar (T-14, REQ-07).
 *
 * Ni `architecture.md` ni `requeriments.md` especifican la tolerancia
 * exacta de "rango de año similar", así que para esta primera iteración
 * se define arbitrariamente como buckets fijos de 3 años consecutivos
 * (ej. 2018-2020, 2021-2023), calculados como
 * `Math.floor(year / TAMANIO_BUCKET_ANIO) * TAMANIO_BUCKET_ANIO`. Es una
 * heurística simple y determinista; si el negocio define un criterio
 * distinto (ej. rango deslizante ±1 año), basta con cambiar esta
 * constante y la función `bucketAnio`.
 */
const TAMANIO_BUCKET_ANIO = 3;

function bucketAnio(year: number): number {
  return Math.floor(year / TAMANIO_BUCKET_ANIO) * TAMANIO_BUCKET_ANIO;
}

type GrupoComparativo = {
  clave: string;
  brand: string;
  model: string;
  anioMin: number;
  anioMax: number;
  anuncios: Anuncio[];
};

/**
 * Agrupa anuncios ya filtrados por marca + modelo (normalizados a
 * minúsculas/trim, insensible a mayúsculas) y, dentro de cada grupo
 * marca+modelo, sub-agrupa por bucket de año (ver `bucketAnio`).
 */
function agruparPorSimilitud(anuncios: Anuncio[]): GrupoComparativo[] {
  const grupos = new Map<string, GrupoComparativo>();

  for (const anuncio of anuncios) {
    const brandNormalizada = anuncio.brand.trim().toLowerCase();
    const modelNormalizado = anuncio.model.trim().toLowerCase();
    const bucket = bucketAnio(anuncio.year);
    const clave = `${brandNormalizada}::${modelNormalizado}::${bucket}`;

    const grupoExistente = grupos.get(clave);
    if (grupoExistente) {
      grupoExistente.anuncios.push(anuncio);
      grupoExistente.anioMin = Math.min(grupoExistente.anioMin, anuncio.year);
      grupoExistente.anioMax = Math.max(grupoExistente.anioMax, anuncio.year);
    } else {
      grupos.set(clave, {
        clave,
        brand: anuncio.brand,
        model: anuncio.model,
        anioMin: anuncio.year,
        anioMax: anuncio.year,
        anuncios: [anuncio],
      });
    }
  }

  return Array.from(grupos.values()).sort((a, b) => {
    const comparacionMarca = a.brand.localeCompare(b.brand);
    if (comparacionMarca !== 0) return comparacionMarca;
    const comparacionModelo = a.model.localeCompare(b.model);
    if (comparacionModelo !== 0) return comparacionModelo;
    return a.anioMin - b.anioMin;
  });
}

/**
 * Página pública de búsqueda de anuncios (T-13, REQ-06) con agrupación
 * automática por similitud (T-14, REQ-07).
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
 *
 * Decisión de diseño para "vendedor" (T-14): el criterio de aceptación
 * (REQ-07) pide mostrar el "vendedor" por cada anuncio, pero la tabla
 * `sellers` guarda `rut` (dato sensible, PII) que nunca debe exponerse
 * públicamente, y sus políticas RLS no permiten lectura pública. En vez
 * de abrir el RLS de `sellers`, se consulta la vista acotada
 * `sellers_public_info` (0012_sellers_public_view.sql), que solo expone
 * `id` y `seller_type`, para mostrar únicamente el TIPO de vendedor
 * (persona natural / concesionario) junto a cada anuncio.
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
    .select(
      "id, brand, model, year, mileage, price, location, vehicle_condition, papers_up_to_date, seller_id, featured_active, featured_expires_at"
    )
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

  // T-18 (REQ-09): prioridad de posición para anuncios con plan
  // destacado VIGENTE. Se ordena `listings` ANTES de agrupar (en vez de
  // limitarse al `order("created_at", ...)` de la query, que sigue
  // determinando el orden dentro de cada "empate") para que los
  // destacados vigentes queden primero tanto en la lista base como, por
  // construcción, dentro de cada grupo comparativo armado por
  // `agruparPorSimilitud` (que preserva el orden de iteración del array
  // de entrada al ir empujando anuncios a `grupoExistente.anuncios`).
  // `Array.prototype.sort` en V8/Node es ESTABLE, así que dos anuncios
  // con el mismo valor de "destacado" (ambos vigentes entre sí, o ambos
  // no vigentes entre sí) conservan el orden secundario que ya traían:
  // `created_at` descendente, el mismo criterio usado desde T-13 para el
  // resto de los resultados.
  //
  // Se usa `esDestacadoVigente` (lib/listings.ts) y NUNCA
  // `featured_active` crudo: como no existe ningún cron que apague
  // `featured_active` al expirar (T-17), un anuncio con el plan vencido
  // pero `featured_active` todavía en `true` en la BD debe volver al
  // orden estándar de forma automática, sin ningún job adicional en esta
  // iteración.
  const listingsOrdenados = [...listings].sort((a, b) => {
    const aVigente = esDestacadoVigente(a) ? 1 : 0;
    const bVigente = esDestacadoVigente(b) ? 1 : 0;
    return bVigente - aVigente;
  });

  // Segunda consulta, acotada a la vista pública `sellers_public_info`
  // (solo id + seller_type), para no tener que abrir el RLS de
  // `sellers` completo. Solo se piden los sellers presentes en los
  // resultados ya filtrados.
  const sellerIds = Array.from(
    new Set(listingsOrdenados.map((l) => l.seller_id))
  );

  const tiposPorSellerId = new Map<string, SellerType>();
  if (sellerIds.length > 0) {
    const { data: sellersPublicos } = await supabase
      .from("sellers_public_info")
      .select("id, seller_type")
      .in("id", sellerIds);

    for (const seller of sellersPublicos ?? []) {
      tiposPorSellerId.set(
        seller.id as string,
        seller.seller_type as SellerType
      );
    }
  }

  const grupos = agruparPorSimilitud(listingsOrdenados);

  // T-18 (REQ-09): prioridad también ENTRE grupos comparativos, además
  // de dentro de cada uno (ya resuelto arriba al agrupar
  // `listingsOrdenados`). Un grupo que contiene al menos un anuncio
  // destacado vigente debe aparecer antes que los grupos sin ninguno.
  // Se aplica un sort ESTABLE sobre el array ya ordenado por
  // `agruparPorSimilitud` (marca > modelo > año mínimo), que queda como
  // criterio secundario/de desempate entre grupos con el mismo estado de
  // "tiene destacado" (evita que el orden alfabético por marca/modelo se
  // pierda dentro de cada uno de los dos "bloques").
  grupos.sort((a, b) => {
    const aTieneDestacado = a.anuncios.some(esDestacadoVigente) ? 1 : 0;
    const bTieneDestacado = b.anuncios.some(esDestacadoVigente) ? 1 : 0;
    return bTieneDestacado - aTieneDestacado;
  });

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-2">
        <h1 className="text-2xl font-semibold">Buscar autos</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Filtra entre los anuncios publicados por marca, modelo, año y
          ubicación. Los resultados se agrupan automáticamente por marca,
          modelo y rango de año similar.
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

      {!listingsError && grupos.length > 0 && (
        <div className="flex w-full max-w-3xl flex-col gap-8">
          {grupos.map((grupo) => (
            <section
              key={grupo.clave}
              className="flex flex-col gap-3 rounded border border-black/[.15] p-4 dark:border-white/[.2]"
            >
              <h2 className="text-lg font-semibold">
                {grupo.brand} {grupo.model}{" "}
                <span className="font-normal text-zinc-600 dark:text-zinc-400">
                  (
                  {grupo.anioMin === grupo.anioMax
                    ? grupo.anioMin
                    : `${grupo.anioMin}-${grupo.anioMax}`}
                  )
                </span>
              </h2>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-black/[.15] text-left dark:border-white/[.2]">
                      <th className="py-2 pr-4">Destacado</th>
                      <th className="py-2 pr-4">Año</th>
                      <th className="py-2 pr-4">Precio</th>
                      <th className="py-2 pr-4">Kilometraje</th>
                      <th className="py-2 pr-4">Estado</th>
                      <th className="py-2 pr-4">Papeles al día</th>
                      <th className="py-2 pr-4">Vendedor</th>
                      <th className="py-2 pr-4">Ubicación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.anuncios.map((anuncio) => (
                      <tr
                        key={anuncio.id}
                        className="border-b border-black/[.08] last:border-none dark:border-white/[.1]"
                      >
                        <td className="py-2 pr-4">
                          {esDestacadoVigente(anuncio) && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/30 dark:text-amber-300">
                              ⭐ Destacado
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4">{anuncio.year}</td>
                        <td className="py-2 pr-4">
                          {formateadorPrecio.format(Number(anuncio.price))}
                        </td>
                        <td className="py-2 pr-4">
                          {anuncio.mileage.toLocaleString("es-CL")} km
                        </td>
                        <td className="py-2 pr-4">
                          {anuncio.vehicle_condition}
                        </td>
                        <td className="py-2 pr-4">
                          {anuncio.papers_up_to_date ? "Sí" : "No"}
                        </td>
                        <td className="py-2 pr-4">
                          {tiposPorSellerId.has(anuncio.seller_id)
                            ? ETIQUETA_TIPO_VENDEDOR[
                                tiposPorSellerId.get(
                                  anuncio.seller_id
                                ) as SellerType
                              ]
                            : "No disponible"}
                        </td>
                        <td className="py-2 pr-4">{anuncio.location}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
