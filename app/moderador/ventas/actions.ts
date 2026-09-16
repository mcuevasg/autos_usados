"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AprobarVentaState = {
  error: string | null;
};

export const initialAprobarVentaState: AprobarVentaState = {
  error: null,
};

/**
 * Confirma en servidor (no confía en la UI) que el usuario autenticado
 * tiene `profiles.role === 'moderador'`. Devuelve el user autenticado si
 * corresponde, o null si no hay sesión o no es moderador. Mismo patrón
 * duplicado que `requireModerador` en
 * `app/moderador/vendedores/actions.ts` (T-08) y
 * `app/moderador/anuncios/actions.ts` (T-12): cada Server Action de
 * moderador re-verifica el rol de forma independiente.
 */
async function requireModerador(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "moderador") return null;

  return user;
}

/** Porcentaje de comisión sobre el precio final acordado (decisión de
 * negocio para T-16, REQ-08): 5%. */
const PORCENTAJE_COMISION = 0.05;

/**
 * Redondea a 2 decimales, coherente con el tipo `numeric(12,2)` de
 * `sales.commission` (0001_initial_schema.sql). Evita enviar un `float`
 * con más precisión de la que la columna acepta (Postgres igual lo
 * redondearía, pero así el valor mostrado en la UI tras `revalidatePath`
 * coincide exactamente con el guardado).
 */
function calcularComision(finalPrice: number): number {
  return Math.round(finalPrice * PORCENTAJE_COMISION * 100) / 100;
}

/**
 * Server Action de aprobación de venta (T-16, REQ-08): un moderador
 * aprueba una solicitud de venta concretada (creada por el vendedor en
 * T-15), lo que dispara dos efectos:
 *   1. La fila de `sales` pasa a `status = 'aprobada'` con `commission`
 *      calculada como 5% de `final_price`.
 *   2. El anuncio (`listings`) referenciado pasa a `status = 'vendido'`.
 *
 * Vuelve a verificar en servidor que quien invoca es moderador (no basta
 * con que la UI solo muestre el botón "Aprobar venta" a moderadores).
 * Ambos updates usan el cliente SSR autenticado normal (no el admin):
 * `sales_update_moderator` (0014_sales_approval.sql) y
 * `listings_update_moderator` (0010_listing_status_lifecycle.sql) ya
 * permiten estas actualizaciones para un moderador.
 *
 * LIMITACIÓN CONOCIDA Y MECANISMO DE RECUPERACIÓN: estos dos updates
 * (`sales` y `listings`) no son atómicos entre sí — PostgREST/Supabase no
 * ofrece una transacción multi-tabla desde el cliente sin una función RPC
 * dedicada, que está fuera del alcance de esta iteración. Si el update de
 * `sales` tiene éxito pero el de `listings` falla (p.ej. corte de red
 * entre ambas llamadas), la venta queda marcada 'aprobada' con su
 * comisión ya calculada, pero el anuncio no pasa a 'vendido': un simple
 * reintento de esta función NO es seguro por sí solo, porque el guard de
 * más abajo rechazaría de inmediato una `sale.status === 'aprobada'`
 * como "ya procesada", sin volver a intentar el update de `listings`.
 * Para que el reintento sí sea recuperable, cuando `sale.status` ya es
 * 'aprobada' esta función NO responde de inmediato con el error: primero
 * relee el `listing` asociado y, si su `status` todavía no es 'vendido',
 * asume que quedó a mitad de camino por este escenario y reintenta
 * ÚNICAMENTE el update de `listings` (sin volver a tocar `sales`, cuyo
 * `status`/`commission` ya son correctos). Solo si el `listing` ya está
 * 'vendido' se concluye que la solicitud está completamente procesada y
 * se devuelve el error correspondiente. El caso inverso (que `listings`
 * se actualice pero `sales` no) no puede ocurrir porque el update de
 * `sales` se ejecuta primero.
 */
export async function aprobarVenta(
  saleId: string,
  // Requeridos por la firma de acción de useActionState (prevState,
  // formData), pero no se usan: no hay estado previo relevante ni datos
  // de formulario, el botón "Aprobar venta" no envía ningún input
  // (VentaAcciones).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: AprobarVentaState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData
): Promise<AprobarVentaState> {
  if (!saleId) {
    return { error: "Falta el identificador de la venta." };
  }

  const supabase = await createSupabaseServerClient();

  const moderador = await requireModerador(supabase);
  if (!moderador) {
    return {
      error: "No tienes permisos de moderador para realizar esta acción.",
    };
  }

  const { data: sale, error: saleError } = await supabase
    .from("sales")
    .select("id, listing_id, final_price, status")
    .eq("id", saleId)
    .maybeSingle();

  if (saleError) {
    return {
      error: `No se pudo leer la solicitud de venta: ${saleError.message}`,
    };
  }

  if (!sale) {
    return { error: "La solicitud de venta no existe." };
  }

  if (sale.status !== "pendiente_aprobacion") {
    // `sale.status` ya no es 'pendiente_aprobacion'. Si es 'aprobada',
    // podría tratarse de una solicitud completamente procesada, o del
    // escenario de fallo parcial descrito arriba (el update de `sales`
    // tuvo éxito en un intento anterior pero el de `listings` falló):
    // distinguimos ambos casos mirando el estado real del `listing`.
    if (sale.status === "aprobada") {
      const { data: listing, error: listingReadError } = await supabase
        .from("listings")
        .select("status")
        .eq("id", sale.listing_id)
        .maybeSingle();

      if (listingReadError) {
        return {
          error:
            `No se pudo verificar el estado del anuncio asociado: ` +
            `${listingReadError.message}`,
        };
      }

      if (!listing) {
        return { error: "El anuncio asociado a esta venta ya no existe." };
      }

      if (listing.status !== "vendido") {
        // Fallo parcial recuperable: `sales` ya quedó 'aprobada' con su
        // comisión correcta, solo falta completar el cambio de estado del
        // anuncio. Reintentamos SOLO ese update, sin volver a tocar
        // `sales`.
        const { error: retryListingUpdateError } = await supabase
          .from("listings")
          .update({ status: "vendido" })
          .eq("id", sale.listing_id);

        if (retryListingUpdateError) {
          return {
            error:
              `La venta ya estaba aprobada, pero no se pudo actualizar ` +
              `el anuncio a "Vendido": ${retryListingUpdateError.message}. ` +
              `Reintenta para completar el cambio de estado del anuncio.`,
          };
        }

        revalidatePath("/moderador/ventas");
        revalidatePath("/moderador/anuncios");

        return { error: null };
      }

      return {
        error:
          "Esta venta ya fue aprobada y el anuncio ya está marcado como vendido.",
      };
    }

    return {
      error: "Esta solicitud de venta ya fue procesada.",
    };
  }

  const commission = calcularComision(Number(sale.final_price));

  const { error: saleUpdateError } = await supabase
    .from("sales")
    .update({ status: "aprobada", commission })
    .eq("id", saleId);

  if (saleUpdateError) {
    return {
      error: `No se pudo aprobar la venta: ${saleUpdateError.message}`,
    };
  }

  const { error: listingUpdateError } = await supabase
    .from("listings")
    .update({ status: "vendido" })
    .eq("id", sale.listing_id);

  if (listingUpdateError) {
    return {
      error:
        `La venta quedó aprobada y la comisión calculada, pero no se ` +
        `pudo actualizar el anuncio a "Vendido": ${listingUpdateError.message}. ` +
        `Reintenta para completar el cambio de estado del anuncio.`,
    };
  }

  revalidatePath("/moderador/ventas");
  revalidatePath("/moderador/anuncios");

  return { error: null };
}
