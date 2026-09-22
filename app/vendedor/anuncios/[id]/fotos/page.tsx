import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { obtenerAnuncioPropio } from "@/lib/listings";
import { FotosForm } from "./fotos-form";
import { FotoItem } from "./foto-item";

const MINIMO_FOTOS = 3;
// Vigencia corta: la URL firmada solo se usa para el preview en esta
// página, no se persiste en ningún lado (mismo criterio que
// app/moderador/vendedores/page.tsx).
const VIGENCIA_URL_FIRMADA_SEGUNDOS = 60 * 5;

type ListingPhoto = {
  id: string;
  storage_path: string;
  position: number;
};

type AnuncioBasico = {
  id: string;
  brand: string;
  model: string;
};

/**
 * Página de carga de fotos de un anuncio propio (T-10).
 *
 * Requiere sesión y que el listing pertenezca a un seller del usuario
 * autenticado (`notFound()` en caso contrario). La verificación de
 * pertenencia se hace explícitamente vía `obtenerAnuncioPropio`
 * (lib/listings.ts): no basta con confiar en que RLS filtró el listing,
 * porque `listings_select_published` (0002_rls_policies.sql) permite a
 * cualquier usuario autenticado leer anuncios publicados ajenos. Lista
 * las fotos ya subidas con su preview vía URL firmada, muestra cuántas
 * fotos lleva respecto del mínimo exigido para publicar (T-12), y el
 * formulario para subir más.
 *
 * El mínimo de 3 fotos para poder publicar el anuncio NO se aplica aquí
 * en la UI: queda garantizado a nivel de base de datos por el trigger
 * `listings_require_min_photos_to_publish`
 * (0009_listing_photos_storage_and_minimum.sql), que se disparará cuando
 * exista una acción real de "publicar" (T-12, todavía no implementada).
 */
// T-28 (spike cacheComponents): lee `params` y sesión al tope sin
// Suspense. Ver nota en app/cuenta/page.tsx.
export const instant = false;

export default async function FotosAnuncioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: listingData, error: listingError } =
    await obtenerAnuncioPropio(supabase, {
      listingId: id,
      userId: user.id,
      select: "id, brand, model",
    });

  const listing = listingData as AnuncioBasico | null;

  if (listingError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 px-6 py-16 dark:bg-black">
        <p className="text-sm text-red-600" role="alert">
          No se pudo leer el anuncio ({listingError.message}).
        </p>
      </div>
    );
  }

  if (!listing) {
    notFound();
  }

  const { data: fotos, error: fotosError } = await supabase
    .from("listing_photos")
    .select("id, storage_path, position")
    .eq("listing_id", id)
    .order("position", { ascending: true });

  const listaFotos = (fotos ?? []) as ListingPhoto[];

  const signedUrls = new Map<string, string>();
  for (const foto of listaFotos) {
    const { data: signed } = await supabase.storage
      .from("listing-photos")
      .createSignedUrl(foto.storage_path, VIGENCIA_URL_FIRMADA_SEGUNDOS);

    if (signed?.signedUrl) {
      signedUrls.set(foto.id, signed.signedUrl);
    }
  }

  const cantidadFotos = listaFotos.length;
  const faltan = Math.max(0, MINIMO_FOTOS - cantidadFotos);

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          Fotos de {listing.brand} {listing.model}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {cantidadFotos} de {MINIMO_FOTOS} fotos mínimas para poder
          publicarse.
          {faltan > 0 &&
            ` Faltan al menos ${faltan} foto${faltan === 1 ? "" : "s"}.`}
        </p>
        <Link
          href={`/vendedor/anuncios/${id}`}
          className="text-sm font-medium underline"
        >
          Volver al resumen del anuncio
        </Link>
      </div>

      {fotosError && (
        <p className="text-sm text-red-600" role="alert">
          No se pudieron leer las fotos ({fotosError.message}).
        </p>
      )}

      {!fotosError && listaFotos.length > 0 && (
        <ul className="grid w-full max-w-sm grid-cols-2 gap-3 sm:grid-cols-3">
          {listaFotos.map((foto) => (
            <FotoItem
              key={foto.id}
              listingId={id}
              photoId={foto.id}
              signedUrl={signedUrls.get(foto.id) ?? null}
            />
          ))}
        </ul>
      )}

      <FotosForm listingId={id} />
    </div>
  );
}
