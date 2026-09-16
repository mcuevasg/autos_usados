"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RegistroState = {
  error: string | null;
  message: string | null;
};

export const initialRegistroState: RegistroState = { error: null, message: null };

/**
 * Server Action de registro (T-05). Crea el usuario en Supabase Auth vía
 * `auth.signUp`. El rol ('comprador' por defecto) se asigna del lado del
 * servidor mediante el trigger `handle_new_user` sobre `auth.users`
 * (ver supabase/migrations/0004_profiles_and_roles.sql), no aquí: este
 * formulario no permite elegir rol.
 *
 * Si el proyecto Supabase tiene habilitada la confirmación de email,
 * `signUp` no retorna una sesión activa; en ese caso se muestra un
 * mensaje en vez de redirigir.
 */
export async function registrarUsuario(
  _prevState: RegistroState,
  formData: FormData
): Promise<RegistroState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email y contraseña son obligatorios.", message: null };
  }

  if (password.length < 6) {
    return { error: "La contraseña debe tener al menos 6 caracteres.", message: null };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message, message: null };
  }

  if (!data.session) {
    return {
      error: null,
      message:
        "Registro exitoso. Revisa tu email para confirmar la cuenta y luego inicia sesión.",
    };
  }

  redirect("/cuenta");
}
