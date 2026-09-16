"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DestacarFormState = {
  error: string | null;
};

export const initialDestacarFormState: DestacarFormState = {
  error: null,
};

/**
 * Server Action de activación del plan "Destacado" sobre un anuncio propio
 * (T-17, REQ-09). El plan dura 30 días desde la activación.
 *
 * 1. Exige sesión y vuelve a verificar EN SERVIDOR (no confía en la UI)
 *    que el listing pertenece a un seller del usuario autenticado: la
 *    política RLS `listings_select_published` (0002_rls_policies.sql)
 *    permite a cualquier usuario autenticado leer anuncios publicados
 *    ajenos, así que no basta con confiar en que la UI solo muestra el
 *    botón a quien corresponde.
 * 2. Vuelve a verificar que el seller es `seller_type = 'concesionario'` y
 *    que el listing está en estado `'publicado'`, dando un mensaje de
 *    error amigable ANTES de intentar el UPDATE. Esto es una
 *    pre-validación de UX: la garantía real e inevitable está en el
 *    trigger `prevent_unauthorized_featured_activation`
 *    (0015_featured_listings.sql), que rechaza el UPDATE aunque esta
 *    Server Action tenga un bug o se intente bypasear llamando
 *    directamente a la API REST de Supabase.
 * 3. Envía `featured_active: true` y, adicionalmente,
 *    `featured_expires_at` calculado aquí solo de forma informativa (para
 *    que, si se leyera el resultado del propio `update`, ya se vea un
 *    valor razonable) — el trigger de BD SIEMPRE sobreescribe esta columna
 *    a `now() + 30 días` en el momento exacto del UPDATE, sin importar el
 *    valor enviado desde el cliente: la fuente de verdad real es el
 *    trigger, no este valor.
 * 4. `revalidatePath` sobre el resumen del anuncio (no existe una página
 *    propia en `/vendedor/anuncios/[id]/destacar`: el formulario se
 *    renderiza embebido dentro de `app/vendedor/anuncios/[id]/page.tsx`,
 *    así que no hay una ruta separada que revalidar).
 */
export async function activarDestacado(
  listingId: string,
  // Requeridos por la firma de acción de useActionState (prevState,
  // formData), pero no se usan: no hay estado previo relevante ni datos
  // de formulario, el botón "Activar plan Destacado" no envía ningún
  // input (DestacarForm).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: DestacarFormState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<DestacarFormState> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Debes iniciar sesión para activar el plan destacado." };
  }

  const { data: seller, error: sellerError } = await supabase
    .from("sellers")
    .select("id, seller_type")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sellerError) {
    return {
      error: `No se pudo verificar tu cuenta de vendedor: ${sellerError.message}`,
    };
  }

  if (!seller) {
    return {
      error: "No tienes permisos para activar el plan destacado en este anuncio.",
    };
  }

  if (seller.seller_type !== "concesionario") {
    return {
      error: "Solo un vendedor concesionario puede activar el plan destacado.",
    };
  }

  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("id, status")
    .eq("id", listingId)
    .eq("seller_id", seller.id)
    .maybeSingle();

  if (listingError) {
    return {
      error: `No se pudo leer el anuncio: ${listingError.message}`,
    };
  }

  if (!listing) {
    return {
      error: "No tienes permisos para activar el plan destacado en este anuncio.",
    };
  }

  if (listing.status !== "publicado") {
    return {
      error:
        "El plan destacado solo puede activarse sobre un anuncio en estado 'Publicado'.",
    };
  }

  const expiraEn = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { error: updateError } = await supabase
    .from("listings")
    .update({
      featured_active: true,
      featured_expires_at: expiraEn,
    })
    .eq("id", listingId);

  if (updateError) {
    return {
      error: `No se pudo activar el plan destacado: ${updateError.message}`,
    };
  }

  revalidatePath(`/vendedor/anuncios/${listingId}`);

  return { error: null };
}
