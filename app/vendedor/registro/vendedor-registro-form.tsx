"use client";

import { useActionState, useState } from "react";
import { validarRut } from "@/lib/rut";
import { registrarVendedor, type VendedorRegistroState } from "./actions";

const initialVendedorRegistroState: VendedorRegistroState = { error: null };

/**
 * Formulario de registro de vendedor (T-07).
 *
 * Validación en el cliente (feedback inmediato, no bloquea seguridad) más
 * validación en el servidor (`registrarVendedor`, fuente de verdad): tipo
 * de vendedor válido, RUT válido (`validarRut`, T-06) y documento de
 * respaldo presente. Si la validación de cliente falla, se muestra el
 * error y NO se envía el formulario (se previene el submit).
 */
export function VendedorRegistroForm() {
  const [state, formAction, isPending] = useActionState(
    registrarVendedor,
    initialVendedorRegistroState
  );
  const [clientError, setClientError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const formData = new FormData(form);

    const sellerType = String(formData.get("seller_type") ?? "");
    const rut = String(formData.get("rut") ?? "").trim();
    const documento = formData.get("documento");

    if (sellerType !== "persona_natural" && sellerType !== "concesionario") {
      event.preventDefault();
      setClientError("Selecciona un tipo de vendedor válido.");
      return;
    }

    if (!rut || !validarRut(rut)) {
      event.preventDefault();
      setClientError("RUT inválido.");
      return;
    }

    if (!(documento instanceof File) || documento.size === 0) {
      event.preventDefault();
      setClientError("El documento de respaldo es obligatorio.");
      return;
    }

    setClientError(null);
  }

  const error = clientError ?? state.error;

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Tipo de vendedor</legend>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="seller_type"
            value="persona_natural"
            defaultChecked
            onChange={() => setClientError(null)}
          />
          Persona natural
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="seller_type"
            value="concesionario"
            onChange={() => setClientError(null)}
          />
          Concesionario
        </label>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="rut" className="text-sm font-medium">
          RUT (personal o de la empresa, según el tipo elegido)
        </label>
        <input
          id="rut"
          name="rut"
          type="text"
          required
          placeholder="12.345.678-5"
          onChange={() => setClientError(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="documento" className="text-sm font-medium">
          Documento de respaldo
        </label>
        <input
          id="documento"
          name="documento"
          type="file"
          required
          onChange={() => setClientError(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
      >
        {isPending ? "Enviando..." : "Registrarme como vendedor"}
      </button>
    </form>
  );
}
