import { Suspense } from "react";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cerrarSesion } from "@/app/cuenta/actions";
import { HeaderNav } from "./header-nav";

/**
 * Header/navegación global persistente (T-23), renderizado desde
 * `app/layout.tsx` en todas las páginas.
 *
 * `SiteHeader` es un Server Component SIN `await` al tope: el logo y el
 * link "Buscar" (que no dependen de sesión) se renderizan de inmediato,
 * como parte del "static shell" de cada ruta. Solo la parte que sí depende
 * de sesión (`obtenerEstaLogueado()`, vía
 * `createSupabaseServerClient().auth.getUser()`, mismo patrón que
 * `app/cuenta/page.tsx`) se resuelve en subcomponentes anidados
 * (`SessionLinksDesktop`, `MobileMenu`) envueltos en `<Suspense>`.
 *
 * Antes, `SiteHeader` hacía `await` de la sesión al tope y volvía TODAS las
 * rutas del sitio dinámicas (incluyendo Home, /login y /registro, que no
 * tienen ninguna dependencia de datos). Empujar el `await` hacia adentro de
 * un boundary de Suspense evita ese bloqueo: ver
 * `node_modules/next/dist/docs/01-app/02-guides/streaming.md`, sección
 * "Push dynamic access down", y
 * `node_modules/next/dist/docs/01-app/02-guides/authentication.md`,
 * sección "Auth and streaming".
 *
 * La promesa de sesión se crea UNA sola vez acá (sin `await`) y se le pasa
 * a ambos subcomponentes: aunque cada uno hace su propio `await`, como es
 * la MISMA promesa no se dispara una segunda consulta a Supabase, solo dos
 * puntos de streaming independientes (nav de escritorio y menú mobile).
 *
 * Los subcomponentes le pasan a `HeaderNav` (Client Component) solo un
 * booleano (`estaLogueado`), nunca el email: el email es PII que no
 * necesita viajar al navegador, ya que `HeaderNav` solo lo usaba para
 * decidir qué botones mostrar.
 */
export function SiteHeader() {
  const estaLogueadoPromise = obtenerEstaLogueado();

  return (
    <header className="relative border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="shrink-0 text-heading-3 font-display text-foreground"
        >
          Autos Usados Chile
        </Link>

        {/* Nav de escritorio: oculto en mobile, visible desde md. El link
         * "Buscar" es estático (comprar es la acción principal, siempre
         * visible de inmediato); el estado de sesión streamea aparte. */}
        <nav aria-label="Principal" className="hidden items-center gap-6 md:flex">
          <EnlaceNav href="/buscar">Buscar</EnlaceNav>
          <Suspense fallback={<SessionLinksFallback />}>
            <SessionLinksDesktop estaLogueadoPromise={estaLogueadoPromise} />
          </Suspense>
        </nav>

        {/* Botón hamburguesa + panel mobile: solo en mobile, requieren el
         * estado de sesión para decidir qué enlaces mostrar en el panel. */}
        <Suspense fallback={<HamburgerFallback />}>
          <MobileMenu estaLogueadoPromise={estaLogueadoPromise} />
        </Suspense>
      </div>
    </header>
  );
}

/**
 * Resuelve si hay una sesión activa. Se exporta para poder testearla en
 * forma aislada (sin tener que renderizar árboles de Suspense en el test).
 */
export async function obtenerEstaLogueado(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user !== null;
}

/**
 * Enlaces de navegación en formato de link de texto (usados por el link
 * "Buscar" estático y por los links de sesión del nav de escritorio).
 */
function EnlaceNav({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-control px-1 text-body-sm font-medium text-foreground-muted transition-colors hover:text-foreground md:px-0"
    >
      {children}
    </Link>
  );
}

/**
 * Server Component async: resuelve la sesión (a partir de la promesa
 * compartida) y renderiza los links/botón del nav de escritorio. Se exporta
 * para poder testearla invocándola directamente con una promesa ya resuelta.
 */
export async function SessionLinksDesktop({
  estaLogueadoPromise,
}: {
  estaLogueadoPromise: Promise<boolean>;
}) {
  const estaLogueado = await estaLogueadoPromise;

  if (estaLogueado) {
    return (
      <>
        <EnlaceNav href="/cuenta">Mi cuenta</EnlaceNav>
        <form action={cerrarSesion}>
          <button
            type="submit"
            className="rounded-pill border border-border-strong px-4 py-2 text-body-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            Cerrar sesión
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <EnlaceNav href="/login">Ingresar</EnlaceNav>
      <Link
        href="/registro"
        className="rounded-pill bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        Vender / Registrarme
      </Link>
    </>
  );
}

/**
 * Server Component async: resuelve la sesión (misma promesa compartida) y
 * renderiza `HeaderNav` (botón hamburguesa + panel mobile) pasándole solo
 * el booleano ya resuelto.
 */
export async function MobileMenu({
  estaLogueadoPromise,
}: {
  estaLogueadoPromise: Promise<boolean>;
}) {
  const estaLogueado = await estaLogueadoPromise;

  return <HeaderNav estaLogueado={estaLogueado} />;
}

/**
 * Fallback del nav de escritorio mientras se resuelve la sesión: skeleton
 * del tamaño aproximado de "Ingresar" + el botón pill, para evitar layout
 * shift (CLS) cuando el contenido real los reemplaza.
 */
function SessionLinksFallback() {
  return (
    <div aria-hidden="true" className="flex items-center gap-6">
      <div className="h-4 w-16 animate-pulse rounded-control bg-surface-muted" />
      <div className="h-9 w-36 animate-pulse rounded-pill bg-surface-muted" />
    </div>
  );
}

/**
 * Fallback del botón hamburguesa mientras se resuelve la sesión: mismo
 * tamaño que el botón real, para evitar layout shift (CLS).
 */
function HamburgerFallback() {
  return (
    <div
      aria-hidden="true"
      className="h-10 w-10 shrink-0 animate-pulse rounded-control border border-border-strong md:hidden"
    />
  );
}
