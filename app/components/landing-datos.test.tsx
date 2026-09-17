// @vitest-environment jsdom
//
// Test de componente (QA, T-24) para las piezas de la landing que dependen
// de datos: `Estadisticas` y `GrillaMarcas` (y sus fallbacks), en
// `app/components/landing-datos.tsx`. Mismo patrón que
// `app/components/site-header.test.tsx`: se invocan directamente como
// funciones async (Server Components), pasándoles una promesa ya resuelta,
// sin montar un árbol de `<Suspense>`.

import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ResumenMarketplace } from "@/lib/landing";

// `landing-datos.tsx` importa `@/lib/landing`, que a su vez importa
// `@/lib/supabase/server` (mismo motivo que en
// `app/components/site-header.test.tsx`): sin este mock, ese módulo lanza
// al construirse por faltar las variables de entorno de Supabase, aunque
// estos tests nunca invoquen `obtenerResumenMarketplace` (siempre pasan una
// promesa ya resuelta a mano).
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  Estadisticas,
  EstadisticasFallback,
  GrillaMarcas,
  GrillaMarcasFallback,
} from "./landing-datos";

afterEach(() => {
  cleanup();
});

describe("Estadisticas", () => {
  it("con anuncios publicados, muestra el total, 100% verificados y el total de ciudades", async () => {
    const resumen: ResumenMarketplace = {
      totalAnuncios: 10,
      totalCiudades: 4,
      marcas: [],
    };

    const element = await Estadisticas({
      resumenPromise: Promise.resolve(resumen),
    });
    render(element);

    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("autos publicados")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("vendedores verificados")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("ciudades con anuncios")).toBeInTheDocument();
  });

  it("usa singular cuando hay exactamente 1 anuncio y 1 ciudad", async () => {
    const resumen: ResumenMarketplace = {
      totalAnuncios: 1,
      totalCiudades: 1,
      marcas: [],
    };

    const element = await Estadisticas({
      resumenPromise: Promise.resolve(resumen),
    });
    render(element);

    expect(screen.getByText("auto publicado")).toBeInTheDocument();
    expect(screen.getByText("ciudad con anuncios")).toBeInTheDocument();
  });

  it("formatea números grandes con separador de miles (es-CL)", async () => {
    const resumen: ResumenMarketplace = {
      totalAnuncios: 1234,
      totalCiudades: 12,
      marcas: [],
    };

    const element = await Estadisticas({
      resumenPromise: Promise.resolve(resumen),
    });
    render(element);

    expect(screen.getByText("1.234")).toBeInTheDocument();
  });

  it("sin anuncios publicados, cae a las tres afirmaciones de respaldo (sin ceros)", async () => {
    const resumen: ResumenMarketplace = {
      totalAnuncios: 0,
      totalCiudades: 0,
      marcas: [],
    };

    const element = await Estadisticas({
      resumenPromise: Promise.resolve(resumen),
    });
    render(element);

    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText("RUT")).toBeInTheDocument();
    expect(screen.getByText("3+")).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
  });
});

describe("EstadisticasFallback", () => {
  it("renderiza un skeleton oculto para lectores de pantalla", () => {
    const { container } = render(<EstadisticasFallback />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});

describe("GrillaMarcas", () => {
  it("con marcas reales, renderiza una tarjeta por marca con link a /buscar?brand=<marca>", async () => {
    const resumen: ResumenMarketplace = {
      totalAnuncios: 5,
      totalCiudades: 2,
      marcas: [
        { nombre: "Toyota", totalAnuncios: 3 },
        { nombre: "Kia", totalAnuncios: 2 },
      ],
    };

    const element = await GrillaMarcas({
      resumenPromise: Promise.resolve(resumen),
    });
    render(element);

    const linkToyota = screen.getByRole("link", { name: /Toyota/ });
    expect(linkToyota).toHaveAttribute("href", "/buscar?brand=Toyota");
    expect(screen.getByText("3 autos")).toBeInTheDocument();

    const linkKia = screen.getByRole("link", { name: /Kia/ });
    expect(linkKia).toHaveAttribute("href", "/buscar?brand=Kia");
    expect(screen.getByText("2 autos")).toBeInTheDocument();
  });

  it("usa singular 'auto' cuando la marca tiene exactamente 1 anuncio", async () => {
    const resumen: ResumenMarketplace = {
      totalAnuncios: 1,
      totalCiudades: 1,
      marcas: [{ nombre: "Suzuki", totalAnuncios: 1 }],
    };

    const element = await GrillaMarcas({
      resumenPromise: Promise.resolve(resumen),
    });
    render(element);

    expect(screen.getByText("1 auto")).toBeInTheDocument();
  });

  it("codifica correctamente en la URL nombres de marca con espacios o caracteres especiales", async () => {
    const resumen: ResumenMarketplace = {
      totalAnuncios: 1,
      totalCiudades: 1,
      marcas: [{ nombre: "Alfa Romeo", totalAnuncios: 1 }],
    };

    const element = await GrillaMarcas({
      resumenPromise: Promise.resolve(resumen),
    });
    render(element);

    expect(
      screen.getByRole("link", { name: /Alfa Romeo/ })
    ).toHaveAttribute("href", "/buscar?brand=Alfa%20Romeo");
  });

  it("sin marcas (catálogo vacío o consulta fallida), cae a MARCAS_FALLBACK con 'Ver anuncios'", async () => {
    const resumen: ResumenMarketplace = {
      totalAnuncios: 0,
      totalCiudades: 0,
      marcas: [],
    };

    const element = await GrillaMarcas({
      resumenPromise: Promise.resolve(resumen),
    });
    render(element);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(screen.getByRole("link", { name: /Toyota/ })).toHaveAttribute(
      "href",
      "/buscar?brand=Toyota"
    );
    expect(screen.getAllByText("Ver anuncios").length).toBeGreaterThan(0);
  });
});

describe("GrillaMarcasFallback", () => {
  it("renderiza un skeleton oculto para lectores de pantalla", () => {
    const { container } = render(<GrillaMarcasFallback />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
