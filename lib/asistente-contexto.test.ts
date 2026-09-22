// Test (QA, T-29) de `lib/asistente-contexto.ts`: la construcción del
// contexto real de `listings` publicados que fundamenta al Asistente de
// Compra con IA, clave para cumplir el criterio de aceptación "no debe
// inventar autos que no existen en el catálogo" sin mandar el catálogo
// completo en cada request.

import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` (ver `lib/asistente-contexto.ts`) resuelve su condición
// "react-server" solo dentro del bundler de Next.js; en Vitest siempre cae
// al `index.js` que lanza un error a propósito. Se mockea igual que
// `@/lib/supabase/server` para poder ejercitar la lógica real del módulo.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  construirFiltroOrIlike,
  construirMensajeSistema,
  detectarFiltrosBuscar,
  extraerPalabrasClave,
  extraerRangoPrecio,
  formatearAnunciosParaPrompt,
  inferirFiltrosCatalogo,
  obtenerAnunciosContexto,
  type AnuncioContexto,
} from "./asistente-contexto";

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

const ANUNCIO_TOYOTA: AnuncioContexto = {
  id: "11111111-1111-1111-1111-111111111111",
  brand: "Toyota",
  model: "Yaris",
  year: 2020,
  price: 8_500_000,
  mileage: 45_000,
  location: "Santiago",
};

const ANUNCIO_KIA: AnuncioContexto = {
  id: "22222222-2222-2222-2222-222222222222",
  brand: "Kia",
  model: "Sportage",
  year: 2019,
  price: 9_200_000,
  mileage: 60_000,
  location: "Concepción",
};

/**
 * Arma un cliente Supabase falso que replica la forma del builder real:
 * `.from().select().eq()` siempre devuelve un objeto con `.or()`, `.gte()`,
 * `.lte()` Y `.order()` disponibles (como el builder real, que no se
 * "compromete" con un método hasta que se invoca), para poder ejercitar
 * tanto el camino con palabras clave (`.or().order().limit()`) como el de
 * la muestra reciente sin filtro (`.order().limit()` directo), en ambos
 * casos con o sin el filtro de precio (`.gte()`/`.lte()`) encadenado antes
 * de `.order()`.
 *
 * `.gte()`/`.lte()` devuelven el MISMO objeto builder (igual que el real,
 * que va devolviendo `this`), así que da lo mismo si se llaman 0, 1 o las
 * 2 veces antes de `.order()`.
 */
function crearSupabaseMock() {
  const limitConFiltro = vi.fn();
  const orderConFiltro = vi.fn().mockReturnValue({ limit: limitConFiltro });
  const gteConFiltro = vi.fn();
  const lteConFiltro = vi.fn();
  const builderConFiltro = {
    order: orderConFiltro,
    gte: gteConFiltro,
    lte: lteConFiltro,
  };
  gteConFiltro.mockReturnValue(builderConFiltro);
  lteConFiltro.mockReturnValue(builderConFiltro);
  const orMock = vi.fn().mockReturnValue(builderConFiltro);

  const limitSinFiltro = vi.fn();
  const orderSinFiltro = vi.fn().mockReturnValue({ limit: limitSinFiltro });
  const gteSinFiltro = vi.fn();
  const lteSinFiltro = vi.fn();
  const builderSinFiltro = {
    or: orMock,
    order: orderSinFiltro,
    gte: gteSinFiltro,
    lte: lteSinFiltro,
  };
  gteSinFiltro.mockReturnValue(builderSinFiltro);
  lteSinFiltro.mockReturnValue(builderSinFiltro);

  const eqMock = vi.fn().mockReturnValue(builderSinFiltro);
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  const fromMock = vi.fn().mockReturnValue({ select: selectMock });

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    from: fromMock,
  } as unknown as SupabaseServerClient);

  return {
    fromMock,
    selectMock,
    eqMock,
    orMock,
    orderConFiltro,
    limitConFiltro,
    gteConFiltro,
    lteConFiltro,
    orderSinFiltro,
    limitSinFiltro,
    gteSinFiltro,
    lteSinFiltro,
  };
}

describe("extraerPalabrasClave", () => {
  it("extrae palabras significativas en minúsculas y sin tildes", () => {
    expect(
      extraerPalabrasClave("Busco una Camioneta Toyota en Concepción")
    ).toEqual(["camioneta", "toyota", "concepcion"]);
  });

  it("ignora palabras comunes de compra que no sirven como filtro", () => {
    expect(
      extraerPalabrasClave(
        "Hola, busco un auto familiar por 8 millones de presupuesto"
      )
    ).toEqual([]);
  });

  it("ignora palabras de menos de 3 caracteres", () => {
    expect(extraerPalabrasClave("un ok si va la Kia")).toEqual(["kia"]);
  });

  it("no repite palabras duplicadas", () => {
    expect(extraerPalabrasClave("Toyota Toyota toyota")).toEqual(["toyota"]);
  });

  it("respeta el máximo de palabras clave indicado", () => {
    const resultado = extraerPalabrasClave(
      "Toyota Kia Nissan Mazda Suzuki Ford Hyundai",
      3
    );
    expect(resultado).toHaveLength(3);
  });
});

describe("extraerRangoPrecio", () => {
  it("extrae un rango con 'entre X y Y millones'", () => {
    expect(extraerRangoPrecio("autos entre 5 y 10 millones de pesos")).toEqual(
      { priceMin: 5_000_000, priceMax: 10_000_000 }
    );
  });

  it("ordena el rango aunque el usuario diga el mayor primero", () => {
    expect(extraerRangoPrecio("entre 10 y 5 millones")).toEqual({
      priceMin: 5_000_000,
      priceMax: 10_000_000,
    });
  });

  it("acepta decimales con punto o coma", () => {
    expect(extraerRangoPrecio("entre 5.5 y 8,5 millones")).toEqual({
      priceMin: 5_500_000,
      priceMax: 8_500_000,
    });
  });

  it("extrae solo un máximo con 'bajo X millones' / 'menos de X millones'", () => {
    expect(extraerRangoPrecio("busco algo bajo 8 millones")).toEqual({
      priceMax: 8_000_000,
    });
    expect(extraerRangoPrecio("menos de 6 millones porfa")).toEqual({
      priceMax: 6_000_000,
    });
  });

  it("extrae solo un mínimo con 'desde X millones' / 'más de X millones'", () => {
    expect(extraerRangoPrecio("algo desde 3 millones")).toEqual({
      priceMin: 3_000_000,
    });
    expect(extraerRangoPrecio("más de 4 millones")).toEqual({
      priceMin: 4_000_000,
    });
  });

  it("sin mención de precio en millones, devuelve un objeto vacío", () => {
    expect(extraerRangoPrecio("busco un Toyota Yaris en Santiago")).toEqual(
      {}
    );
  });
});

describe("inferirFiltrosCatalogo", () => {
  const anuncios = [ANUNCIO_TOYOTA, ANUNCIO_KIA];

  it("clasifica una palabra que coincide con una marca real", () => {
    expect(inferirFiltrosCatalogo(["toyota"], anuncios)).toEqual({
      brand: "Toyota",
    });
  });

  it("clasifica una palabra que coincide con un modelo real", () => {
    expect(inferirFiltrosCatalogo(["sportage"], anuncios)).toEqual({
      model: "Sportage",
    });
  });

  it("clasifica una palabra que coincide con una ubicación real", () => {
    expect(inferirFiltrosCatalogo(["concepcion"], anuncios)).toEqual({
      location: "Concepción",
    });
  });

  it("clasifica varias palabras a la vez, cada una a su campo correcto", () => {
    expect(
      inferirFiltrosCatalogo(["toyota", "yaris", "santiago"], anuncios)
    ).toEqual({
      brand: "Toyota",
      model: "Yaris",
      location: "Santiago",
    });
  });

  it("ignora palabras que no coinciden con ningún campo real (nunca adivina)", () => {
    expect(inferirFiltrosCatalogo(["camioneta"], anuncios)).toEqual({});
  });

  it("sin anuncios de contexto, no clasifica nada", () => {
    expect(inferirFiltrosCatalogo(["toyota"], [])).toEqual({});
  });

  it("no reasigna un campo ya clasificado por una palabra anterior", () => {
    // "toyota" ya fija `brand`; "kia" (otra marca real) no debería
    // pisarlo.
    expect(inferirFiltrosCatalogo(["toyota", "kia"], anuncios)).toEqual({
      brand: "Toyota",
    });
  });
});

describe("detectarFiltrosBuscar", () => {
  it("combina el rango de precio y los filtros de catálogo detectados", () => {
    expect(
      detectarFiltrosBuscar("Toyota Yaris en Santiago, entre 5 y 10 millones", [
        ANUNCIO_TOYOTA,
      ])
    ).toEqual({
      brand: "Toyota",
      model: "Yaris",
      location: "Santiago",
      priceMin: 5_000_000,
      priceMax: 10_000_000,
    });
  });

  it("sin nada detectable en el mensaje, devuelve un objeto vacío", () => {
    expect(detectarFiltrosBuscar("hola, ¿cómo estás?", [ANUNCIO_TOYOTA])).toEqual(
      {}
    );
  });
});

describe("construirFiltroOrIlike", () => {
  it("arma una cláusula or.ilike sobre brand/model/location por cada palabra clave", () => {
    expect(construirFiltroOrIlike(["toyota", "santiago"])).toBe(
      "brand.ilike.%toyota%,model.ilike.%toyota%,location.ilike.%toyota%," +
        "brand.ilike.%santiago%,model.ilike.%santiago%,location.ilike.%santiago%"
    );
  });

  it("con una lista vacía, devuelve un string vacío", () => {
    expect(construirFiltroOrIlike([])).toBe("");
  });
});

describe("formatearAnunciosParaPrompt", () => {
  it("con lista vacía, indica que no hay anuncios disponibles", () => {
    expect(formatearAnunciosParaPrompt([])).toBe(
      "No hay anuncios publicados disponibles en este momento."
    );
  });

  it("serializa cada anuncio en una línea compacta con su id", () => {
    const resultado = formatearAnunciosParaPrompt([ANUNCIO_TOYOTA]);

    expect(resultado).toContain(ANUNCIO_TOYOTA.id);
    expect(resultado).toContain("Toyota Yaris 2020");
    expect(resultado).toContain("Santiago");
    expect(resultado).toContain("45.000 km");
  });
});

describe("construirMensajeSistema", () => {
  it("incluye las reglas anti-alucinación y la lista de anuncios reales", () => {
    const mensaje = construirMensajeSistema([ANUNCIO_TOYOTA]);

    expect(mensaje).toMatch(/SOLO puedes/);
    expect(mensaje).toContain(ANUNCIO_TOYOTA.id);
  });

  it("cuando no hay anuncios, igual instruye a no inventar autos", () => {
    const mensaje = construirMensajeSistema([]);

    expect(mensaje).toMatch(/SOLO puedes/);
    expect(mensaje).toContain(
      "No hay anuncios publicados disponibles en este momento."
    );
  });
});

describe("obtenerAnunciosContexto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("con palabras clave y resultados, filtra con .or() y no consulta la muestra sin filtro", async () => {
    const mock = crearSupabaseMock();
    mock.limitConFiltro.mockResolvedValue({
      data: [ANUNCIO_TOYOTA],
      error: null,
    });

    const resultado = await obtenerAnunciosContexto(
      "busco un Toyota Yaris en Santiago"
    );

    expect(resultado).toEqual([ANUNCIO_TOYOTA]);
    expect(mock.orMock).toHaveBeenCalledWith(
      expect.stringContaining("brand.ilike.%toyota%")
    );
    expect(mock.orderSinFiltro).not.toHaveBeenCalled();
  });

  it("con palabras clave pero sin resultados, cae a la muestra reciente sin filtro", async () => {
    const mock = crearSupabaseMock();
    mock.limitConFiltro.mockResolvedValue({ data: [], error: null });
    mock.limitSinFiltro.mockResolvedValue({
      data: [ANUNCIO_KIA],
      error: null,
    });

    const resultado = await obtenerAnunciosContexto(
      "busco un Toyota Yaris en Santiago"
    );

    expect(resultado).toEqual([ANUNCIO_KIA]);
    expect(mock.orMock).toHaveBeenCalled();
    expect(mock.orderSinFiltro).toHaveBeenCalled();
  });

  it("sin palabras clave utilizables, consulta directo la muestra reciente (nunca llama a .or)", async () => {
    const mock = crearSupabaseMock();
    mock.limitSinFiltro.mockResolvedValue({
      data: [ANUNCIO_TOYOTA, ANUNCIO_KIA],
      error: null,
    });

    const resultado = await obtenerAnunciosContexto("hola, ¿cómo estás?");

    expect(resultado).toEqual([ANUNCIO_TOYOTA, ANUNCIO_KIA]);
    expect(mock.orMock).not.toHaveBeenCalled();
    expect(mock.orderSinFiltro).toHaveBeenCalled();
  });

  it("ante un error de la consulta, no lanza y devuelve un arreglo vacío", async () => {
    const mock = crearSupabaseMock();
    mock.limitSinFiltro.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });

    await expect(
      obtenerAnunciosContexto("hola, ¿cómo estás?")
    ).resolves.toEqual([]);
  });

  it("con un rango de precio detectado y sin palabras clave, aplica .gte()/.lte() antes de .order()", async () => {
    const mock = crearSupabaseMock();
    mock.limitSinFiltro.mockResolvedValue({
      data: [ANUNCIO_TOYOTA],
      error: null,
    });

    const resultado = await obtenerAnunciosContexto(
      "autos entre 5 y 10 millones"
    );

    expect(resultado).toEqual([ANUNCIO_TOYOTA]);
    expect(mock.orMock).not.toHaveBeenCalled();
    expect(mock.gteSinFiltro).toHaveBeenCalledWith("price", 5_000_000);
    expect(mock.lteSinFiltro).toHaveBeenCalledWith("price", 10_000_000);
  });

  it("con palabras clave Y un rango de precio, aplica .gte()/.lte() sobre la rama filtrada por .or()", async () => {
    const mock = crearSupabaseMock();
    mock.limitConFiltro.mockResolvedValue({
      data: [ANUNCIO_TOYOTA],
      error: null,
    });

    const resultado = await obtenerAnunciosContexto(
      "busco un Toyota en Santiago, bajo 8 millones"
    );

    expect(resultado).toEqual([ANUNCIO_TOYOTA]);
    expect(mock.orMock).toHaveBeenCalled();
    expect(mock.gteConFiltro).not.toHaveBeenCalled();
    expect(mock.lteConFiltro).toHaveBeenCalledWith("price", 8_000_000);
  });

  it("sin mención de precio, nunca llama a .gte()/.lte()", async () => {
    const mock = crearSupabaseMock();
    mock.limitSinFiltro.mockResolvedValue({ data: [], error: null });

    await obtenerAnunciosContexto("hola, ¿cómo estás?");

    expect(mock.gteSinFiltro).not.toHaveBeenCalled();
    expect(mock.lteSinFiltro).not.toHaveBeenCalled();
  });
});
