import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { esDestacadoVigente } from "@/lib/listings";
import { AnuncioCard } from "./anuncio-card";

// T-21: vigencia corta de la URL firmada de la foto de portada, igual
// criterio que `app/vendedor/anuncios/[id]/fotos/page.tsx` y
// `app/moderador/vendedores/page.tsx`: solo se usa para pintar la
// miniatura en esta respuesta, no se persiste en ningún lado.
const VIGENCIA_URL_FIRMADA_SEGUNDOS = 60 * 5;

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

  // T-21: URL de la primera foto (por `position` ascendente) de cada
  // anuncio, para la columna "Foto" de la tabla comparativa.
  //
  // El bucket `listing-photos` es PRIVADO (`public = false`, ver
  // 0009_listing_photos_storage_and_minimum.sql), así que `getPublicUrl`
  // no sirve aquí: devolvería una URL que el navegador no puede leer.
  // Hace falta una URL firmada (`createSignedUrl(s)`), mismo mecanismo ya
  // usado en `app/vendedor/anuncios/[id]/fotos/page.tsx` y
  // `app/moderador/vendedores/page.tsx`. Se usa el cliente normal
  // (`supabase`, con la cookie de sesión si existe), NUNCA el cliente
  // admin/service role: firmar URLs de Storage con la service role desde
  // una ruta pública sin sesión ampliaría innecesariamente el radio de
  // acceso privilegiado, así que se prefiere respetar el mismo cliente
  // (y por lo tanto las mismas policies de RLS) que ya usa el resto de
  // esta página.
  //
  // NOTA para quien revise este cambio: las policies de
  // `storage.objects` para este bucket
  // (`listing_photos_storage_select`, 0009) solo aplican `to
  // authenticated`, no `to anon`. Un visitante SIN sesión en esta
  // página pública verá el placeholder "Sin foto" para todos los
  // anuncios (verificado contra la base real: Supabase responde "Either
  // the object does not exist or you do not have access to it" para un
  // `storage_path` de un anuncio publicado al pedir la URL firmada como
  // `anon`); un usuario CON sesión sí verá las fotos, porque para él la
  // condición `l.status = 'publicado'` de esa policy sí se cumple. Esto
  // cumple el criterio de aceptación (nunca rompe el layout ni muestra
  // un ícono roto, siempre cae al placeholder), pero para que también
  // se vean las fotos sin sesión hace falta una migración de RLS sobre
  // la base compartida (agregar `to anon` a esa policy, mismo criterio
  // que ya tiene `listing_photos_select` a nivel de tabla en
  // 0002_rls_policies.sql) que no se aplicó en este cambio por no tener
  // permiso para modificar la base de datos compartida/productiva.
  //
  // Una sola consulta a `listing_photos` con `.in("listing_id", ...)`
  // (en vez de una consulta por anuncio) trae las fotos de TODOS los
  // anuncios listados; nos quedamos en memoria con la de menor
  // `position` por anuncio (su "portada").
  const listingIds = listingsOrdenados.map((listing) => listing.id);

  const storagePathPortadaPorListingId = new Map<string, string>();
  if (listingIds.length > 0) {
    const { data: fotos } = await supabase
      .from("listing_photos")
      .select("listing_id, storage_path, position")
      .in("listing_id", listingIds)
      .order("position", { ascending: true });

    for (const foto of fotos ?? []) {
      const listingId = foto.listing_id as string;
      // Como la consulta viene ordenada por `position` ascendente, la
      // primera fila que se ve para cada `listing_id` es su portada;
      // las siguientes (posiciones mayores) se descartan.
      if (!storagePathPortadaPorListingId.has(listingId)) {
        storagePathPortadaPorListingId.set(
          listingId,
          foto.storage_path as string
        );
      }
    }
  }

  const fotoUrlPorListingId = new Map<string, string>();
  if (storagePathPortadaPorListingId.size > 0) {
    const storagePaths = Array.from(storagePathPortadaPorListingId.values());
    const { data: firmadas } = await supabase.storage
      .from("listing-photos")
      .createSignedUrls(storagePaths, VIGENCIA_URL_FIRMADA_SEGUNDOS);

    // `createSignedUrls` responde un array paralelo a `storagePaths`,
    // pero cada elemento trae su propio `path`/`error` en vez de
    // lanzar una excepción global: si el archivo referenciado en
    // `storage_path` ya no existe en el bucket, ese elemento viene con
    // `signedUrl: null` y `error` seteado, sin afectar al resto. Se
    // arma un mapa por `path` (no por índice) para no asumir que el
    // orden de la respuesta coincide 1:1 con `storagePaths`.
    const signedUrlPorStoragePath = new Map<string, string>();
    for (const item of firmadas ?? []) {
      if (item.path && item.signedUrl) {
        signedUrlPorStoragePath.set(item.path, item.signedUrl);
      }
    }

    for (const [listingId, storagePath] of storagePathPortadaPorListingId) {
      const signedUrl = signedUrlPorStoragePath.get(storagePath);
      if (signedUrl) {
        fotoUrlPorListingId.set(listingId, signedUrl);
      }
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
    <div className="flex flex-1 flex-col items-center gap-8 bg-background px-6 py-16">
      <div className="flex w-full max-w-5xl flex-col gap-2">
        <h1 className="font-display text-heading-1 text-foreground">
          Buscar autos
        </h1>
        <p className="text-body text-foreground-muted">
          Filtra entre los anuncios publicados por marca, modelo, año y
          ubicación. Los resultados se agrupan automáticamente por marca,
          modelo y rango de año similar.
        </p>
      </div>

      <form
        method="get"
        className="flex w-full max-w-5xl flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-card"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-body-sm text-foreground-muted">
            Marca
            <input
              type="text"
              name="brand"
              defaultValue={brand}
              placeholder="Ej: Toyota"
              className="rounded-control border border-border-strong bg-surface px-3 py-2 text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm text-foreground-muted">
            Modelo
            <input
              type="text"
              name="model"
              defaultValue={model}
              placeholder="Ej: Yaris"
              className="rounded-control border border-border-strong bg-surface px-3 py-2 text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm text-foreground-muted">
            Año
            <input
              type="number"
              name="year"
              defaultValue={year}
              placeholder="Ej: 2020"
              className="rounded-control border border-border-strong bg-surface px-3 py-2 text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-body-sm text-foreground-muted">
            Ubicación
            <input
              type="text"
              name="location"
              defaultValue={location}
              placeholder="Ej: Santiago"
              className="rounded-control border border-border-strong bg-surface px-3 py-2 text-foreground"
            />
          </label>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-control bg-primary px-5 py-2 text-body-sm font-medium text-primary-foreground transition duration-200 hover:bg-primary-hover"
          >
            Buscar
          </button>
          <Link
            href="/buscar"
            className="rounded-control border border-border-strong px-5 py-2 text-body-sm font-medium text-foreground transition duration-200 hover:border-primary"
          >
            Limpiar filtros
          </Link>
        </div>
      </form>

      {listingsError && (
        <p className="text-body-sm text-danger" role="alert">
          Ocurrió un error al buscar anuncios. Intenta nuevamente más
          tarde.
        </p>
      )}

      {!listingsError && listings.length === 0 && (
        <p className="text-body-sm text-foreground-muted">
          No se encontraron anuncios con esos filtros.
        </p>
      )}

      {!listingsError && grupos.length > 0 && (
        <div className="flex w-full max-w-5xl flex-col gap-10">
          {grupos.map((grupo) => (
            <section key={grupo.clave} className="flex flex-col gap-4">
              <h2 className="font-display text-heading-2 text-foreground">
                {grupo.brand} {grupo.model}{" "}
                <span className="font-sans text-body text-foreground-muted">
                  (
                  {grupo.anioMin === grupo.anioMax
                    ? grupo.anioMin
                    : `${grupo.anioMin}-${grupo.anioMax}`}
                  )
                </span>
              </h2>

              {/* T-25: grid de cards visuales en vez de tabla HTML. 1
               * columna en mobile, hasta 3 en desktop; preserva el orden
               * de `grupo.anuncios` (ya prioriza destacados vigentes,
               * T-18, y agrupa por similitud, T-14). */}
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {grupo.anuncios.map((anuncio) => (
                  // T-26: cada card enlaza al detalle completo del anuncio
                  // (`/anuncio/[id]`), que muestra la galería completa de
                  // fotos y todas sus specs — la card solo alcanza a mostrar
                  // un subconjunto. El `<Link>` envuelve la card completa
                  // (no solo el título) para maximizar el área clickeable;
                  // el foco visible (`focus-visible:ring-*`) cubre la
                  // navegación por teclado.
                  <Link
                    key={anuncio.id}
                    href={`/anuncio/${anuncio.id}`}
                    className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <AnuncioCard
                      anuncio={anuncio}
                      fotoUrl={fotoUrlPorListingId.get(anuncio.id) ?? null}
                      tipoVendedorLabel={
                        tiposPorSellerId.has(anuncio.seller_id)
                          ? ETIQUETA_TIPO_VENDEDOR[
                              tiposPorSellerId.get(
                                anuncio.seller_id
                              ) as SellerType
                            ]
                          : "Vendedor no disponible"
                      }
                    />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
