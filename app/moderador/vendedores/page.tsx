import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VendedorAcciones } from "./vendedor-acciones";

const ETIQUETAS_TIPO: Record<string, string> = {
  persona_natural: "Persona natural",
  concesionario: "Concesionario",
};

// Vigencia corta: la URL firmada solo se usa para abrir el documento
// desde el panel al momento de revisarlo, no se persiste en ningún lado.
const VIGENCIA_URL_FIRMADA_SEGUNDOS = 60 * 5;

type SellerPendiente = {
  id: string;
  seller_type: string;
  rut: string;
  verification_document_url: string | null;
  created_at: string;
};

/**
 * Panel de moderador (T-08): lista los vendedores en estado "pendiente"
 * con su documentación, y permite verificarlos o rechazarlos.
 *
 * Requiere sesión activa y `profiles.role === 'moderador'`; en caso
 * contrario redirige (a /login sin sesión, a / si no es moderador) en
 * vez de mostrar el panel.
 *
 * La lista de sellers y las URLs firmadas del documento se obtienen con
 * el cliente SSR normal (no el admin): las políticas
 * `sellers_select_moderator` y `seller_documents_select_moderator`
 * (0006_moderator_seller_review.sql) ya permiten este acceso a un
 * moderador.
 */
// T-28 (spike cacheComponents): lee sesión/datos al tope sin Suspense.
// Ver nota en app/cuenta/page.tsx.
export const instant = false;

export default async function ModeradorVendedoresPage() {
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

  const { data: sellers, error: sellersError } = await supabase
    .from("sellers")
    .select("id, seller_type, rut, verification_document_url, created_at")
    .eq("verification_status", "pendiente")
    .order("created_at", { ascending: true });

  const sellersPendientes = (sellers ?? []) as SellerPendiente[];

  const documentUrls = new Map<string, string>();
  for (const seller of sellersPendientes) {
    if (!seller.verification_document_url) continue;

    const { data: signed } = await supabase.storage
      .from("seller-documents")
      .createSignedUrl(
        seller.verification_document_url,
        VIGENCIA_URL_FIRMADA_SEGUNDOS
      );

    if (signed?.signedUrl) {
      documentUrls.set(seller.id, signed.signedUrl);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          Vendedores pendientes de revisión
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Revisa la documentación de cada vendedor y decide si queda
          verificado o rechazado. Un vendedor no verificado no puede
          publicar anuncios.
        </p>
      </div>

      {sellersError && (
        <p className="text-sm text-red-600" role="alert">
          No se pudo leer la lista de vendedores ({sellersError.message}).
          Verifica que la migración 0006_moderator_seller_review.sql esté
          aplicada en Supabase.
        </p>
      )}

      {!sellersError && sellersPendientes.length === 0 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay vendedores pendientes de revisión.
        </p>
      )}

      <ul className="flex w-full max-w-2xl flex-col gap-4">
        {sellersPendientes.map((seller) => (
          <li
            key={seller.id}
            className="flex flex-col gap-3 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]"
          >
            <div className="flex flex-col gap-1">
              <p>
                Tipo:{" "}
                <strong>
                  {ETIQUETAS_TIPO[seller.seller_type] ?? seller.seller_type}
                </strong>
              </p>
              <p>
                RUT: <strong>{seller.rut}</strong>
              </p>
              <p>
                Registrado el:{" "}
                <strong>
                  {new Date(seller.created_at).toLocaleString("es-CL")}
                </strong>
              </p>
              <p>
                Documento:{" "}
                {documentUrls.has(seller.id) ? (
                  <a
                    href={documentUrls.get(seller.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline"
                  >
                    Ver documento de respaldo
                  </a>
                ) : (
                  <span className="text-zinc-500">
                    No disponible (sin documento o no se pudo generar la
                    URL).
                  </span>
                )}
              </p>
            </div>

            <VendedorAcciones sellerId={seller.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
