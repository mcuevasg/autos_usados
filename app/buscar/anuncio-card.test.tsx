// @vitest-environment jsdom
//
// Test de componente (QA, T-25) para la card visual de un anuncio en los
// resultados de `/buscar` (`app/buscar/anuncio-card.tsx`). Mismo patrón que
// `app/components/landing-datos.test.tsx`: se renderiza el componente
// directamente con props ya resueltas, sin montar la página completa ni
// tocar Supabase.
//
// Cubre el criterio de aceptación de T-25: precio destacado, badge de
// "Destacado" condicionado a `esDestacadoVigente` (T-18: solo si
// `featured_active` Y `featured_expires_at` en el futuro), specs (año,
// kilometraje, estado, papeles al día) y vendedor/ubicación.

import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AnuncioCard, type AnuncioCardData } from "./anuncio-card";

afterEach(() => {
  cleanup();
});

const ANUNCIO_BASE: AnuncioCardData = {
  id: "anuncio-1",
  year: 2020,
  mileage: 45000,
  price: 9500000,
  location: "Santiago",
  vehicle_condition: "usado en buen estado",
  papers_up_to_date: true,
  featured_active: false,
  featured_expires_at: null,
};

describe("AnuncioCard", () => {
  it("muestra precio formateado en CLP, specs y vendedor/ubicación", () => {
    render(
      <AnuncioCard
        anuncio={ANUNCIO_BASE}
        fotoUrl={null}
        tipoVendedorLabel="Persona natural"
      />
    );

    expect(screen.getByText("$9.500.000")).toBeInTheDocument();
    expect(screen.getByText("2020")).toBeInTheDocument();
    expect(screen.getByText("45.000 km")).toBeInTheDocument();
    expect(screen.getByText("usado en buen estado")).toBeInTheDocument();
    expect(screen.getByText("Papeles al día")).toBeInTheDocument();
    expect(screen.getByText("Persona natural")).toBeInTheDocument();
    expect(screen.getByText("Santiago")).toBeInTheDocument();

    // Sin foto: cae al placeholder de FotoMiniatura.
    expect(screen.getByText("Sin foto")).toBeInTheDocument();
  });

  it("sin plan destacado vigente, no muestra el badge 'Destacado'", () => {
    render(
      <AnuncioCard
        anuncio={ANUNCIO_BASE}
        fotoUrl={null}
        tipoVendedorLabel="Persona natural"
      />
    );

    expect(screen.queryByText(/Destacado/)).toBeNull();
  });

  it("con plan destacado vigente (featured_active + fecha futura), muestra el badge '⭐ Destacado'", () => {
    const anuncioDestacado: AnuncioCardData = {
      ...ANUNCIO_BASE,
      featured_active: true,
      featured_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };

    render(
      <AnuncioCard
        anuncio={anuncioDestacado}
        fotoUrl={null}
        tipoVendedorLabel="Concesionario"
      />
    );

    expect(screen.getByText("⭐ Destacado")).toBeInTheDocument();
  });

  it("con featured_active=true pero featured_expires_at VENCIDO, NO muestra el badge (T-18: nunca confiar en featured_active crudo)", () => {
    const anuncioVencido: AnuncioCardData = {
      ...ANUNCIO_BASE,
      featured_active: true,
      featured_expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    };

    render(
      <AnuncioCard
        anuncio={anuncioVencido}
        fotoUrl={null}
        tipoVendedorLabel="Concesionario"
      />
    );

    expect(screen.queryByText(/Destacado/)).toBeNull();
  });

  it("papers_up_to_date=false muestra 'Papeles pendientes' en vez de 'Papeles al día'", () => {
    render(
      <AnuncioCard
        anuncio={{ ...ANUNCIO_BASE, papers_up_to_date: false }}
        fotoUrl={null}
        tipoVendedorLabel="Persona natural"
      />
    );

    expect(screen.getByText("Papeles pendientes")).toBeInTheDocument();
    expect(screen.queryByText("Papeles al día")).toBeNull();
  });

  it("con fotoUrl, renderiza la imagen en vez del placeholder", () => {
    render(
      <AnuncioCard
        anuncio={ANUNCIO_BASE}
        fotoUrl="https://example.com/foto.png"
        tipoVendedorLabel="Persona natural"
      />
    );

    const img = screen.getByAltText("Foto del anuncio");
    expect(img).toHaveAttribute("src", "https://example.com/foto.png");
    expect(screen.queryByText("Sin foto")).toBeNull();
  });
});
