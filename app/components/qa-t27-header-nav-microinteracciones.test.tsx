// @vitest-environment jsdom
//
// QA independiente (T-27) — NO forma parte de la entrega del developer.
// Complementa header-nav.test.tsx (que cubre comportamiento funcional)
// verificando puntualmente las clases de micro-interacción que T-27 dice
// haber agregado: hover del botón hamburguesa y animación motion-safe del
// panel mobile.

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HeaderNav } from "./header-nav";

vi.mock("@/app/cuenta/actions", () => ({
  cerrarSesion: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

describe("QA T-27: micro-interacciones de HeaderNav", () => {
  it("el botón hamburguesa tiene hover:border-primary y hover:bg-surface-muted", () => {
    render(<HeaderNav estaLogueado={false} />);
    const boton = screen.getByRole("button", { name: "Abrir menú" });

    expect(boton.className).toContain("hover:border-primary");
    expect(boton.className).toContain("hover:bg-surface-muted");
    expect(boton.className).toContain("transition-colors");
  });

  it("el panel mobile aplica la animación SOLO bajo motion-safe (respeta prefers-reduced-motion)", async () => {
    const user = userEvent.setup();
    render(<HeaderNav estaLogueado={false} />);

    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    const panel = screen.getByRole("navigation", {
      name: "Principal (mobile)",
    });

    // La animación debe estar condicionada por la variante `motion-safe:`
    // de Tailwind (se compila bajo `@media (prefers-reduced-motion:
    // no-preference)`), nunca aplicada incondicionalmente.
    expect(panel.className).toMatch(/motion-safe:\[animation:menu-mobile-in/);
    expect(panel.className).not.toMatch(/(?<!motion-safe:)\[animation:menu-mobile-in/);
  });
});
