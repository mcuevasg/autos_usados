import type { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Obtiene un listing verificando EXPLÍCITAMENTE, en el servidor, que
 * pertenece a un seller del usuario autenticado.
 *
 * No basta con `supabase.from("listings").select(...).eq("id", id)` y
 * confiar en que RLS filtró el resultado: la policy `listings` es un OR
 * de `listings_select_own` y `listings_select_published`
 * (0002_rls_policies.sql), así que CUALQUIER usuario autenticado puede
 * leer un listing ajeno en estado "publicado". Esta función agrega el
 * filtro `seller_id = <seller del usuario autenticado>` a la consulta,
 * de modo que solo devuelve datos si el listing es realmente del dueño.
 *
 * Devuelve `{ data: null, error: null }` tanto si el usuario no tiene un
 * seller propio como si el listing no existe o no le pertenece: en
 * cualquiera de esos casos el llamador debe tratarlo igual (`notFound()`),
 * sin distinguir el motivo.
 */
export async function obtenerAnuncioPropio(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: { listingId: string; userId: string; select: string }
) {
  const { listingId, userId, select } = params;

  const { data: seller, error: sellerError } = await supabase
    .from("sellers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (sellerError) {
    return { data: null, error: sellerError };
  }

  if (!seller) {
    return { data: null, error: null };
  }

  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select(select)
    .eq("id", listingId)
    .eq("seller_id", seller.id)
    .maybeSingle();

  return { data: listing, error: listingError };
}
