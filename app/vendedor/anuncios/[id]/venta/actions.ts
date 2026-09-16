"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type VentaFormState = {
  error: string | null;
};

export const initialVentaFormState: VentaFormState = {
  error: null,
};

/**
 * Server Action de solicitud de venta concretada (T-15, REQ-08).
 *
 * 1. Exige sesión y vuelve a verificar EN SERVIDOR (no confía en la UI)
 *    que el listing pertenece a un seller del usuario autenticado y que
 *    su `status` es `'publicado'`: la política RLS `listings_select_*`
 *    (0002_rls_policies.sql) permite a cualquier usuario autenticado leer
 *    anuncios publicados ajenos, así que no basta con confiar en que la
 *    UI solo muestra el formulario a quien corresponde.
 * 2. Valida `final_price`: requerido, numérico, >= 0, coherente con el
 *    check `sales.final_price >= 0` (0001_initial_schema.sql).
 * 3. Revisa, con el cliente autenticado normal (sujeto a RLS vía
 *    `sales_select_own`, 0002_rls_policies.sql), que no exista ya una
 *    solicitud `pendiente_aprobacion` para este listing, para evitar
 *    solicitudes duplicadas. Este `select` previo no es atómico frente a
 *    solicitudes concurrentes; la garantía real a nivel de base de datos
 *    es el índice único parcial `sales_one_pending_per_listing`
 *    (0013_sales_insert_requires_published.sql), ver el manejo del error
 *    de constraint en el paso 4.
 * 4. Inserta en `sales` solo `listing_id` y `final_price`: NO se envían
 *    `status` ni `commission` explícitos, se dejan los defaults de la
 *    tabla ('pendiente_aprobacion' y null respectivamente), que son
 *    exactamente los valores que exige el `with check` de la política
 *    `sales_insert_own` (0003_fix_sales_insert_policy.sql,
 *    0013_sales_insert_requires_published.sql). El insert usa el cliente
 *    autenticado normal: no se necesita service_role. Si el `insert`
 *    viola el índice único `sales_one_pending_per_listing` (0013) —caso
 *    de dos solicitudes concurrentes que pasaron ambas el `select` del
 *    paso 3 antes de que cualquiera insertara— Postgres devuelve el
 *    código de error `23505` (unique_violation), que se traduce al mismo
 *    mensaje amigable que el caso detectado por el `select` previo.
 * 5. NO se toca `listings.status` en ningún momento: el anuncio debe
 *    permanecer "Publicado" mientras la solicitud está pendiente de
 *    aprobación (criterio de aceptación de T-15). El cambio a "Vendido"
 *    y el cálculo de comisión al aprobar la solicitud es T-16, todavía no
 *    implementada.
 */
export async function solicitarVenta(
  listingId: string,
  _prevState: VentaFormState,
  formData: FormData
): Promise<VentaFormState> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Debes iniciar sesión para solicitar una venta." };
  }

  const { data: seller, error: sellerError } = await supabase
    .from("sellers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sellerError) {
    return {
      error: `No se pudo verificar tu cuenta de vendedor: ${sellerError.message}`,
    };
  }

  if (!seller) {
    return {
      error: "No tienes permisos para solicitar una venta en este anuncio.",
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
      error: "No tienes permisos para solicitar una venta en este anuncio.",
    };
  }

  if (listing.status !== "publicado") {
    return {
      error:
        "Solo puedes solicitar una venta concretada sobre un anuncio en estado 'Publicado'.",
    };
  }

  const finalPriceRaw = String(formData.get("final_price") ?? "").trim();
  const finalPrice = Number(finalPriceRaw);

  if (!finalPriceRaw || !Number.isFinite(finalPrice) || finalPrice < 0) {
    return { error: "Ingresa un precio final válido (0 o más)." };
  }

  const { data: solicitudExistente, error: solicitudExistenteError } =
    await supabase
      .from("sales")
      .select("id")
      .eq("listing_id", listingId)
      .eq("status", "pendiente_aprobacion")
      .maybeSingle();

  if (solicitudExistenteError) {
    return {
      error: `No se pudo verificar si ya existe una solicitud: ${solicitudExistenteError.message}`,
    };
  }

  if (solicitudExistente) {
    return {
      error:
        "Ya existe una solicitud de venta pendiente de aprobación para este anuncio.",
    };
  }

  const { error: insertError } = await supabase.from("sales").insert({
    listing_id: listingId,
    final_price: finalPrice,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        error:
          "Ya existe una solicitud de venta pendiente de aprobación para este anuncio.",
      };
    }

    return {
      error: `No se pudo enviar la solicitud de venta: ${insertError.message}`,
    };
  }

  revalidatePath(`/vendedor/anuncios/${listingId}/venta`);
  revalidatePath(`/vendedor/anuncios/${listingId}`);

  return { error: null };
}
