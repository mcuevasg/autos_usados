import Link from "next/link";

/**
 * Home mínima del proyecto (reemplaza el boilerplate de create-next-app).
 * Solo ofrece los dos puntos de entrada públicos disponibles hasta T-13:
 * buscar anuncios publicados y, para vendedores, registrarse/ingresar.
 */
export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Autos usados
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Encuentra autos usados publicados por vendedores verificados.
        </p>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/buscar"
            className="flex h-12 w-full items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background sm:w-auto"
          >
            Buscar autos
          </Link>
          <Link
            href="/login"
            className="flex h-12 w-full items-center justify-center rounded-full border border-black/[.15] px-5 text-sm font-medium dark:border-white/[.2] sm:w-auto"
          >
            Ingresar / vender
          </Link>
        </div>
      </div>
    </div>
  );
}
