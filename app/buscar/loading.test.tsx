// @vitest-environment jsdom
//
// Test de componente (QA, T-27) para el loading UI de `/buscar`
// (`loading.tsx`, convención de Next.js App Router). Mismo criterio que
// `EstadisticasFallback`/`GrillaMarcasFallback`
// (`app/components/landing-datos.test.tsx`, T-24): solo se verifica que
// renderiza un skeleton marcado `aria-hidden="true"` (oculto para lectores
// de pantalla, ya que no comunica información real) sin lanzar.

import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import CargandoBuscar from "./loading";

afterEach(() => {
  cleanup();
});

describe("CargandoBuscar (loading.tsx de /buscar)", () => {
  it("renderiza un skeleton oculto para lectores de pantalla", () => {
    const { container } = render(<CargandoBuscar />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it("incluye al menos un bloque animado (animate-pulse) por cada pieza de la página real", () => {
    const { container } = render(<CargandoBuscar />);

    // Encabezado + formulario de filtros + cards: suficientes bloques
    // pulsantes para cubrir la silueta completa de la página real.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      5
    );
  });
});
