"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type FotosFormState = {
  error: string | null;
};

export const initialFotosFormState: FotosFormState = {
  error: null,
};

/**
 * Confirma en servidor (no confía en la UI) que el listing pertenece a un
 * seller del usuario autenticado. Devuelve el user si corresponde, o null
 * si no hay sesión o el listing no es suyo.
 */
async function requireDuenioDelAnuncio(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  listingId: string
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: seller } = await supabase
    .from("sellers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!seller) return null;

  const { data: listing } = await supabase
    .from("listings")
    .select("id")
    .eq("id", listingId)
    .eq("seller_id", seller.id)
    .maybeSingle();

  if (!listing) return null;

  return user;
}

/**
 * Server Action de subida de fotos de un anuncio (T-10).
 *
 * 1. Exige sesión y que el listing pertenezca al usuario autenticado
 *    (más allá de esta verificación, las políticas RLS de
 *    `storage.objects` y `listing_photos` en
 *    0009_listing_photos_storage_and_minimum.sql / 0002_rls_policies.sql
 *    actúan como última línea de defensa a nivel de base de datos).
 * 2. Sube cada archivo recibido al bucket `listing-photos` bajo el path
 *    `{listing_id}/{uuid}{ext}`, con el cliente autenticado normal.
 * 3. Inserta la fila correspondiente en `listing_photos` por cada archivo
 *    subido con éxito, con `position` correlativo a partir de las fotos
 *    ya existentes.
 * 4. Revalida la página de fotos y el resumen del anuncio.
 *
 * El mínimo de 3 fotos para poder publicar NO se valida aquí: queda
 * garantizado a nivel de base de datos por el trigger
 * `listings_require_min_photos_to_publish` (T-10), que se dispara cuando
 * exista una acción de "publicar" (T-12).
 */
export async function subirFotos(
  listingId: string,
  _prevState: FotosFormState,
  formData: FormData
): Promise<FotosFormState> {
  const supabase = await createSupabaseServerClient();

  const user = await requireDuenioDelAnuncio(supabase, listingId);
  if (!user) {
    return {
      error: "No tienes permisos para subir fotos a este anuncio.",
    };
  }

  const archivos = formData
    .getAll("fotos")
    .filter((valor): valor is File => valor instanceof File && valor.size > 0);

  if (archivos.length === 0) {
    return { error: "Selecciona al menos un archivo de foto." };
  }

  const { count: fotosExistentes } = await supabase
    .from("listing_photos")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listingId);

  let siguientePosicion = fotosExistentes ?? 0;

  for (const archivo of archivos) {
    const nombreArchivo = archivo.name || "foto";
    const extension = nombreArchivo.includes(".")
      ? nombreArchivo.slice(nombreArchivo.lastIndexOf("."))
      : "";
    const storagePath = `${listingId}/${randomUUID()}${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("listing-photos")
      .upload(storagePath, archivo, {
        contentType: archivo.type || undefined,
        upsert: false,
      });

    if (uploadError) {
      return {
        error: `No se pudo subir "${nombreArchivo}": ${uploadError.message}`,
      };
    }

    const { error: insertError } = await supabase.from("listing_photos").insert({
      listing_id: listingId,
      storage_path: storagePath,
      position: siguientePosicion,
    });

    if (insertError) {
      return {
        error:
          `"${nombreArchivo}" se subió a Storage pero no se pudo registrar en la base de datos: ` +
          `${insertError.message}`,
      };
    }

    siguientePosicion += 1;
  }

  revalidatePath(`/vendedor/anuncios/${listingId}/fotos`);
  revalidatePath(`/vendedor/anuncios/${listingId}`);

  return { error: null };
}

/**
 * Server Action de borrado de una foto propia (buena práctica menor, no
 * exigida por el criterio de aceptación): borra el objeto en Storage y la
 * fila correspondiente en `listing_photos`.
 *
 * Usa la misma forma `(listingId, prevState, formData)` que `subirFotos`
 * para poder usarse con `useActionState` vía
 * `borrarFoto.bind(null, listingId)`, recibiendo el `photo_id` desde un
 * input oculto del formulario (mismo patrón que
 * `app/moderador/vendedores/actions.ts`).
 */
export async function borrarFoto(
  listingId: string,
  _prevState: FotosFormState,
  formData: FormData
): Promise<FotosFormState> {
  const photoId = String(formData.get("photo_id") ?? "");

  if (!photoId) {
    return { error: "Falta el identificador de la foto." };
  }

  const supabase = await createSupabaseServerClient();

  const user = await requireDuenioDelAnuncio(supabase, listingId);
  if (!user) {
    return { error: "No tienes permisos para borrar fotos de este anuncio." };
  }

  const { data: foto, error: fotoError } = await supabase
    .from("listing_photos")
    .select("id, storage_path")
    .eq("id", photoId)
    .eq("listing_id", listingId)
    .maybeSingle();

  if (fotoError || !foto) {
    return { error: "No se encontró la foto a borrar." };
  }

  const { error: removeError } = await supabase.storage
    .from("listing-photos")
    .remove([foto.storage_path]);

  if (removeError) {
    return {
      error: `No se pudo borrar el archivo en Storage: ${removeError.message}`,
    };
  }

  const { error: deleteError } = await supabase
    .from("listing_photos")
    .delete()
    .eq("id", photoId);

  if (deleteError) {
    return {
      error: `El archivo se borró de Storage pero no se pudo borrar el registro: ${deleteError.message}`,
    };
  }

  revalidatePath(`/vendedor/anuncios/${listingId}/fotos`);
  revalidatePath(`/vendedor/anuncios/${listingId}`);

  return { error: null };
}
