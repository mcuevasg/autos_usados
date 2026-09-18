/**
 * Loading UI de `/anuncio/[id]` (T-27, convención `loading.tsx`, ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * loading.md`). Mismo razonamiento que `app/buscar/loading.tsx`:
 * `AnuncioDetallePage` es enteramente `async` (listing, tipo de vendedor y
 * URLs firmadas de todas las fotos, todo antes del primer `return`), así
 * que sin este archivo la navegación no muestra nada hasta que termine.
 *
 * Reproduce la silueta real (galería + panel de specs) con el mismo
 * lenguaje visual (`animate-pulse` + `bg-surface-muted`) que el resto de
 * los skeletons del sitio.
 */
export default function CargandoDetalleAnuncio() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-1 flex-col items-center bg-background px-6 py-16"
    >
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <div className="h-5 w-40 animate-pulse rounded-control bg-surface-muted" />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Galería: imagen principal 4:3 + fila de miniaturas, mismo
           * layout que `GaleriaFotos`. */}
          <div className="flex flex-col gap-3">
            <div className="aspect-[4/3] w-full animate-pulse rounded-card bg-surface-muted" />
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 w-20 shrink-0 animate-pulse rounded-control bg-surface-muted"
                />
              ))}
            </div>
          </div>

          {/* Panel de specs: título, precio y grilla de datos, mismo
           * layout que la `<dl>` real. */}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <div className="h-8 w-48 animate-pulse rounded-control bg-surface-muted" />
              <div className="h-5 w-32 animate-pulse rounded-control bg-surface-muted" />
              <div className="h-10 w-40 animate-pulse rounded-control bg-surface-muted" />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-card border border-border bg-surface p-4 shadow-card">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="h-3 w-16 animate-pulse rounded-control bg-surface-muted" />
                  <div className="h-4 w-20 animate-pulse rounded-control bg-surface-muted" />
                </div>
              ))}
            </div>

            <div className="h-12 w-full animate-pulse rounded-control bg-surface-muted sm:w-48" />
          </div>
        </div>
      </div>
    </div>
  );
}
