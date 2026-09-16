import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VendedorRegistroForm } from "./vendedor-registro-form";

const ETIQUETAS_ESTADO: Record<string, string> = {
  pendiente: "Pendiente de revisión",
  verificado: "Verificado",
  rechazado: "Rechazado",
};

const ETIQUETAS_TIPO: Record<string, string> = {
  persona_natural: "Persona natural",
  concesionario: "Concesionario",
};

export default async function VendedorRegistroPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: seller, error: sellerError } = await supabase
    .from("sellers")
    .select("seller_type, rut, verification_status")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-semibold">Registro de vendedor</h1>
        {!seller && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Elige si te registras como persona natural o concesionario,
            ingresa tu RUT y sube un documento de respaldo. Tu cuenta quedará
            en estado &quot;Pendiente de revisión&quot; hasta que un
            moderador la verifique.
          </p>
        )}
      </div>

      {sellerError && (
        <p className="text-sm text-red-600" role="alert">
          No se pudo leer el estado de vendedor ({sellerError.message}).
          Verifica que la migración 0005_seller_documents_storage.sql esté
          aplicada en Supabase.
        </p>
      )}

      {seller ? (
        <div className="flex w-full max-w-sm flex-col gap-2 rounded border border-black/[.15] p-4 text-sm dark:border-white/[.2]">
          <p>
            Ya tienes un registro de vendedor como{" "}
            <strong>{ETIQUETAS_TIPO[seller.seller_type] ?? seller.seller_type}</strong>
            .
          </p>
          <p>
            Estado:{" "}
            <strong>
              {ETIQUETAS_ESTADO[seller.verification_status] ??
                seller.verification_status}
            </strong>
          </p>
        </div>
      ) : (
        <VendedorRegistroForm />
      )}
    </div>
  );
}
