// Test (QA, T-24) de `lib/landing.ts`: la función pura de agregación
// `resumirAnunciosPublicados` y `obtenerResumenMarketplace` (que la envuelve
// consultando Supabase), verificando el criterio de aceptación de T-24
// (cifras reales del marketplace y marcas destacadas, con fallback ante
// catálogo vacío o error de la consulta).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  resumirAnunciosPublicados,
  obtenerResumenMarketplace,
  MAXIMO_MARCAS_DESTACADAS,
  MARCAS_FALLBACK,
} from "./landing";

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

function mockSupabaseListings(
  respuesta:
    | { data: { brand: string | null; location: string | null }[]; error: null }
    | { data: null; error: { message: string } }
) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(respuesta),
      }),
    }),
  } as unknown as SupabaseServerClient);
}

describe("resumirAnunciosPublicados", () => {
  it("con lista vacía, devuelve ceros y sin marcas", () => {
    const resumen = resumirAnunciosPublicados([]);

    expect(resumen).toEqual({
      totalAnuncios: 0,
      totalCiudades: 0,
      marcas: [],
    });
  });

  it("cuenta el total de anuncios como el largo de la lista, incluidas filas sin marca/ubicación", () => {
    const resumen = resumirAnunciosPublicados([
      { brand: null, location: null },
      { brand: "", location: "" },
      { brand: "Toyota", location: "Santiago" },
    ]);

    expect(resumen.totalAnuncios).toBe(3);
  });

  it("agrupa marcas de forma insensible a mayúsculas y espacios, conservando la primera forma vista", () => {
    const resumen = resumirAnunciosPublicados([
      { brand: "toyota", location: "Santiago" },
      { brand: "Toyota ", location: "Santiago" },
      { brand: " TOYOTA", location: "Santiago" },
    ]);

    expect(resumen.marcas).toEqual([
      { nombre: "toyota", totalAnuncios: 3 },
    ]);
  });

  it("agrupa ciudades de forma insensible a mayúsculas y espacios", () => {
    const resumen = resumirAnunciosPublicados([
      { brand: "Toyota", location: "Santiago" },
      { brand: "Kia", location: "santiago " },
      { brand: "Ford", location: " SANTIAGO" },
      { brand: "Mazda", location: "Concepción" },
    ]);

    expect(resumen.totalCiudades).toBe(2);
  });

  it("ordena marcas por total de anuncios descendente y, a igual cantidad, alfabéticamente", () => {
    const resumen = resumirAnunciosPublicados([
      { brand: "Kia", location: null },
      { brand: "Toyota", location: null },
      { brand: "Toyota", location: null },
      { brand: "Ford", location: null },
      { brand: "Alfa Romeo", location: null },
    ]);

    expect(resumen.marcas.map((m) => m.nombre)).toEqual([
      "Toyota",
      "Alfa Romeo",
      "Ford",
      "Kia",
    ]);
  });

  it("limita la cantidad de marcas al máximo indicado", () => {
    const filas = Array.from({ length: 10 }, (_, i) => ({
      brand: `Marca${i}`,
      location: null,
    }));

    const resumen = resumirAnunciosPublicados(filas, 5);

    expect(resumen.marcas).toHaveLength(5);
  });

  it("por defecto, limita a MAXIMO_MARCAS_DESTACADAS marcas", () => {
    const filas = Array.from({ length: MAXIMO_MARCAS_DESTACADAS + 3 }, (_, i) => ({
      brand: `Marca${i}`,
      location: null,
    }));

    const resumen = resumirAnunciosPublicados(filas);

    expect(resumen.marcas).toHaveLength(MAXIMO_MARCAS_DESTACADAS);
  });

  it("ignora marcas/ubicaciones vacías o solo espacios", () => {
    const resumen = resumirAnunciosPublicados([
      { brand: "   ", location: "   " },
      { brand: null, location: null },
    ]);

    expect(resumen.marcas).toEqual([]);
    expect(resumen.totalCiudades).toBe(0);
  });
});

describe("obtenerResumenMarketplace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("con datos reales, agrega correctamente el resumen desde Supabase", async () => {
    mockSupabaseListings({
      data: [
        { brand: "Toyota", location: "Santiago" },
        { brand: "Toyota", location: "Concepción" },
        { brand: "Kia", location: "Santiago" },
      ],
      error: null,
    });

    const resumen = await obtenerResumenMarketplace();

    expect(resumen.totalAnuncios).toBe(3);
    expect(resumen.totalCiudades).toBe(2);
    expect(resumen.marcas[0]).toEqual({ nombre: "Toyota", totalAnuncios: 2 });
  });

  it("ante un error de la consulta, devuelve el resumen vacío (no lanza)", async () => {
    mockSupabaseListings({
      data: null,
      error: { message: "boom" },
    });

    await expect(obtenerResumenMarketplace()).resolves.toEqual({
      totalAnuncios: 0,
      totalCiudades: 0,
      marcas: [],
    });
  });

  it("cuando data es null sin error explícito, igual devuelve el resumen vacío", async () => {
    mockSupabaseListings({
      data: null,
      error: { message: "" },
    } as unknown as { data: null; error: { message: string } });

    await expect(obtenerResumenMarketplace()).resolves.toEqual({
      totalAnuncios: 0,
      totalCiudades: 0,
      marcas: [],
    });
  });
});

describe("MARCAS_FALLBACK", () => {
  it("tiene 8 marcas comunes del mercado chileno, sin duplicados", () => {
    expect(MARCAS_FALLBACK).toHaveLength(8);
    expect(new Set(MARCAS_FALLBACK).size).toBe(MARCAS_FALLBACK.length);
  });
});
