import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { obtenerAnuncioPropio } from "@/lib/listings";

const ETIQUETAS_ESTADO: Record<string, string> = {
  borrador: "Borrador",
  publicado: "Publicado",
  pausado: "Pausado",
  vendido: "Vendido",
  rechazado: "Rechazado",
};

const ETIQUETAS_USO: Record<string, string> = {
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

const MINIMO_FOTOS = 3;

type AnuncioResumen = {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileage: number;
  price: number;
  vehicle_condition: string;
  usage_type: string;
  location: string;
  status: string;
  created_at: string;
};

/**
 * Página de confirmación del anuncio recién creado (T-09).
 *
 * No es la página de detalle público del anuncio (eso corresponde a
 * tareas posteriores de búsqueda/listado, T-13/T-14): aquí solo se
 * muestra un resumen de lo que se guardó. Usa `obtenerAnuncioPropio`
 * (lib/listings.ts) para verificar EXPLÍCITAMENTE que el listing
 * pertenece a un seller del usuario autenticado: no basta con confiar en
 * RLS, porque `listings_select_published` (0002_rls_policies.sql) permite
 * a cualquier usuario autenticado leer anuncios publicados ajenos.
 */
export default async function AnuncioCreadoPage({
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
      select:
        "id, brand, model, year, mileage, price, vehicle_condition, usage_type, location, status, created_at",
    });

  const listing = listingData as AnuncioResumen | null;

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

  const { count: cantidadFotos, error: fotosError } = await supabase
    .from("listing_photos")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", id);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">Anuncio creado</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tu anuncio quedó guardado en estado{" "}
          <strong>{ETIQUETAS_ESTADO[listing.status] ?? listing.status}</strong>
          . Un moderador revisará su publicación (T-12).
        </p>

        <dl className="flex flex-col gap-2 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Marca</dt>
            <dd className="font-medium">{listing.brand}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Modelo</dt>
            <dd className="font-medium">{listing.model}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Año</dt>
            <dd className="font-medium">{listing.year}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Kilometraje</dt>
            <dd className="font-medium">
              {listing.mileage.toLocaleString("es-CL")} km
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Precio</dt>
            <dd className="font-medium">
              {formateadorPrecio.format(Number(listing.price))}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Estado</dt>
            <dd className="font-medium">{listing.vehicle_condition}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Tipo de uso</dt>
            <dd className="font-medium">
              {ETIQUETAS_USO[listing.usage_type] ?? listing.usage_type}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Ubicación</dt>
            <dd className="font-medium">{listing.location}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]">
          {fotosError ? (
            <p className="text-red-600" role="alert">
              No se pudo leer la cantidad de fotos ({fotosError.message}).
            </p>
          ) : (
            <p>
              <strong>{cantidadFotos ?? 0}</strong> de{" "}
              <strong>{MINIMO_FOTOS}</strong> fotos mínimas cargadas.
            </p>
          )}
          <Link
            href={`/vendedor/anuncios/${listing.id}/fotos`}
            className="font-medium underline"
          >
            Subir/gestionar fotos
          </Link>
        </div>

        <Link
          href="/vendedor/anuncios/nuevo"
          className="text-sm font-medium underline"
        >
          Crear otro anuncio
        </Link>
      </div>
    </div>
  );
}
