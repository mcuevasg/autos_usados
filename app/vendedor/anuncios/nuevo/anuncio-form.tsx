"use client";

import { useActionState, useState } from "react";
import { crearAnuncio, type AnuncioFormState } from "./actions";

const initialAnuncioFormState: AnuncioFormState = {
  error: null,
  fieldErrors: {},
};

const USAGE_TYPE_OPCIONES: { value: string; label: string }[] = [
  { value: "familiar", label: "Familiar" },
  { value: "trabajo", label: "Trabajo" },
  { value: "carga", label: "Carga" },
  { value: "todo_terreno", label: "Todo terreno" },
];

/**
 * Valida en el cliente los 5 campos obligatorios exigidos por el
 * criterio de aceptación de T-09 (marca, modelo, año, kilometraje,
 * precio), más los campos adicionales exigidos por T-11 (estado del
 * vehículo, tipo de uso, papeles al día) y la ubicación que la tabla
 * `listings` exige NOT NULL sin default.
 *
 * Es solo feedback inmediato (no bloquea seguridad): la Server Action
 * (`crearAnuncio`) vuelve a validar todo en el servidor, que es la
 * fuente de verdad.
 */
function validarEnCliente(
  formData: FormData
): AnuncioFormState["fieldErrors"] {
  const fieldErrors: AnuncioFormState["fieldErrors"] = {};

  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const yearRaw = String(formData.get("year") ?? "").trim();
  const mileageRaw = String(formData.get("mileage") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").trim();
  const vehicleCondition = String(
    formData.get("vehicle_condition") ?? ""
  ).trim();
  const usageType = String(formData.get("usage_type") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const papersUpToDateRaw = formData.get("papers_up_to_date");

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

  if (!usageType) {
    fieldErrors.usage_type = "Selecciona un tipo de uso válido.";
  }

  if (!location) {
    fieldErrors.location = "La ubicación es obligatoria.";
  }

  if (papersUpToDateRaw !== "true" && papersUpToDateRaw !== "false") {
    fieldErrors.papers_up_to_date = "Indica si los papeles están al día.";
  }

  return fieldErrors;
}

export function AnuncioForm() {
  const [state, formAction, isPending] = useActionState(
    crearAnuncio,
    initialAnuncioFormState
  );
  const [clientFieldErrors, setClientFieldErrors] = useState<
    AnuncioFormState["fieldErrors"] | null
  >(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const formData = new FormData(form);

    const fieldErrors = validarEnCliente(formData);
    if (Object.keys(fieldErrors).length > 0) {
      event.preventDefault();
      setClientFieldErrors(fieldErrors);
      return;
    }

    setClientFieldErrors(null);
  }

  const fieldErrors = clientFieldErrors ?? state.fieldErrors;
  const generalError = clientFieldErrors
    ? "Revisa los campos marcados en rojo."
    : state.error;

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="brand" className="text-sm font-medium">
          Marca
        </label>
        <input
          id="brand"
          name="brand"
          type="text"
          onChange={() => setClientFieldErrors(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
        {fieldErrors.brand && (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.brand}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="model" className="text-sm font-medium">
          Modelo
        </label>
        <input
          id="model"
          name="model"
          type="text"
          onChange={() => setClientFieldErrors(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
        {fieldErrors.model && (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.model}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="year" className="text-sm font-medium">
          Año
        </label>
        <input
          id="year"
          name="year"
          type="number"
          min={1900}
          step={1}
          onChange={() => setClientFieldErrors(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
        {fieldErrors.year && (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.year}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="mileage" className="text-sm font-medium">
          Kilometraje
        </label>
        <input
          id="mileage"
          name="mileage"
          type="number"
          min={0}
          step={1}
          onChange={() => setClientFieldErrors(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
        {fieldErrors.mileage && (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.mileage}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="price" className="text-sm font-medium">
          Precio
        </label>
        <input
          id="price"
          name="price"
          type="number"
          min={0}
          step="0.01"
          onChange={() => setClientFieldErrors(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
        {fieldErrors.price && (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.price}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="vehicle_condition" className="text-sm font-medium">
          Estado del vehículo
        </label>
        <input
          id="vehicle_condition"
          name="vehicle_condition"
          type="text"
          placeholder="Ej: usado en buen estado"
          onChange={() => setClientFieldErrors(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
        {fieldErrors.vehicle_condition && (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.vehicle_condition}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="usage_type" className="text-sm font-medium">
          Tipo de uso
        </label>
        <select
          id="usage_type"
          name="usage_type"
          defaultValue=""
          onChange={() => setClientFieldErrors(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        >
          <option value="" disabled>
            Selecciona un tipo de uso
          </option>
          {USAGE_TYPE_OPCIONES.map((opcion) => (
            <option key={opcion.value} value={opcion.value}>
              {opcion.label}
            </option>
          ))}
        </select>
        {fieldErrors.usage_type && (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.usage_type}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">¿Papeles al día?</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="papers_up_to_date"
              value="true"
              onChange={() => setClientFieldErrors(null)}
              className="h-4 w-4"
            />
            Sí
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="papers_up_to_date"
              value="false"
              onChange={() => setClientFieldErrors(null)}
              className="h-4 w-4"
            />
            No
          </label>
        </div>
        {fieldErrors.papers_up_to_date && (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.papers_up_to_date}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="location" className="text-sm font-medium">
          Ubicación
        </label>
        <input
          id="location"
          name="location"
          type="text"
          placeholder="Ej: Santiago, Región Metropolitana"
          onChange={() => setClientFieldErrors(null)}
          className="rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2] dark:bg-transparent"
        />
        {fieldErrors.location && (
          <p className="text-sm text-red-600" role="alert">
            {fieldErrors.location}
          </p>
        )}
      </div>

      {generalError && (
        <p className="text-sm text-red-600" role="alert">
          {generalError}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
      >
        {isPending ? "Publicando..." : "Crear anuncio"}
      </button>
    </form>
  );
}
