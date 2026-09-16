import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cerrarSesion } from "./actions";

export default async function CuentaPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">Mi cuenta</h1>

        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Email</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600 dark:text-zinc-400">Rol</dt>
            <dd className="font-medium">{profile?.role ?? "sin definir"}</dd>
          </div>
        </dl>

        {profileError && (
          <p className="text-sm text-red-600" role="alert">
            No se pudo leer el perfil ({profileError.message}). Verifica que la
            migración 0004_profiles_and_roles.sql esté aplicada en Supabase.
          </p>
        )}

        <form action={cerrarSesion}>
          <button
            type="submit"
            className="rounded-full border border-black/[.15] px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.08]"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}
