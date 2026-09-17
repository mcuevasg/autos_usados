import Link from "next/link";
import { MARCAS_FALLBACK, type ResumenMarketplace } from "@/lib/landing";

/**
 * Piezas de la landing (T-24) que dependen de datos del servidor: la franja
 * de cifras del hero y la grilla de marcas destacadas.
 *
 * Viven en su propio archivo (y no dentro de `app/page.tsx`) por dos
 * razones: un `page.tsx` solo puede exportar el componente de la ruta y los
 * campos que Next.js reconoce (`metadata`, `generateMetadata`, etc.), y así
 * estos componentes quedan exportados y testeables invocándolos con una
 * promesa ya resuelta, sin tener que montar árboles de `<Suspense>`.
 *
 * Ambos reciben la MISMA promesa (creada una sola vez en `app/page.tsx`) y
 * hacen su propio `await`: una sola consulta a Supabase, dos puntos de
 * streaming independientes. Mismo patrón que la promesa de sesión en
 * `app/components/site-header.tsx`.
 */

const formateadorNumero = new Intl.NumberFormat("es-CL");

/**
 * Cifras reales del marketplace, bajo el buscador del hero.
 *
 * Cuando todavía no hay anuncios publicados (o la consulta falló, ver
 * `obtenerResumenMarketplace`) no se muestran ceros -"0 autos publicados"
 * destruiría justamente la confianza que esta franja busca construir-: se
 * cae a tres afirmaciones verdaderas sobre cómo funciona el producto, que
 * no dependen del volumen del catálogo.
 */
export async function Estadisticas({
  resumenPromise,
}: {
  resumenPromise: Promise<ResumenMarketplace>;
}) {
  const resumen = await resumenPromise;

  const items =
    resumen.totalAnuncios > 0
      ? [
          {
            valor: formateadorNumero.format(resumen.totalAnuncios),
            etiqueta:
              resumen.totalAnuncios === 1
                ? "auto publicado"
                : "autos publicados",
          },
          {
            // No es un porcentaje "de marketing": publicar exige estar en
            // estado "Verificado" (T-08/T-09, RLS de `listings`), así que
            // el 100% de los anuncios visibles viene de un vendedor cuyo
            // RUT y documento ya revisó un moderador.
            valor: "100%",
            etiqueta: "vendedores verificados",
          },
          {
            valor: formateadorNumero.format(resumen.totalCiudades),
            etiqueta:
              resumen.totalCiudades === 1
                ? "ciudad con anuncios"
                : "ciudades con anuncios",
          },
        ]
      : [
          { valor: "RUT", etiqueta: "verificado en cada vendedor" },
          { valor: "3+", etiqueta: "fotos reales por anuncio" },
          { valor: "$0", etiqueta: "por publicar tu auto" },
        ];

  return (
    <dl className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.etiqueta}
          // `flex-col-reverse` mantiene el orden semántico del HTML (término
          // y luego descripción) pero deja la cifra arriba, que es lo que el
          // ojo busca primero.
          className="flex flex-col-reverse items-center gap-0.5 rounded-card border border-border bg-surface px-4 py-3"
        >
          <dt className="text-caption text-foreground-muted">
            {item.etiqueta}
          </dt>
          <dd className="font-display text-heading-2 text-foreground">
            {item.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Skeleton del mismo alto que la franja real, para no provocar CLS. */
export function EstadisticasFallback() {
  return (
    <div
      aria-hidden="true"
      className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[4.75rem] animate-pulse rounded-card border border-border bg-surface-muted"
        />
      ))}
    </div>
  );
}

/**
 * Grilla de marcas destacadas: las marcas con más anuncios publicados, cada
 * una enlazando a `/buscar?brand=<marca>` (la búsqueda ya filtra por marca
 * con `ilike`, así que el prefiltro funciona tal cual).
 */
export async function GrillaMarcas({
  resumenPromise,
}: {
  resumenPromise: Promise<ResumenMarketplace>;
}) {
  const { marcas } = await resumenPromise;

  // Sin datos (catálogo vacío o consulta fallida) la sección no se oculta:
  // se muestran marcas frecuentes sin cifras, para que la portada nunca
  // quede con un bloque vacío. Ver `MARCAS_FALLBACK` en lib/landing.ts.
  const tarjetas =
    marcas.length > 0
      ? marcas.map((marca) => ({
          nombre: marca.nombre,
          detalle: `${formateadorNumero.format(marca.totalAnuncios)} ${
            marca.totalAnuncios === 1 ? "auto" : "autos"
          }`,
        }))
      : MARCAS_FALLBACK.map((nombre) => ({
          nombre,
          detalle: "Ver anuncios",
        }));

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tarjetas.map((tarjeta) => (
        <li key={tarjeta.nombre}>
          <Link
            href={`/buscar?brand=${encodeURIComponent(tarjeta.nombre)}`}
            className="group flex h-full items-center justify-between gap-2 rounded-card border border-border bg-surface px-4 py-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-card-hover"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-display text-heading-3 text-foreground">
                {tarjeta.nombre}
              </span>
              <span className="text-caption text-foreground-subtle">
                {tarjeta.detalle}
              </span>
            </span>
            {/* Micro-interacción con propósito: la flecha avanza al pasar el
             * mouse para señalar que la tarjeta navega a la búsqueda. */}
            <span
              aria-hidden="true"
              className="shrink-0 text-body-sm text-primary transition-transform duration-200 group-hover:translate-x-1"
            >
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Skeleton con la misma grilla y alto de tarjeta, para no provocar CLS. */
export function GrillaMarcasFallback() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="h-[5.25rem] animate-pulse rounded-card border border-border bg-surface-muted"
        />
      ))}
    </div>
  );
}
