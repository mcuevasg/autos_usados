import { RegistroForm } from "./registro-form";

export default function RegistroPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-semibold">Crear cuenta</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Al registrarte quedas como <strong>comprador</strong>. El registro
          como vendedor (persona natural o concesionario) estará disponible
          próximamente.
        </p>
      </div>
      <RegistroForm />
    </div>
  );
}
