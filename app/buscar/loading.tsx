/**
 * Loading UI de `/buscar` (T-27, convención `loading.tsx` de Next.js App
 * Router: ver `node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/loading.md`).
 *
 * `BuscarPage` es un Server Component enteramente `async` (filtros, query a
 * `listings`, `sellers_public_info` y URLs firmadas de fotos, todo antes del
 * primer `return`): sin este archivo, Next.js envuelve igual la navegación
 * en un límite de Suspense implícito, pero sin fallback no se ve nada hasta
 * que la página completa esté lista -a diferencia del Home (T-24), que
 * empuja sus únicas dependencias de datos a `<Suspense>` internos-. Acá no
 * conviene aplicar el mismo empuje: los resultados dependen por completo de
 * los filtros ya resueltos en el servidor, así que un solo skeleton de
 * página completa (mismo criterio que usa Next.js para `dashboard/
 * loading.tsx` en su propia documentación) es más simple y correcto que
 * fragmentar la página en múltiples `<Suspense>` sin necesidad real.
 *
 * El esqueleto reproduce la silueta real (encabezado, formulario de
 * filtros, grilla de cards) con `animate-pulse` + `bg-surface-muted`, mismo
 * lenguaje visual que `EstadisticasFallback`/`GrillaMarcasFallback`
 * (`app/components/landing-datos.tsx`, T-24) y `SessionLinksFallback`
 * (`app/components/site-header.tsx`, T-23), para que la carga se sienta
 * parte del mismo sistema de diseño en vez de un spinner genérico.
 */
export default function CargandoBuscar() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-1 flex-col items-center gap-8 bg-background px-6 py-16"
    >
      <div className="flex w-full max-w-5xl flex-col gap-2">
        <div className="h-9 w-56 animate-pulse rounded-control bg-surface-muted" />
        <div className="h-5 w-full max-w-md animate-pulse rounded-control bg-surface-muted" />
      </div>

      {/* Formulario de filtros: 4 inputs + 2 botones, mismo layout que el
       * real (`grid-cols-1 sm:grid-cols-2 md:grid-cols-4`). */}
      <div className="flex w-full max-w-5xl flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-card">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-4 w-16 animate-pulse rounded-control bg-surface-muted" />
              <div className="h-10 w-full animate-pulse rounded-control bg-surface-muted" />
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-24 animate-pulse rounded-control bg-surface-muted" />
          <div className="h-10 w-32 animate-pulse rounded-control bg-surface-muted" />
        </div>
      </div>

      {/* Grilla de cards: mismo grid que `AnuncioCard` (1 columna en
       * mobile, hasta 3 en desktop) para no saltar de layout al llegar los
       * resultados reales. */}
      <div className="flex w-full max-w-5xl flex-col gap-10">
        <div className="flex flex-col gap-4">
          <div className="h-8 w-64 animate-pulse rounded-control bg-surface-muted" />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <TarjetaAnuncioSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Silueta de una `AnuncioCard`: imagen 4:3, precio y dos líneas de specs. */
function TarjetaAnuncioSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="aspect-[4/3] w-full animate-pulse bg-surface-muted" />
      <div className="flex flex-col gap-3 p-4">
        <div className="h-7 w-28 animate-pulse rounded-control bg-surface-muted" />
        <div className="h-4 w-full animate-pulse rounded-control bg-surface-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded-control bg-surface-muted" />
      </div>
    </div>
  );
}
