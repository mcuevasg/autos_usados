import type { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Determina si un anuncio tiene el plan destacado VIGENTE en este
 * instante (T-18, REQ-09).
 *
 * IMPORTANTE: nunca hay que confiar solo en `featured_active` para decidir
 * si un anuncio "está destacado ahora". No existe ningún cron job ni
 * proceso automático (ver T-17, 0015_featured_listings.sql) que ponga
 * `featured_active = false` cuando `featured_expires_at` ya quedó en el
 * pasado, así que un anuncio puede tener `featured_active = true` en la
 * base de datos con una fecha de expiración vencida hace tiempo. Esta
 * función es el único punto de verdad para "¿está destacado ahora?":
 * exige `featured_active = true` Y `featured_expires_at` no nulo Y en el
 * futuro. Todo el código (página de búsqueda, y cualquier otra pantalla
 * que a futuro necesite mostrar el estado destacado) debe usar esta
 * función en vez de leer `featured_active` directamente.
 */
export function esDestacadoVigente(listing: {
  featured_active: boolean;
  featured_expires_at: string | null;
}): boolean {
  return (
    listing.featured_active &&
    listing.featured_expires_at !== null &&
    new Date(listing.featured_expires_at) > new Date()
  );
}

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
