import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AnuncioAcciones } from "./anuncio-acciones";

const ETIQUETAS_ESTADO: Record<string, string> = {
  borrador: "Borrador",
  publicado: "Publicado",
  pausado: "Pausado",
  vendido: "Vendido",
  rechazado: "Rechazado",
};

const ETIQUETAS_TIPO: Record<string, string> = {
  persona_natural: "Persona natural",
  concesionario: "Concesionario",
};

// Orden de despliegue: los "borrador" (esperando primera revisión) van
// primero, luego el resto del ciclo de vida.
const ORDEN_ESTADO = [
  "borrador",
  "publicado",
  "pausado",
  "vendido",
  "rechazado",
];

const formateadorPrecio = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

type Anuncio = {
  id: string;
  seller_id: string;
  brand: string;
  model: string;
  year: number;
  price: number;
  status: string;
  created_at: string;
};

type SellerBasico = {
  id: string;
  seller_type: string;
  rut: string;
};

/**
 * Panel de moderador de anuncios (T-12): lista TODOS los anuncios,
 * cualquiera sea su estado o vendedor, y permite cambiar su estado entre
 * los 5 valores del ciclo de vida (borrador, publicado, pausado, vendido,
 * rechazado).
 *
 * Requiere sesión activa y `profiles.role === 'moderador'`, mismo patrón
 * que `app/moderador/vendedores/page.tsx` (T-08); en caso contrario
 * redirige. La lista se obtiene con el cliente SSR normal (no el admin):
 * la política `listings_select_moderator`
 * (0010_listing_status_lifecycle.sql) ya permite este acceso a un
 * moderador.
 *
 * El cambio de estado real está protegido a nivel de base de datos por
 * el trigger `listings_protect_status_update` (misma migración): incluso
 * si esta página tuviera un error, ningún vendedor podría cambiar el
 * estado de su propio anuncio saltándose a un moderador.
 */
export default async function ModeradorAnunciosPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "moderador") {
    redirect("/");
  }

  const { data: listingsData, error: listingsError } = await supabase
    .from("listings")
    .select("id, seller_id, brand, model, year, price, status, created_at")
    .order("created_at", { ascending: true });

  const listings = (listingsData ?? []) as Anuncio[];

  const sellerIds = Array.from(new Set(listings.map((l) => l.seller_id)));
  const sellersById = new Map<string, SellerBasico>();

  if (sellerIds.length > 0) {
    const { data: sellersData } = await supabase
      .from("sellers")
      .select("id, seller_type, rut")
      .in("id", sellerIds);

    for (const seller of (sellersData ?? []) as SellerBasico[]) {
      sellersById.set(seller.id, seller);
    }
  }

  const listingIds = listings.map((l) => l.id);
  const photoCountByListing = new Map<string, number>();

  if (listingIds.length > 0) {
    const { data: photosData } = await supabase
      .from("listing_photos")
      .select("listing_id")
      .in("listing_id", listingIds);

    for (const photo of (photosData ?? []) as { listing_id: string }[]) {
      photoCountByListing.set(
        photo.listing_id,
        (photoCountByListing.get(photo.listing_id) ?? 0) + 1
      );
    }
  }

  const listingsOrdenados = [...listings].sort((a, b) => {
    const ordenA = ORDEN_ESTADO.indexOf(a.status);
    const ordenB = ORDEN_ESTADO.indexOf(b.status);
    if (ordenA !== ordenB) return ordenA - ordenB;
    return (
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  });

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-2">
        <h1 className="text-2xl font-semibold">Anuncios</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Gestiona el ciclo de vida de todos los anuncios. Solo un
          moderador puede cambiar su estado entre Borrador, Publicado,
          Pausado, Vendido y Rechazado. Solo los anuncios &quot;Publicado&quot;
          aparecen en búsquedas públicas.
        </p>
      </div>

      {listingsError && (
        <p className="text-sm text-red-600" role="alert">
          No se pudo leer la lista de anuncios ({listingsError.message}).
          Verifica que la migración
          0010_listing_status_lifecycle.sql esté aplicada en Supabase.
        </p>
      )}

      {!listingsError && listingsOrdenados.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay anuncios creados todavía.
        </p>
      )}

      <ul className="flex w-full max-w-3xl flex-col gap-4">
        {listingsOrdenados.map((listing) => {
          const seller = sellersById.get(listing.seller_id);
          const cantidadFotos = photoCountByListing.get(listing.id) ?? 0;

          return (
            <li
              key={listing.id}
              className="flex flex-col gap-3 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]"
            >
              <div className="flex flex-col gap-1">
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
                  Vendedor:{" "}
                  <strong>
                    {seller
                      ? `${ETIQUETAS_TIPO[seller.seller_type] ?? seller.seller_type} · ${seller.rut}`
                      : "Desconocido"}
                  </strong>
                </p>
                <p>
                  Estado actual:{" "}
                  <strong>
                    {ETIQUETAS_ESTADO[listing.status] ?? listing.status}
                  </strong>
                </p>
                <p>
                  Fotos: <strong>{cantidadFotos}</strong>
                </p>
                <p>
                  Creado el:{" "}
                  <strong>
                    {new Date(listing.created_at).toLocaleString("es-CL")}
                  </strong>
                </p>
              </div>

              <AnuncioAcciones
                listingId={listing.id}
                estadoActual={listing.status}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
