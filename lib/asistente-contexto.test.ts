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
  extraerPalabrasClave,
  formatearAnunciosParaPrompt,
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
 * `.from().select().eq()` siempre devuelve un objeto con `.or()` Y
 * `.order()` disponibles (como el builder real, que no se "compromete" con
 * un método hasta que se invoca), para poder ejercitar tanto el camino con
 * palabras clave (`.or().order().limit()`) como el de la muestra reciente
 * sin filtro (`.order().limit()` directo).
 */
function crearSupabaseMock() {
  const limitConFiltro = vi.fn();
  const orderConFiltro = vi.fn().mockReturnValue({ limit: limitConFiltro });
  const orMock = vi.fn().mockReturnValue({ order: orderConFiltro });

  const limitSinFiltro = vi.fn();
  const orderSinFiltro = vi.fn().mockReturnValue({ limit: limitSinFiltro });

  const eqMock = vi.fn().mockReturnValue({
    or: orMock,
    order: orderSinFiltro,
  });
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
    orderSinFiltro,
    limitSinFiltro,
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
});
