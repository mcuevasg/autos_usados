import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Datos agregados del marketplace que alimentan la landing (T-24): los
 * trust signals del hero ("N autos publicados", "N vendedores...") y las
 * marcas destacadas.
 *
 * Están acá y no dentro de `app/page.tsx` por dos motivos: la lógica de
 * agregación (`resumirAnunciosPublicados`) queda como función pura y
 * testeable sin renderizar la página, y `page.tsx` no debería exportar
 * nada que no sea el componente de la ruta y su metadata.
 */

export type MarcaDestacada = {
  /** Nombre tal como lo escribió el vendedor (se usa en `/buscar?brand=`). */
  nombre: string;
  totalAnuncios: number;
};

export type ResumenMarketplace = {
  totalAnuncios: number;
  /** Ubicaciones DISTINTAS (comuna/ciudad) con al menos un anuncio. */
  totalCiudades: number;
  /** Marcas con más anuncios publicados, de mayor a menor. */
  marcas: MarcaDestacada[];
};

/**
 * Cuántas marcas se muestran en la grilla "Explora por marca". 8 entra
 * en 2 columnas (mobile) y en 4 (desktop) sin dejar huecos.
 */
export const MAXIMO_MARCAS_DESTACADAS = 8;

/**
 * Marcas de respaldo para la grilla cuando todavía no hay anuncios
 * publicados (base recién creada) o la consulta falla: la landing nunca
 * debe quedar con un hueco vacío en su sección principal de navegación.
 * Son marcas comunes del mercado chileno y, al enlazar a `/buscar?brand=`,
 * llevan igual a una búsqueda válida (que puede no traer resultados).
 */
export const MARCAS_FALLBACK = [
  "Toyota",
  "Chevrolet",
  "Hyundai",
  "Nissan",
  "Kia",
  "Mazda",
  "Suzuki",
  "Ford",
] as const;

type FilaAnuncioPublico = {
  brand: string | null;
  location: string | null;
};

/**
 * Agrega en memoria las filas de anuncios publicados.
 *
 * Marcas y ubicaciones se agrupan de forma INSENSIBLE a mayúsculas y
 * espacios (`trim().toLowerCase()`), porque son texto libre escrito por
 * cada vendedor: "toyota", "Toyota " y "TOYOTA" son la misma marca y
 * deben sumar en la misma tarjeta. Como etiqueta visible se conserva la
 * primera forma vista (ya trimmeada), no la clave normalizada, para no
 * mostrar marcas en minúscula. Es el mismo criterio de normalización que
 * usa `agruparPorSimilitud` en `app/buscar/page.tsx`.
 */
export function resumirAnunciosPublicados(
  filas: FilaAnuncioPublico[],
  maximoMarcas: number = MAXIMO_MARCAS_DESTACADAS
): ResumenMarketplace {
  const marcasPorClave = new Map<string, MarcaDestacada>();
  const ciudades = new Set<string>();

  for (const fila of filas) {
    const marca = fila.brand?.trim() ?? "";
    if (marca) {
      const clave = marca.toLowerCase();
      const existente = marcasPorClave.get(clave);
      if (existente) {
        existente.totalAnuncios += 1;
      } else {
        marcasPorClave.set(clave, { nombre: marca, totalAnuncios: 1 });
      }
    }

    const ubicacion = fila.location?.trim() ?? "";
    if (ubicacion) {
      ciudades.add(ubicacion.toLowerCase());
    }
  }

  const marcas = Array.from(marcasPorClave.values())
    .sort((a, b) => {
      // Más anuncios primero; a igual cantidad, orden alfabético para que
      // la grilla sea estable entre renders (y no "baile" al recargar).
      const porCantidad = b.totalAnuncios - a.totalAnuncios;
      if (porCantidad !== 0) return porCantidad;
      return a.nombre.localeCompare(b.nombre, "es");
    })
    .slice(0, maximoMarcas);

  return {
    totalAnuncios: filas.length,
    totalCiudades: ciudades.size,
    marcas,
  };
}

/**
 * Consulta los anuncios publicados y devuelve el resumen para la landing.
 *
 * Usa el cliente Supabase normal (no el admin): la policy
 * `listings_select_published` (0002_rls_policies.sql) ya permite a
 * cualquiera -anon o authenticated- leer anuncios en estado "publicado",
 * igual que en `app/buscar/page.tsx`.
 *
 * Se traen las filas y se cuentan en memoria en vez de pedir varios
 * `count` distintos al servidor porque las cifras (anuncios, ciudades) y
 * las marcas destacadas salen de la MISMA consulta: un solo viaje a la
 * base para toda la landing. Solo se piden las dos columnas necesarias,
 * así que el costo por fila es mínimo. Si el catálogo creciera a miles de
 * anuncios, lo correcto sería mover esta agregación a una vista/RPC en
 * Postgres (`group by brand`) en vez de traer una fila por anuncio.
 *
 * Ante un error de la consulta NO se lanza: la landing debe renderizar
 * igual (es la portada del sitio), así que se devuelve el resumen vacío
 * y la UI cae a su contenido de respaldo (`MARCAS_FALLBACK` y trust
 * signals sin cifras).
 */
export async function obtenerResumenMarketplace(): Promise<ResumenMarketplace> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("listings")
    .select("brand, location")
    .eq("status", "publicado");

  if (error || !data) {
    return resumirAnunciosPublicados([]);
  }

  return resumirAnunciosPublicados(data as FilaAnuncioPublico[]);
}
