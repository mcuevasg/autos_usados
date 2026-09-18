// @vitest-environment jsdom
//
// Test de componente (QA, T-27) para el loading UI de `/anuncio/[id]`
// (`loading.tsx`, convención de Next.js App Router). Mismo criterio que
// `app/buscar/loading.test.tsx`.

import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import CargandoDetalleAnuncio from "./loading";

afterEach(() => {
  cleanup();
});

describe("CargandoDetalleAnuncio (loading.tsx de /anuncio/[id])", () => {
  it("renderiza un skeleton oculto para lectores de pantalla", () => {
    const { container } = render(<CargandoDetalleAnuncio />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it("incluye bloques animados para la galería y el panel de specs", () => {
    const { container } = render(<CargandoDetalleAnuncio />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      5
    );
  });
});
