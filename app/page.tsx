import { Suspense } from "react";
import Link from "next/link";
import {
  obtenerResumenMarketplace,
  type ResumenMarketplace,
} from "@/lib/landing";
import {
  Estadisticas,
  EstadisticasFallback,
  GrillaMarcas,
  GrillaMarcasFallback,
} from "./components/landing-datos";

/**
 * Landing page pública (T-24).
 *
 * Reemplaza el bloque centrado con dos botones que había hasta T-23 por una
 * portada que tiene que responder en pocos segundos "¿qué es esto y por qué
 * debería confiar?": hero con propuesta de valor + buscador embebido,
 * marcas destacadas y señales de confianza.
 *
 * Decisiones estructurales:
 *
 * - El componente de la ruta NO es `async`: igual que `SiteHeader` (T-23),
 *   todo lo que no depende de datos (hero, textos, buscador, sección de
 *   confianza, CTA final) forma parte del "static shell" y se pinta de
 *   inmediato. Lo único que necesita la base de datos -las cifras del hero
 *   y la grilla de marcas- vive en Server Components async envueltos en
 *   `<Suspense>`, así una consulta lenta a Supabase nunca deja la portada
 *   en blanco. Ver
 *   `node_modules/next/dist/docs/01-app/02-guides/streaming.md`, sección
 *   "Push dynamic access down".
 *
 * - La promesa del resumen se crea UNA sola vez acá (sin `await`) y se le
 *   pasa a los dos subcomponentes: como es la MISMA promesa, hay una sola
 *   consulta a Supabase pero dos puntos de streaming independientes. Mismo
 *   patrón que la promesa de sesión en `app/components/site-header.tsx`.
 *
 * - El header global ya se renderiza desde `app/layout.tsx`, así que esta
 *   página no repite logo ni navegación.
 */
export default function Home() {
  const resumenPromise = obtenerResumenMarketplace();

  return (
    <main className="flex flex-1 flex-col">
      <Hero resumenPromise={resumenPromise} />
      <SeccionMarcas resumenPromise={resumenPromise} />
      <SeccionConfianza />
      <SeccionVender />
    </main>
  );
}

/* ========================================================================
 * Hero
 * ===================================================================== */

function Hero({
  resumenPromise,
}: {
  resumenPromise: Promise<ResumenMarketplace>;
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-border bg-linear-to-b from-primary-soft via-background to-background">
      {/* Halo cálido decorativo: aporta profundidad al hero sin cargar una
       * imagen (cero costo de red y se adapta solo a dark mode). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-24 -z-10 h-72 w-72 rounded-pill bg-accent-soft opacity-70 blur-3xl sm:h-[28rem] sm:w-[28rem]"
      />

      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-4 py-14 text-center sm:px-6 sm:py-20 lg:py-24">
        <p className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1 text-caption font-medium text-foreground-muted shadow-card">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-pill bg-success"
          />
          Solo vendedores verificados con RUT
        </p>

        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="text-balance text-heading-1 text-foreground sm:text-display lg:text-display-lg">
            Tu próximo auto usado, sin sorpresas
          </h1>
          <p className="text-pretty text-body text-foreground-muted sm:text-body-lg">
            Compara precio, año, kilometraje y estado entre anuncios reales de
            vendedores verificados en todo Chile. Sin intermediarios ni letra
            chica.
          </p>
        </div>

        <BuscadorRapido />

        <Link
          href="/buscar"
          className="rounded-control px-2 py-1 text-body-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary-hover hover:underline"
        >
          Ver todos los autos publicados →
        </Link>

        <Suspense fallback={<EstadisticasFallback />}>
          <Estadisticas resumenPromise={resumenPromise} />
        </Suspense>
      </div>
    </section>
  );
}

/**
 * Buscador rápido embebido en el hero.
 *
 * Es un `<form method="get" action="/buscar">` de HTML puro: al enviarlo, el
 * navegador navega a `/buscar?brand=...&model=...&location=...`, que es
 * exactamente lo que `app/buscar/page.tsx` ya lee desde `searchParams` (usa
 * los mismos nombres de campo: `brand`, `model`, `year`, `location`). No hace
 * falta estado de cliente, ni `useRouter`, ni una Server Action para leer
 * texto; los campos vacíos viajan como cadena vacía y `/buscar` los ignora
 * porque hace `trim()` antes de aplicar cada filtro.
 *
 * El botón de envío es el CTA dominante de la portada: el resto de los
 * llamados a la acción (link "Ver todos", CTA de vender) son visualmente
 * secundarios a propósito.
 */
function BuscadorRapido() {
  return (
    <form
      method="get"
      action="/buscar"
      aria-label="Búsqueda rápida de autos"
      className="w-full max-w-3xl rounded-card border border-border bg-surface p-4 text-left shadow-overlay sm:p-5"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end lg:gap-4">
        <CampoBuscador name="brand" etiqueta="Marca" placeholder="Ej: Toyota" />
        <CampoBuscador name="model" etiqueta="Modelo" placeholder="Ej: Yaris" />
        <CampoBuscador
          name="location"
          etiqueta="Ubicación"
          placeholder="Ej: Santiago"
        />
        <button
          type="submit"
          className="h-12 w-full rounded-control bg-primary px-6 text-body-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover sm:col-span-2 lg:col-span-1 lg:w-auto"
        >
          Buscar autos
        </button>
      </div>
    </form>
  );
}

function CampoBuscador({
  name,
  etiqueta,
  placeholder,
}: {
  name: string;
  etiqueta: string;
  placeholder: string;
}) {
  const id = `buscador-rapido-${name}`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-caption font-semibold uppercase text-foreground-subtle"
      >
        {etiqueta}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        className="h-12 w-full rounded-control border border-border-strong bg-surface px-3 text-body text-foreground transition-colors placeholder:text-foreground-subtle hover:border-primary focus:border-primary"
      />
    </div>
  );
}

/* ========================================================================
 * Marcas destacadas
 * ===================================================================== */

function SeccionMarcas({
  resumenPromise,
}: {
  resumenPromise: Promise<ResumenMarketplace>;
}) {
  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className="text-heading-2 text-foreground sm:text-heading-1">
              Explora por marca
            </h2>
            <p className="text-body-sm text-foreground-muted sm:text-body">
              Entra directo a los anuncios publicados de cada marca.
            </p>
          </div>
          <Link
            href="/buscar"
            className="shrink-0 rounded-control text-body-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary-hover hover:underline"
          >
            Ver todas →
          </Link>
        </div>

        <Suspense fallback={<GrillaMarcasFallback />}>
          <GrillaMarcas resumenPromise={resumenPromise} />
        </Suspense>
      </div>
    </section>
  );
}

/* ========================================================================
 * Confianza
 * ===================================================================== */

/**
 * Los tres pilares de confianza describen mecanismos que el producto YA
 * implementa (verificación de RUT por un moderador, campos obligatorios y
 * mínimo de 3 fotos, agrupación comparativa en la búsqueda), no promesas
 * de marketing: un trust signal que no se cumple es peor que no tenerlo.
 */
function SeccionConfianza() {
  const pilares = [
    {
      icono: <IconoEscudo />,
      titulo: "Verificamos a cada vendedor",
      texto:
        "Cada vendedor -persona o concesionario- entrega su RUT y un documento de respaldo, y un moderador lo revisa antes de dejarlo publicar.",
    },
    {
      icono: <IconoFoto />,
      titulo: "Anuncios completos",
      texto:
        "Marca, modelo, año, kilometraje, estado del vehículo, papeles al día y un mínimo de 3 fotos reales: no se publica un auto a medias.",
    },
    {
      icono: <IconoComparar />,
      titulo: "Comparar es el buscador",
      texto:
        "Los resultados se agrupan solos por marca, modelo y rango de año, así ves lado a lado precio y kilometraje de autos equivalentes.",
    },
  ];

  return (
    <section className="border-b border-border bg-surface-muted">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6 sm:py-16">
        <div className="flex max-w-2xl flex-col gap-2">
          <h2 className="text-heading-2 text-foreground sm:text-heading-1">
            Comprar y vender con confianza
          </h2>
          <p className="text-body-sm text-foreground-muted sm:text-body">
            El mayor riesgo de un auto usado no es el auto: es no saber con
            quién estás tratando.
          </p>
        </div>

        <ul className="grid gap-4 md:grid-cols-3">
          {pilares.map((pilar) => (
            <li
              key={pilar.titulo}
              className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5 shadow-card"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-control bg-primary-soft text-primary">
                {pilar.icono}
              </span>
              <h3 className="text-heading-3 text-foreground">{pilar.titulo}</h3>
              <p className="text-body-sm text-foreground-muted">{pilar.texto}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ========================================================================
 * CTA para vendedores
 * ===================================================================== */

function SeccionVender() {
  return (
    <section className="bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-6 rounded-card bg-primary px-6 py-10 sm:px-10 md:flex-row md:items-center md:justify-between">
          <div className="flex max-w-xl flex-col gap-2">
            <h2 className="text-heading-2 text-primary-foreground">
              ¿Tienes un auto para vender?
            </h2>
            <p className="text-body-sm text-primary-foreground/90">
              Crea tu cuenta, verifica tu RUT y publica tu anuncio con fotos.
              Los compradores te contactan directo.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row md:w-auto">
            <Link
              href="/registro"
              className="flex h-12 items-center justify-center rounded-control bg-primary-foreground px-6 text-body-sm font-semibold text-primary transition-opacity hover:opacity-90"
            >
              Publicar mi auto
            </Link>
            <Link
              href="/login"
              className="flex h-12 items-center justify-center rounded-control border border-primary-foreground/50 px-6 text-body-sm font-medium text-primary-foreground transition-colors hover:bg-primary-foreground/10"
            >
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ========================================================================
 * Iconos (SVG inline: no agregan dependencias ni requests)
 * ===================================================================== */

function IconoEscudo() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconoFoto() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5A1.5 1.5 0 014.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-9z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

function IconoComparar() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 20V10" />
      <path d="M12 20V4" />
      <path d="M18 20v-7" />
      <path d="M3 20h18" />
    </svg>
  );
}
