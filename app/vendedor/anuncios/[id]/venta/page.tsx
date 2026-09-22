import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { obtenerAnuncioPropio } from "@/lib/listings";
import { VentaForm } from "./venta-form";

const ETIQUETAS_ESTADO: Record<string, string> = {
  borrador: "Borrador",
  publicado: "Publicado",
  pausado: "Pausado",
  vendido: "Vendido",
  rechazado: "Rechazado",
};

const ETIQUETAS_ESTADO_VENTA: Record<string, string> = {
  pendiente_aprobacion: "Pendiente de aprobación",
  aprobada: "Aprobada",
};

const formateadorPrecio = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

type AnuncioBasico = {
  id: string;
  brand: string;
  model: string;
  status: string;
};

type SolicitudVenta = {
  id: string;
  final_price: number;
  status: string;
  created_at: string;
};

/**
 * Página de solicitud de venta concretada de un anuncio propio (T-15,
 * REQ-08).
 *
 * Requiere sesión y verifica EXPLÍCITAMENTE, vía `obtenerAnuncioPropio`
 * (lib/listings.ts), que el listing pertenece a un seller del usuario
 * autenticado (`notFound()` en caso contrario): no basta con confiar en
 * que RLS filtró el listing, porque `listings_select_published`
 * (0002_rls_policies.sql) permite a cualquier usuario autenticado leer
 * anuncios publicados ajenos.
 *
 * Solo muestra el formulario si el anuncio está en estado 'publicado' y
 * no existe ya una solicitud `pendiente_aprobacion` para este listing (se
 * usa el cliente autenticado normal, sujeto a la política RLS
 * `sales_select_own`, para leerla). En cualquier otro caso muestra un
 * mensaje explicando la situación en vez del formulario, evitando
 * solicitudes duplicadas.
 */
// T-28 (spike cacheComponents): lee `params` y sesión al tope sin
// Suspense. Ver nota en app/cuenta/page.tsx.
export const instant = false;

export default async function SolicitarVentaPage({
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
      select: "id, brand, model, status",
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

  let solicitudPendiente: SolicitudVenta | null = null;
  let solicitudError: string | null = null;

  if (listing.status === "publicado") {
    const { data: solicitudData, error: ventaError } = await supabase
      .from("sales")
      .select("id, final_price, status, created_at")
      .eq("listing_id", id)
      .eq("status", "pendiente_aprobacion")
      .maybeSingle();

    if (ventaError) {
      solicitudError = ventaError.message;
    } else {
      solicitudPendiente = solicitudData as SolicitudVenta | null;
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">
          Solicitar venta de {listing.brand} {listing.model}
        </h1>

        <Link
          href={`/vendedor/anuncios/${id}`}
          className="text-sm font-medium underline"
        >
          Volver al resumen del anuncio
        </Link>

        {listing.status !== "publicado" && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Solo puedes solicitar una venta concretada sobre un anuncio en
            estado &quot;Publicado&quot;. El estado actual de este anuncio es{" "}
            <strong>
              {ETIQUETAS_ESTADO[listing.status] ?? listing.status}
            </strong>
            .
          </p>
        )}

        {listing.status === "publicado" && solicitudError && (
          <p className="text-sm text-red-600" role="alert">
            No se pudo verificar si ya existe una solicitud de venta (
            {solicitudError}).
          </p>
        )}

        {listing.status === "publicado" &&
          !solicitudError &&
          solicitudPendiente && (
            <div className="flex flex-col gap-2 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]">
              <p>
                Ya existe una solicitud de venta{" "}
                <strong>
                  {ETIQUETAS_ESTADO_VENTA[solicitudPendiente.status] ??
                    solicitudPendiente.status}
                </strong>{" "}
                para este anuncio, por el precio final de{" "}
                <strong>
                  {formateadorPrecio.format(
                    Number(solicitudPendiente.final_price)
                  )}
                </strong>
                .
              </p>
              <p className="text-zinc-600 dark:text-zinc-400">
                El anuncio permanece en estado &quot;Publicado&quot; mientras
                un moderador revisa la solicitud.
              </p>
            </div>
          )}

        {listing.status === "publicado" &&
          !solicitudError &&
          !solicitudPendiente && <VentaForm listingId={id} />}
      </div>
    </div>
  );
}
