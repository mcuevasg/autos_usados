"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AnuncioFormState = {
  error: string | null;
  fieldErrors: Partial<
    Record<
      | "brand"
      | "model"
      | "year"
      | "mileage"
      | "price"
      | "vehicle_condition"
      | "usage_type"
      | "location",
      string
    >
  >;
};

export const initialAnuncioFormState: AnuncioFormState = {
  error: null,
  fieldErrors: {},
};

const USAGE_TYPES_VALIDOS = [
  "familiar",
  "trabajo",
  "carga",
  "todo_terreno",
] as const;
type UsageType = (typeof USAGE_TYPES_VALIDOS)[number];

function esUsageTypeValido(valor: string): valor is UsageType {
  return (USAGE_TYPES_VALIDOS as readonly string[]).includes(valor);
}

/**
 * Valida los campos del formulario de creación de anuncio.
 *
 * Los 5 campos exigidos explícitamente por el criterio de aceptación de
 * T-09 (marca, modelo, año, kilometraje, precio) generan un error
 * específico por campo si faltan o son inválidos. Los 3 campos
 * adicionales que exige el esquema (vehicle_condition, usage_type,
 * location, todas NOT NULL sin default) también se validan aquí para
 * que el insert nunca falle por constraint de base de datos, aunque no
 * son parte del criterio de aceptación de esta tarea (T-11 los formaliza
 * más adelante con catálogos/checkbox de papeles al día).
 */
function validarCamposAnuncio(formData: FormData): {
  error: string | null;
  fieldErrors: AnuncioFormState["fieldErrors"];
  valores?: {
    brand: string;
    model: string;
    year: number;
    mileage: number;
    price: number;
    vehicle_condition: string;
    usage_type: UsageType;
    location: string;
  };
} {
  const fieldErrors: AnuncioFormState["fieldErrors"] = {};

  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const yearRaw = String(formData.get("year") ?? "").trim();
  const mileageRaw = String(formData.get("mileage") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").trim();
  const vehicleCondition = String(
    formData.get("vehicle_condition") ?? ""
  ).trim();
  const usageTypeRaw = String(formData.get("usage_type") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();

  if (!brand) fieldErrors.brand = "La marca es obligatoria.";
  if (!model) fieldErrors.model = "El modelo es obligatorio.";

  const year = Number(yearRaw);
  if (!yearRaw || !Number.isInteger(year) || year < 1900) {
    fieldErrors.year = "Ingresa un año válido (1900 o posterior).";
  }

  const mileage = Number(mileageRaw);
  if (!mileageRaw || !Number.isInteger(mileage) || mileage < 0) {
    fieldErrors.mileage = "Ingresa un kilometraje válido (0 o más).";
  }

  const price = Number(priceRaw);
  if (!priceRaw || !Number.isFinite(price) || price < 0) {
    fieldErrors.price = "Ingresa un precio válido (0 o más).";
  }

  if (!vehicleCondition) {
    fieldErrors.vehicle_condition = "El estado del vehículo es obligatorio.";
  }

  if (!usageTypeRaw || !esUsageTypeValido(usageTypeRaw)) {
    fieldErrors.usage_type = "Selecciona un tipo de uso válido.";
  }

  if (!location) {
    fieldErrors.location = "La ubicación es obligatoria.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Revisa los campos marcados en rojo.", fieldErrors };
  }

  return {
    error: null,
    fieldErrors: {},
    valores: {
      brand,
      model,
      year,
      mileage,
      price,
      vehicle_condition: vehicleCondition,
      usage_type: usageTypeRaw as UsageType,
      location,
    },
  };
}

/**
 * Server Action de creación de anuncio (T-09).
 *
 * 1. Exige sesión activa.
 * 2. Vuelve a verificar en servidor (no confía en la UI) que el usuario
 *    tiene una fila en `sellers` con `verification_status = 'verificado'`
 *    ANTES de intentar el insert, para devolver un mensaje amigable en
 *    vez de dejar que falle con el error crudo de la política RLS
 *    `listings_insert_own` (0006_moderator_seller_review.sql), que de
 *    todas formas actúa como última línea de defensa a nivel de BD.
 * 3. Valida los 5 campos obligatorios del criterio de aceptación (brand,
 *    model, year, mileage, price) más los 3 campos adicionales que la
 *    tabla `listings` exige NOT NULL sin default (vehicle_condition,
 *    usage_type, location). Si falta o es inválido cualquiera de estos 8
 *    campos, no se inserta nada.
 * 4. Inserta en `listings` con el cliente autenticado normal (respeta
 *    RLS); `status` queda en 'borrador' y `papers_up_to_date` en false
 *    por default (T-11 los expondrá explícitamente en el formulario).
 * 5. Si el insert tiene éxito, redirige a la página de confirmación del
 *    anuncio recién creado.
 */
export async function crearAnuncio(
  _prevState: AnuncioFormState,
  formData: FormData
): Promise<AnuncioFormState> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: seller, error: sellerError } = await supabase
    .from("sellers")
    .select("id, verification_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sellerError) {
    return {
      error: `No se pudo verificar tu estado de vendedor: ${sellerError.message}`,
      fieldErrors: {},
    };
  }

  if (!seller) {
    return {
      error:
        "Debes registrarte como vendedor y quedar verificado antes de publicar un anuncio.",
      fieldErrors: {},
    };
  }

  if (seller.verification_status !== "verificado") {
    return {
      error:
        "Solo un vendedor en estado 'Verificado' puede crear un anuncio. Tu cuenta de vendedor aún no está verificada.",
      fieldErrors: {},
    };
  }

  const validacion = validarCamposAnuncio(formData);
  if (!validacion.valores) {
    return { error: validacion.error, fieldErrors: validacion.fieldErrors };
  }

  const { data: listing, error: insertError } = await supabase
    .from("listings")
    .insert({
      seller_id: seller.id,
      brand: validacion.valores.brand,
      model: validacion.valores.model,
      year: validacion.valores.year,
      mileage: validacion.valores.mileage,
      price: validacion.valores.price,
      vehicle_condition: validacion.valores.vehicle_condition,
      usage_type: validacion.valores.usage_type,
      location: validacion.valores.location,
    })
    .select("id")
    .single();

  if (insertError) {
    return {
      error: `No se pudo crear el anuncio: ${insertError.message}`,
      fieldErrors: {},
    };
  }

  redirect(`/vendedor/anuncios/${listing.id}`);
}
