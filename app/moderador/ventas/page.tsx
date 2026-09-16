import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VentaAcciones } from "./venta-acciones";

const formateadorPrecio = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

type Venta = {
  id: string;
  listing_id: string;
  final_price: number;
  status: string;
  created_at: string;
};

type AnuncioBasico = {
  id: string;
  brand: string;
  model: string;
  year: number;
  price: number;
};

/**
 * Panel de moderador de ventas (T-16, REQ-08): lista las solicitudes de
 * venta pendientes de aprobación (`sales.status = 'pendiente_aprobacion'`),
 * con los datos del anuncio asociado, y permite aprobarlas.
 *
 * Requiere sesión activa y `profiles.role === 'moderador'`, mismo patrón
 * que `app/moderador/anuncios/page.tsx` (T-12) y
 * `app/moderador/vendedores/page.tsx` (T-08); en caso contrario redirige.
 * La lista se obtiene con el cliente SSR normal (no el admin): la
 * política `sales_select_moderator` (0014_sales_approval.sql) ya permite
 * este acceso a un moderador (ve TODAS las solicitudes, no solo las de un
 * vendedor).
 *
 * Al aprobar (`VentaAcciones` -> Server Action `aprobarVenta`,
 * `app/moderador/ventas/actions.ts`), la comisión (5% de `final_price`)
 * se calcula en servidor y el anuncio pasa a 'vendido'; esta página no
 * hace ningún cálculo, solo muestra los datos.
 */
export default async function ModeradorVentasPage() {
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

  const { data: salesData, error: salesError } = await supabase
    .from("sales")
    .select("id, listing_id, final_price, status, created_at")
    .eq("status", "pendiente_aprobacion")
    .order("created_at", { ascending: true });

  const ventas = (salesData ?? []) as Venta[];

  const listingIds = Array.from(new Set(ventas.map((v) => v.listing_id)));
  const listingsById = new Map<string, AnuncioBasico>();

  if (listingIds.length > 0) {
    const { data: listingsData } = await supabase
      .from("listings")
      .select("id, brand, model, year, price")
      .in("id", listingIds);

    for (const listing of (listingsData ?? []) as AnuncioBasico[]) {
      listingsById.set(listing.id, listing);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-3xl flex-col gap-2">
        <h1 className="text-2xl font-semibold">Ventas pendientes</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Solicitudes de venta concretada esperando aprobación. Al aprobar
          una venta, el anuncio pasa a estado &quot;Vendido&quot; y se
          calcula automáticamente la comisión (5% del precio final).
        </p>
      </div>

      {salesError && (
        <p className="text-sm text-red-600" role="alert">
          No se pudo leer la lista de ventas pendientes ({salesError.message}
          ). Verifica que la migración 0014_sales_approval.sql esté
          aplicada en Supabase.
        </p>
      )}

      {!salesError && ventas.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay solicitudes de venta pendientes de aprobación.
        </p>
      )}

      <ul className="flex w-full max-w-3xl flex-col gap-4">
        {ventas.map((venta) => {
          const listing = listingsById.get(venta.listing_id);

          return (
            <li
              key={venta.id}
              className="flex flex-col gap-3 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]"
            >
              <div className="flex flex-col gap-1">
                <p>
                  <strong>
                    {listing
                      ? `${listing.brand} ${listing.model} (${listing.year})`
                      : "Anuncio no encontrado"}
                  </strong>
                </p>
                {listing && (
                  <p>
                    Precio publicado:{" "}
                    <strong>
                      {formateadorPrecio.format(Number(listing.price))}
                    </strong>
                  </p>
                )}
                <p>
                  Precio final solicitado:{" "}
                  <strong>
                    {formateadorPrecio.format(Number(venta.final_price))}
                  </strong>
                </p>
                <p>
                  Solicitada el:{" "}
                  <strong>
                    {new Date(venta.created_at).toLocaleString("es-CL")}
                  </strong>
                </p>
              </div>

              <VentaAcciones saleId={venta.id} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
