"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { validarRut } from "@/lib/rut";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type VendedorRegistroState = {
  error: string | null;
};

export const initialVendedorRegistroState: VendedorRegistroState = {
  error: null,
};

const TIPOS_VENDEDOR_VALIDOS = ["persona_natural", "concesionario"] as const;
type TipoVendedor = (typeof TIPOS_VENDEDOR_VALIDOS)[number];

function esTipoVendedorValido(valor: string): valor is TipoVendedor {
  return (TIPOS_VENDEDOR_VALIDOS as readonly string[]).includes(valor);
}

/**
 * Server Action de registro de vendedor (T-07).
 *
 * Valida tipo de vendedor, RUT (usando `validarRut`, T-06) y presencia del
 * documento de respaldo. Si todo es válido:
 *  1. Sube el documento a Storage (bucket `seller-documents`, privado, ver
 *     0005_seller_documents_storage.sql) bajo el path `{user.id}/{uuid}-{nombre}`,
 *     usando el cliente autenticado del usuario (respeta las políticas de
 *     `storage.objects` de ese bucket).
 *  2. Inserta la fila en `public.sellers` (queda en `verification_status =
 *     'pendiente'` por default), usando el cliente autenticado (respeta
 *     `sellers_insert_own`, 0002_rls_policies.sql).
 *  3. Actualiza `public.profiles.role` a 'vendedor' usando el cliente
 *     service_role (`lib/supabase/admin.ts`), porque la política RLS de
 *     `profiles` no permite update a `authenticated` a propósito
 *     (0004_profiles_and_roles.sql).
 *
 * Si el insert en `sellers` falla después de subir el archivo, el archivo
 * queda huérfano en Storage (no se implementa rollback automático); se
 * reporta el error al usuario para que pueda reintentar.
 */
export async function registrarVendedor(
  _prevState: VendedorRegistroState,
  formData: FormData
): Promise<VendedorRegistroState> {
  const sellerType = String(formData.get("seller_type") ?? "");
  const rut = String(formData.get("rut") ?? "").trim();
  const documento = formData.get("documento");

  if (!esTipoVendedorValido(sellerType)) {
    return { error: "Selecciona un tipo de vendedor válido." };
  }

  if (!rut) {
    return { error: "El RUT es obligatorio." };
  }

  if (!validarRut(rut)) {
    return { error: "RUT inválido." };
  }

  if (!(documento instanceof File) || documento.size === 0) {
    return { error: "El documento de respaldo es obligatorio." };
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Evita un segundo registro si el usuario ya tiene una fila en sellers.
  const { data: existente } = await supabase
    .from("sellers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existente) {
    return { error: "Ya existe un registro de vendedor para esta cuenta." };
  }

  const nombreArchivo = documento.name || "documento";
  const extension = nombreArchivo.includes(".")
    ? nombreArchivo.slice(nombreArchivo.lastIndexOf("."))
    : "";
  const storagePath = `${user.id}/${randomUUID()}${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("seller-documents")
    .upload(storagePath, documento, {
      contentType: documento.type || undefined,
      upsert: false,
    });

  if (uploadError) {
    return {
      error: `No se pudo subir el documento de respaldo: ${uploadError.message}`,
    };
  }

  const { error: insertError } = await supabase.from("sellers").insert({
    user_id: user.id,
    seller_type: sellerType,
    rut,
    verification_status: "pendiente",
    verification_document_url: storagePath,
  });

  if (insertError) {
    return {
      error:
        `No se pudo registrar el vendedor: ${insertError.message}. ` +
        "El documento ya se subió a Storage; contacta a soporte si el problema persiste.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { error: roleUpdateError } = await admin
    .from("profiles")
    .update({ role: "vendedor" })
    .eq("id", user.id);

  if (roleUpdateError) {
    return {
      error:
        `El registro de vendedor quedó creado, pero no se pudo actualizar el rol de la cuenta: ${roleUpdateError.message}. ` +
        "Contacta a soporte.",
    };
  }

  redirect("/vendedor/registro");
}
