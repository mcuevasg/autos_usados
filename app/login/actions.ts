"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LoginState = {
  error: string | null;
};

export const initialLoginState: LoginState = { error: null };

/**
 * Server Action de login (T-05): usa `auth.signInWithPassword`. La
 * sesión resultante queda en cookies (via @supabase/ssr), por lo que
 * `app/cuenta/page.tsx` puede leerla como Server Component.
 */
export async function iniciarSesion(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email y contraseña son obligatorios." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect("/cuenta");
}
