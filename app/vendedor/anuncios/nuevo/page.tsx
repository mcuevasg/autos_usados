import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AnuncioForm } from "./anuncio-form";

/**
 * Página de creación de anuncio (T-09).
 *
 * Criterio de aceptación (REQ-03): solo un vendedor en estado
 * "Verificado" puede crear un anuncio. Esta página:
 *  - Requiere sesión (redirige a /login si no hay usuario).
 *  - Busca la fila `sellers` del usuario. Si no existe, muestra un
 *    mensaje invitando a registrarse como vendedor (T-07). Si existe
 *    pero no está 'verificado' (pendiente o rechazado), muestra un
 *    mensaje explicando el estado en vez del formulario.
 *  - Solo si `verification_status === 'verificado'` renderiza el
 *    formulario (`AnuncioForm`).
 *
 * Esta comprobación es solo de UX: la fuente de verdad es la Server
 * Action (`actions.ts`), que vuelve a verificar en servidor, y además la
 * política RLS `listings_insert_own` (0006_moderator_seller_review.sql)
 * impide el insert a nivel de base de datos si el seller no está
 * verificado.
 */
// T-28 (spike cacheComponents): lee sesión/datos al tope sin Suspense.
// Ver nota en app/cuenta/page.tsx.
export const instant = false;

export default async function NuevoAnuncioPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: seller, error: sellerError } = await supabase
    .from("sellers")
    .select("verification_status")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="flex flex-1 flex-col items-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-semibold">Publicar un anuncio</h1>
      </div>

      {sellerError && (
        <p className="text-sm text-red-600" role="alert">
          No se pudo leer el estado de vendedor ({sellerError.message}).
        </p>
      )}

      {!sellerError && !seller && (
        <div className="flex w-full max-w-sm flex-col gap-3 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]">
          <p className="text-zinc-600 dark:text-zinc-400">
            Para publicar un anuncio primero debes registrarte como
            vendedor y quedar verificado por un moderador.
          </p>
          <Link
            href="/vendedor/registro"
            className="font-medium underline"
          >
            Registrarme como vendedor
          </Link>
        </div>
      )}

      {!sellerError &&
        seller &&
        seller.verification_status !== "verificado" && (
          <div className="flex w-full max-w-sm flex-col gap-2 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]">
            {seller.verification_status === "pendiente" ? (
              <p>
                Tu cuenta de vendedor está{" "}
                <strong>pendiente de revisión</strong>. Podrás publicar
                anuncios en cuanto un moderador la verifique.
              </p>
            ) : (
              <p>
                Tu cuenta de vendedor fue{" "}
                <strong>rechazada</strong>. Contacta a soporte si crees que
                se trata de un error.
              </p>
            )}
          </div>
        )}

      {!sellerError && seller?.verification_status === "verificado" && (
        <AnuncioForm />
      )}
    </div>
  );
}
