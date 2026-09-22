import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { esDestacadoVigente } from "@/lib/listings";
import { GaleriaFotos } from "./galeria-fotos";

// T-21/T-25: vigencia corta de las URLs firmadas de las fotos, igual
// criterio que `app/buscar/page.tsx` y
// `app/vendedor/anuncios/[id]/fotos/page.tsx`: solo se usan para pintar
// esta respuesta, no se persisten en ningún lado.
const VIGENCIA_URL_FIRMADA_SEGUNDOS = 60 * 5;

type SellerType = "persona_natural" | "concesionario";

const ETIQUETA_TIPO_VENDEDOR: Record<SellerType, string> = {
  persona_natural: "Persona natural",
  concesionario: "Concesionario",
};

const ETIQUETA_USO: Record<string, string> = {
  familiar: "Familiar",
  trabajo: "Trabajo",
  carga: "Carga",
  todo_terreno: "Todo terreno",
};

const formateadorPrecio = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

type AnuncioDetalle = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number;
  price: number;
  location: string;
  vehicle_condition: string;
  usage_type: string;
  papers_up_to_date: boolean;
  seller_id: string;
  featured_active: boolean;
  featured_expires_at: string | null;
};

/**
 * Página pública de detalle de un anuncio individual (T-26).
 *
 * Seguridad/visibilidad: mismo criterio que `/buscar` (T-13) — se filtra
 * EXPLÍCITAMENTE `status = 'publicado'` en la propia query, sin confiar
 * únicamente en que la policy `listings_select_published`
 * (0002_rls_policies.sql) ya lo garantiza. Esto es intencional incluso
 * siendo redundante con RLS: si algún día la policy cambia o se relaja,
 * esta ruta no debe empezar a filtrar anuncios en borrador/pausado/
 * vendido/rechazado solo porque alguien adivinó el UUID en la URL. Si el
 * anuncio no existe o no está publicado, `notFound()` responde un 404 real
 * (no una página vacía ni datos parciales) sin distinguir el motivo real
 * (no existe vs. existe pero no publicado) para no filtrar esa
 * información tampoco.
 *
 * No requiere sesión: usa el cliente Supabase normal (SSR), igual que
 * `/buscar`.
 */
// T-28 (spike cacheComponents): lee `params` al tope sin Suspense.
// Ver nota en app/cuenta/page.tsx.
export const instant = false;

export default async function AnuncioDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: listingData, error: listingError } = await supabase
    .from("listings")
    .select(
      "id, brand, model, year, mileage, price, location, vehicle_condition, usage_type, papers_up_to_date, seller_id, featured_active, featured_expires_at"
    )
    .eq("id", id)
    .eq("status", "publicado")
    .maybeSingle();

  if (listingError || !listingData) {
    notFound();
  }

  const anuncio = listingData as AnuncioDetalle;

  // Tipo de vendedor vía la vista pública `sellers_public_info` (T-14,
  // 0012_sellers_public_view.sql): solo expone `id` + `seller_type`, nunca
  // el `rut` (PII) de `sellers`. Mismo patrón que `/buscar`.
  const { data: sellerPublico } = await supabase
    .from("sellers_public_info")
    .select("seller_type")
    .eq("id", anuncio.seller_id)
    .maybeSingle();

  const tipoVendedorLabel = sellerPublico
    ? ETIQUETA_TIPO_VENDEDOR[sellerPublico.seller_type as SellerType]
    : "Vendedor no disponible";

  // Todas las fotos del anuncio (no solo la portada, a diferencia de
  // `/buscar`), ordenadas por `position` ascendente para que la galería
  // respete el orden elegido por el vendedor al subirlas (T-10).
  const { data: fotos } = await supabase
    .from("listing_photos")
    .select("storage_path, position")
    .eq("listing_id", id)
    .order("position", { ascending: true });

  const storagePaths = (fotos ?? []).map(
    (foto) => foto.storage_path as string
  );

  let fotosUrls: string[] = [];
  if (storagePaths.length > 0) {
    const { data: firmadas } = await supabase.storage
      .from("listing-photos")
      .createSignedUrls(storagePaths, VIGENCIA_URL_FIRMADA_SEGUNDOS);

    // Igual que en `/buscar`: si el archivo referenciado en `storage_path`
    // ya no existe en el bucket, ese elemento viene con `signedUrl: null`
    // sin afectar al resto; se descarta en vez de romper la galería.
    fotosUrls = (firmadas ?? [])
      .filter((item) => item.signedUrl !== null)
      .map((item) => item.signedUrl as string);
  }

  // T-18 (REQ-09): nunca se usa `featured_active` crudo, ver
  // `esDestacadoVigente` (lib/listings.ts).
  const destacado = esDestacadoVigente(anuncio);

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-6 py-16">
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <Link
          href="/buscar"
          className="w-fit text-body-sm font-medium text-foreground-muted transition duration-200 hover:text-primary"
        >
          ← Volver a la búsqueda
        </Link>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <GaleriaFotos fotosUrls={fotosUrls} />

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              {destacado && (
                <span className="inline-flex w-fit items-center gap-1 rounded-pill bg-accent-soft px-2.5 py-1 text-caption font-semibold text-foreground">
                  ⭐ Destacado
                </span>
              )}
              <h1 className="font-display text-heading-1 text-foreground">
                {anuncio.brand} {anuncio.model}
              </h1>
              <p className="text-body text-foreground-muted">
                {anuncio.year} · {anuncio.location}
              </p>
              <p className="font-display text-display text-foreground">
                {formateadorPrecio.format(Number(anuncio.price))}
              </p>
            </div>

            {/* Specs completas del anuncio (criterio de aceptación T-26):
             * marca, modelo, año, kilometraje, precio (ya destacado arriba),
             * estado del vehículo, papeles al día, tipo de uso y ubicación. */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-card border border-border bg-surface p-4 shadow-card text-body-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption uppercase text-foreground-subtle">
                  Marca
                </dt>
                <dd className="font-medium text-foreground">
                  {anuncio.brand}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption uppercase text-foreground-subtle">
                  Modelo
                </dt>
                <dd className="font-medium text-foreground">
                  {anuncio.model}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption uppercase text-foreground-subtle">
                  Año
                </dt>
                <dd className="font-medium text-foreground">
                  {anuncio.year}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption uppercase text-foreground-subtle">
                  Kilometraje
                </dt>
                <dd className="font-medium text-foreground">
                  {anuncio.mileage.toLocaleString("es-CL")} km
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption uppercase text-foreground-subtle">
                  Estado del vehículo
                </dt>
                <dd className="font-medium text-foreground">
                  {anuncio.vehicle_condition}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption uppercase text-foreground-subtle">
                  Papeles al día
                </dt>
                <dd className="font-medium text-foreground">
                  {anuncio.papers_up_to_date ? "✅ Sí" : "⚠️ No"}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption uppercase text-foreground-subtle">
                  Tipo de uso
                </dt>
                <dd className="font-medium text-foreground">
                  {ETIQUETA_USO[anuncio.usage_type] ?? anuncio.usage_type}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption uppercase text-foreground-subtle">
                  Ubicación
                </dt>
                <dd className="font-medium text-foreground">
                  {anuncio.location}
                </dd>
              </div>
            </dl>

            <div className="flex items-center gap-1.5 border-t border-border pt-4 text-body-sm text-foreground-subtle">
              <span aria-hidden="true">👤</span>
              Publicado por: {tipoVendedorLabel}
            </div>

            {/* CTA de contacto (T-26): el proyecto todavía no tiene un
             * sistema de mensajería comprador/vendedor (no existe tabla ni
             * ruta para eso en el repo). Este botón es un PLACEHOLDER
             * intencional que comunica la intención ("contactar al
             * vendedor") sin funcionalidad real detrás; cuando exista
             * mensajería/contacto real, reemplazar por esa acción. */}
            <button
              type="button"
              className="w-full rounded-control bg-primary px-5 py-3 text-body font-semibold text-primary-foreground transition duration-200 hover:bg-primary-hover sm:w-fit"
            >
              Contactar vendedor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
