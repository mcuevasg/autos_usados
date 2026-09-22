import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Contexto real de anuncios publicados para el Asistente de Compra con IA
 * (T-29), consumido por `app/api/asistente/chat/route.ts`.
 *
 * El objetivo de este módulo es evitar las dos formas de fallar al armar el
 * prompt del LLM: (a) mandar el catálogo COMPLETO de anuncios publicados en
 * cada request (gasta tokens/costo y no escala), y (b) mandar CERO contexto
 * real (lo que produce alucinaciones: el modelo inventaría autos que no
 * existen en la base). La estrategia, deliberadamente simple para este MVP
 * (no es NLU, es heurística de palabras clave):
 *
 * 1. Se extraen palabras clave "significativas" del último mensaje del
 *    comprador (`extraerPalabrasClave`): tokens de 3+ caracteres, sin tildes,
 *    excluyendo una lista corta de palabras muy comunes en español que no
 *    aportan como filtro (artículos, "busco", "auto", "presupuesto", etc.).
 * 2. Si hay palabras clave, se consulta `listings` publicados con un OR de
 *    `ilike` sobre `brand`/`model`/`location` (mismo patrón de filtro que
 *    `app/buscar/page.tsx`, pero unificado en un solo `.or(...)`), acotado a
 *    `LIMITE_ANUNCIOS_CONTEXTO` filas.
 * 3. Si esa consulta no trae resultados (o no había palabras clave
 *    utilizables), se cae a una muestra acotada de los anuncios publicados
 *    más recientes, con el mismo límite: así el asistente siempre tiene
 *    autos reales sobre los que hablar, aunque no haya podido extraer un
 *    filtro claro del mensaje del usuario.
 */

export type AnuncioContexto = {
  id: string;
  brand: string;
  model: string;
  year: number;
  price: number;
  mileage: number;
  location: string;
};

/** Cuántos anuncios, como máximo, se incluyen en el prompt del LLM. */
export const LIMITE_ANUNCIOS_CONTEXTO = 25;

/**
 * Palabras en español muy comunes en un mensaje de compra ("busco un auto
 * familiar por 8 millones en Santiago") que NO sirven como filtro de
 * marca/modelo/ubicación. Lista corta y pragmática, no exhaustiva: el
 * objetivo es reducir falsos positivos obvios, no lograr NLU perfecto.
 */
const PALABRAS_IGNORADAS = new Set([
  "busco", "buscando", "quiero", "necesito", "hola", "auto", "autos",
  "carro", "carros", "vehiculo", "vehiculos", "para", "por", "con", "que",
  "una", "uno", "unos", "unas", "los", "las", "del", "algo", "tienen",
  "tiene", "hay", "algun", "alguna", "presupuesto", "millones", "millon",
  "mil", "precio", "precios", "bajo", "menos", "hasta", "cerca", "sobre",
  "familiar", "usado", "usados", "gracias", "porfa", "favor",
  "como", "estas", "esta", "este", "eso", "esto", "eres", "andas", "tal",
  // Conectores de rangos de precio ("entre 5 y 10 millones", "desde 3
  // millones", "máximo/mínimo 8 millones"): ver `extraerRangoPrecio`, que
  // reconoce estas mismas frases. No sirven como filtro de marca/modelo/
  // ubicación, así que no deben terminar en `construirFiltroOrIlike`.
  "entre", "desde", "mas", "maximo", "minimo",
]);

/**
 * Minúsculas y sin tildes ("Concepción" -> "concepcion"). Se usa tanto para
 * extraer palabras clave del mensaje del comprador como, en
 * `inferirFiltrosCatalogo`, para comparar esas palabras (ya sin tildes)
 * contra los valores reales de `brand`/`model`/`location` (que SÍ pueden
 * traer tildes, al ser texto libre escrito por cada vendedor) -sin
 * normalizar ambos lados, "concepcion" nunca haría match con "Concepción".
 */
function sinTildes(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Extrae hasta `maxPalabras` palabras clave únicas del texto (minúsculas,
 * sin tildes, sin puntuación), descartando las de `PALABRAS_IGNORADAS` y
 * las de menos de 3 caracteres.
 */
export function extraerPalabrasClave(
  mensaje: string,
  maxPalabras = 5
): string[] {
  const tokens = sinTildes(mensaje).match(/[a-z0-9]+/g) ?? [];

  const vistas = new Set<string>();
  const palabrasClave: string[] = [];

  for (const token of tokens) {
    if (token.length < 3) continue;
    if (PALABRAS_IGNORADAS.has(token)) continue;
    if (vistas.has(token)) continue;

    vistas.add(token);
    palabrasClave.push(token);

    if (palabrasClave.length >= maxPalabras) break;
  }

  return palabrasClave;
}

export type RangoPrecio = {
  priceMin?: number;
  priceMax?: number;
};

/** Acepta "5", "5.5" o "5,5" como parte de una cifra en millones de pesos. */
const NUMERO_DECIMAL = "\\d+(?:[.,]\\d+)?";
const UNIDAD_MILLONES = "(?:mill?on(?:es)?)";

function millonesAPesos(numeroTexto: string): number {
  const numero = Number(numeroTexto.replace(",", "."));
  return Math.round(numero * 1_000_000);
}

/**
 * Extrae un rango de precio (en pesos chilenos) del mensaje del comprador,
 * cuando lo expresa en millones -la forma habitual de hablar de precios de
 * autos en Chile ("entre 5 y 10 millones", "bajo 8 millones", "desde 3
 * millones"). Heurística basada en regex, no NLU: cubre los patrones más
 * comunes, no pretende ser exhaustiva.
 *
 * Se usa para dos cosas: (1) acotar también por precio la consulta de
 * `obtenerAnunciosContexto`, para que el asistente no recomiende autos
 * fuera del presupuesto mencionado, y (2) devolver el rango al cliente
 * (`app/api/asistente/chat/route.ts`) para armar un link a `/buscar` con
 * ese filtro ya aplicado, de modo que el comprador pueda seguir explorando
 * esos resultados en la grilla completa en vez de depender solo de lo que
 * el LLM decida mencionar en su respuesta.
 */
export function extraerRangoPrecio(mensaje: string): RangoPrecio {
  const texto = mensaje.toLowerCase();

  const entre = texto.match(
    new RegExp(
      `entre\\s+(${NUMERO_DECIMAL})\\s*(?:y|a)\\s+(${NUMERO_DECIMAL})\\s*${UNIDAD_MILLONES}`
    )
  );
  if (entre) {
    const a = millonesAPesos(entre[1]);
    const b = millonesAPesos(entre[2]);
    return { priceMin: Math.min(a, b), priceMax: Math.max(a, b) };
  }

  const maximo = texto.match(
    new RegExp(
      `(?:menos de|bajo|m[aá]ximo|hasta)\\s+(${NUMERO_DECIMAL})\\s*${UNIDAD_MILLONES}`
    )
  );
  if (maximo) {
    return { priceMax: millonesAPesos(maximo[1]) };
  }

  const minimo = texto.match(
    new RegExp(
      `(?:m[aá]s de|desde|m[ií]nimo|sobre)\\s+(${NUMERO_DECIMAL})\\s*${UNIDAD_MILLONES}`
    )
  );
  if (minimo) {
    return { priceMin: millonesAPesos(minimo[1]) };
  }

  return {};
}

export type FiltrosCatalogoDetectados = {
  brand?: string;
  model?: string;
  location?: string;
};

export type FiltrosBuscarDetectados = FiltrosCatalogoDetectados & RangoPrecio;

/**
 * Clasifica cada palabra clave del mensaje del comprador como marca,
 * modelo o ubicación -o ninguna de las tres-, comparándola contra los
 * valores REALES de `anuncios` (el mismo contexto que ya se consultó para
 * fundamentar la respuesta del LLM, `obtenerAnunciosContexto`). NUNCA
 * asigna un campo sin evidencia en esos anuncios: a diferencia de
 * `construirFiltroOrIlike` (que hace un OR indiscriminado sobre los 3
 * campos para buscar contexto), acá el objetivo es justo lo contrario
 * -decidir CUÁL de los 3 campos corresponde a cada palabra-, porque
 * `/buscar` filtra cada campo por separado (con AND entre ellos): asignar
 * "santiago" a `brand` en vez de a `location`, por ejemplo, devolvería
 * cero resultados aunque sí existan autos en Santiago.
 *
 * Se usa `.includes()` (substring, insensible a mayúsculas) sobre el
 * valor real de cada anuncio, mismo criterio de coincidencia que el
 * `ilike` de `construirFiltroOrIlike`. Si una palabra clave no aparece en
 * ningún `brand`/`model`/`location` de `anuncios`, simplemente no se
 * asigna a ningún campo (mejor omitir un filtro que adivinar uno
 * incorrecto).
 */
export function inferirFiltrosCatalogo(
  palabrasClave: string[],
  anuncios: AnuncioContexto[]
): FiltrosCatalogoDetectados {
  const resultado: FiltrosCatalogoDetectados = {};

  for (const palabra of palabrasClave) {
    if (!resultado.brand) {
      const conMarca = anuncios.find((a) =>
        sinTildes(a.brand).includes(palabra)
      );
      if (conMarca) resultado.brand = conMarca.brand;
    }

    if (!resultado.model) {
      const conModelo = anuncios.find((a) =>
        sinTildes(a.model).includes(palabra)
      );
      if (conModelo) resultado.model = conModelo.model;
    }

    if (!resultado.location) {
      const conUbicacion = anuncios.find((a) =>
        sinTildes(a.location).includes(palabra)
      );
      if (conUbicacion) resultado.location = conUbicacion.location;
    }
  }

  return resultado;
}

/**
 * Combina el rango de precio (`extraerRangoPrecio`) y los filtros de
 * catálogo (`inferirFiltrosCatalogo`) detectados en el último mensaje del
 * comprador, para armar el link a `/buscar` que arma el cliente
 * (`app/asistente/chat.tsx` → `urlBuscarConFiltros`). Se llama DESPUÉS de
 * `obtenerAnunciosContexto` porque `inferirFiltrosCatalogo` necesita esos
 * anuncios reales para clasificar cada palabra clave.
 */
export function detectarFiltrosBuscar(
  ultimoMensaje: string,
  anuncios: AnuncioContexto[]
): FiltrosBuscarDetectados {
  const rango = extraerRangoPrecio(ultimoMensaje);
  const palabrasClave = extraerPalabrasClave(ultimoMensaje);
  const filtrosCatalogo = inferirFiltrosCatalogo(palabrasClave, anuncios);

  return { ...rango, ...filtrosCatalogo };
}

/**
 * Arma la cláusula `.or(...)` de PostgREST (usada por el cliente Supabase)
 * para filtrar `listings` cuyo `brand`, `model` o `location` contengan
 * alguna de las palabras clave (insensible a mayúsculas, `ilike`). Se
 * exporta para poder testearla de forma aislada, sin mockear Supabase.
 */
export function construirFiltroOrIlike(palabrasClave: string[]): string {
  return palabrasClave
    .flatMap((palabra) => [
      `brand.ilike.%${palabra}%`,
      `model.ilike.%${palabra}%`,
      `location.ilike.%${palabra}%`,
    ])
    .join(",");
}

/**
 * Consulta los anuncios publicados que fundamentan la respuesta del
 * asistente para el último mensaje del comprador. Nunca lanza: ante
 * cualquier error de la consulta devuelve un arreglo vacío (el Route
 * Handler decide qué hacer con eso, ver `construirMensajeSistema`), igual
 * criterio "no romper el resto de la página/feature" que
 * `lib/landing.ts`.
 */
export async function obtenerAnunciosContexto(
  ultimoMensaje: string
): Promise<AnuncioContexto[]> {
  const supabase = await createSupabaseServerClient();
  const palabrasClave = extraerPalabrasClave(ultimoMensaje);
  const { priceMin, priceMax } = extraerRangoPrecio(ultimoMensaje);
  const columnas = "id, brand, model, year, price, mileage, location";

  // El rango de precio (si se detectó) se aplica SIEMPRE, en ambas ramas de
  // abajo: si el comprador dio un presupuesto, el asistente no debe
  // recomendar autos fuera de él aunque haya, o no, otras palabras clave.
  if (palabrasClave.length > 0) {
    let query = supabase
      .from("listings")
      .select(columnas)
      .eq("status", "publicado")
      .or(construirFiltroOrIlike(palabrasClave));
    if (priceMin !== undefined) query = query.gte("price", priceMin);
    if (priceMax !== undefined) query = query.lte("price", priceMax);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(LIMITE_ANUNCIOS_CONTEXTO);

    if (!error && data && data.length > 0) {
      return data as unknown as AnuncioContexto[];
    }
  }

  // Sin palabras clave utilizables, o la búsqueda filtrada no trajo
  // resultados: muestra acotada de los anuncios publicados más recientes
  // (respetando igual el rango de precio, si se detectó), para que el
  // asistente igual tenga catálogo real sobre el que hablar.
  let query = supabase.from("listings").select(columnas).eq("status", "publicado");
  if (priceMin !== undefined) query = query.gte("price", priceMin);
  if (priceMax !== undefined) query = query.lte("price", priceMax);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(LIMITE_ANUNCIOS_CONTEXTO);

  if (error || !data) {
    return [];
  }

  return data as unknown as AnuncioContexto[];
}

const formateadorPrecio = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

/**
 * Serializa la lista de anuncios en formato compacto (una línea por
 * anuncio) para incluirla en el mensaje de sistema del LLM. Incluye el
 * `id` de cada anuncio para que, si el modelo recomienda alguno, el cliente
 * pueda enlazarlo a `/anuncio/[id]`.
 */
export function formatearAnunciosParaPrompt(
  anuncios: AnuncioContexto[]
): string {
  if (anuncios.length === 0) {
    return "No hay anuncios publicados disponibles en este momento.";
  }

  return anuncios
    .map(
      (a) =>
        `- id=${a.id} | ${a.brand} ${a.model} ${a.year} | ` +
        `${formateadorPrecio.format(a.price)} | ` +
        `${a.mileage.toLocaleString("es-CL")} km | ${a.location}`
    )
    .join("\n");
}

/**
 * Construye el mensaje de sistema (en español) que instruye al modelo a
 * comportarse como asistente de compra de autos usados y, sobre todo, a NO
 * inventar autos: solo puede recomendar anuncios de la lista real que se le
 * pasa acá. Es la salvaguarda principal contra alucinaciones (ver
 * cabecera del módulo).
 */
export function construirMensajeSistema(anuncios: AnuncioContexto[]): string {
  return (
    "Eres el asistente de compra de \"Autos Usados Chile\", un marketplace " +
    "de autos usados. Ayudas a compradores a precisar qué auto buscan " +
    "(marca, modelo, año, ubicación y presupuesto) y les recomiendas " +
    "anuncios concretos.\n\n" +
    "REGLAS ESTRICTAS (no las rompas bajo ninguna circunstancia):\n" +
    "1. SOLO puedes mencionar o recomendar autos que aparezcan en la lista " +
    "\"ANUNCIOS PUBLICADOS DISPONIBLES\" de abajo. Nunca inventes marcas, " +
    "modelos, años, precios, kilometrajes ni ubicaciones que no estén ahí.\n" +
    "2. Si ningún anuncio de la lista calza con lo que pide el comprador, " +
    "dilo explícitamente (por ejemplo: \"No tengo un anuncio publicado que " +
    "calce con eso ahora mismo\") y sugiere que revise /buscar con otros " +
    "filtros, en vez de inventar un auto para complacer al usuario.\n" +
    "3. Si falta información clave (marca, modelo, año, ubicación o " +
    "presupuesto), haz una o dos preguntas cortas de seguimiento antes de " +
    "recomendar, en vez de adivinar.\n" +
    "4. Cuando recomiendes un anuncio, indica marca, modelo, año, precio y " +
    "ubicación tal como aparecen en la lista.\n" +
    "5. Responde siempre en español de Chile, en tono cercano y breve " +
    "(máximo un par de párrafos cortos o una lista breve).\n\n" +
    "ANUNCIOS PUBLICADOS DISPONIBLES (autos reales, existentes ahora " +
    "mismo en la base de datos):\n" +
    formatearAnunciosParaPrompt(anuncios)
  );
}
