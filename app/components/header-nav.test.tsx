// @vitest-environment jsdom
//
// Tests de componente (QA, T-23; actualizado en la corrección de hallazgos
// del reviewer) para `HeaderNav`, el Client Component del botón hamburguesa
// + panel mobile colapsable del header global.
//
// A partir de la corrección, `HeaderNav` ya NO renderiza el logo ni el nav
// de escritorio (eso vive en `app/components/site-header.tsx`, que streamea
// esa parte por separado vía `SessionLinksDesktop`, ver
// `site-header.test.tsx`); `HeaderNav` solo posee el botón hamburguesa y el
// panel mobile, y recibe `estaLogueado: boolean` ya resuelto (no una
// promesa ni el email: ver Hallazgo 2 de la corrección, evita exponer PII
// al cliente).
//
// Cubre el criterio de aceptación de T-23 para la parte mobile:
//   - Sin sesión (estaLogueado=false): "Ingresar" y "Vender / Registrarme"
//     visibles en el panel, "Mi cuenta"/"Cerrar sesión" ausentes.
//   - Con sesión (estaLogueado=true): "Mi cuenta" y "Cerrar sesión"
//     visibles, "Ingresar"/"Vender / Registrarme" ausentes; el botón
//     "Cerrar sesión" está envuelto en un <form> que invoca la Server
//     Action `cerrarSesion` reutilizada de app/cuenta/actions.ts.
//   - El botón hamburguesa solo existe en mobile (md:hidden) y abre/cierra
//     el panel colapsable.
//   - Navegar desde un link del panel lo cierra.
//
// `cerrarSesion` se mockea: es una Server Action ya existente y probada en
// otro lugar (app/cuenta/actions.ts reutiliza el mismo flujo que
// app/cuenta/page.tsx); acá solo interesa verificar que el panel la invoca
// correctamente al enviar el formulario, no su lógica interna (signOut +
// redirect), que depende de infraestructura de Next/Supabase no disponible
// en este entorno de test.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HeaderNav } from "./header-nav";

vi.mock("@/app/cuenta/actions", () => ({
  cerrarSesion: vi.fn(),
}));

import { cerrarSesion } from "@/app/cuenta/actions";

describe("HeaderNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("el botón hamburguesa solo existe en mobile (md:hidden)", () => {
    render(<HeaderNav estaLogueado={false} />);

    const boton = screen.getByRole("button", { name: "Abrir menú" });
    expect(boton.className).toContain("md:hidden");
  });

  it("el panel mobile no está montado hasta abrir el menú", () => {
    render(<HeaderNav estaLogueado={false} />);

    expect(
      screen.queryByRole("navigation", { name: "Principal (mobile)" })
    ).toBeNull();
  });

  it("clic en la hamburguesa abre el panel mobile con el link Buscar", async () => {
    const user = userEvent.setup();
    render(<HeaderNav estaLogueado={false} />);

    const boton = screen.getByRole("button", { name: "Abrir menú" });
    expect(boton).toHaveAttribute("aria-expanded", "false");

    await user.click(boton);

    expect(boton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Cerrar menú" })
    ).toBeInTheDocument();

    const panel = screen.getByRole("navigation", {
      name: "Principal (mobile)",
    });
    expect(within(panel).getByRole("link", { name: "Buscar" })).toHaveAttribute(
      "href",
      "/buscar"
    );
  });

  it("clic de nuevo en la hamburguesa cierra el panel mobile", async () => {
    const user = userEvent.setup();
    render(<HeaderNav estaLogueado={false} />);

    const boton = screen.getByRole("button", { name: "Abrir menú" });
    await user.click(boton);
    expect(
      screen.getByRole("navigation", { name: "Principal (mobile)" })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cerrar menú" }));
    expect(
      screen.queryByRole("navigation", { name: "Principal (mobile)" })
    ).toBeNull();
  });

  it("navegar desde un link del panel mobile lo cierra (onClick cierra el menú)", async () => {
    const user = userEvent.setup();
    render(<HeaderNav estaLogueado={false} />);

    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    const panel = screen.getByRole("navigation", {
      name: "Principal (mobile)",
    });

    await user.click(within(panel).getByRole("link", { name: "Buscar" }));

    expect(
      screen.queryByRole("navigation", { name: "Principal (mobile)" })
    ).toBeNull();
  });

  describe("sin sesión (estaLogueado=false)", () => {
    it('el panel mobile muestra "Ingresar" y "Vender / Registrarme", con los hrefs correctos', async () => {
      const user = userEvent.setup();
      render(<HeaderNav estaLogueado={false} />);

      await user.click(screen.getByRole("button", { name: "Abrir menú" }));
      const panel = screen.getByRole("navigation", {
        name: "Principal (mobile)",
      });

      expect(
        within(panel).getByRole("link", { name: "Ingresar" })
      ).toHaveAttribute("href", "/login");
      expect(
        within(panel).getByRole("link", { name: "Vender / Registrarme" })
      ).toHaveAttribute("href", "/registro");
    });

    it('NO muestra "Mi cuenta" ni "Cerrar sesión"', async () => {
      const user = userEvent.setup();
      render(<HeaderNav estaLogueado={false} />);

      await user.click(screen.getByRole("button", { name: "Abrir menú" }));

      expect(screen.queryByRole("link", { name: "Mi cuenta" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Cerrar sesión" })
      ).toBeNull();
    });
  });

  describe("con sesión (estaLogueado=true)", () => {
    it('el panel mobile muestra "Mi cuenta" (→ /cuenta) y el botón "Cerrar sesión"', async () => {
      const user = userEvent.setup();
      render(<HeaderNav estaLogueado={true} />);

      await user.click(screen.getByRole("button", { name: "Abrir menú" }));
      const panel = screen.getByRole("navigation", {
        name: "Principal (mobile)",
      });

      expect(
        within(panel).getByRole("link", { name: "Mi cuenta" })
      ).toHaveAttribute("href", "/cuenta");
      expect(
        within(panel).getByRole("button", { name: "Cerrar sesión" })
      ).toBeInTheDocument();
    });

    it('NO muestra "Ingresar" ni "Vender / Registrarme"', async () => {
      const user = userEvent.setup();
      render(<HeaderNav estaLogueado={true} />);

      await user.click(screen.getByRole("button", { name: "Abrir menú" }));

      expect(screen.queryByRole("link", { name: "Ingresar" })).toBeNull();
      expect(
        screen.queryByRole("link", { name: "Vender / Registrarme" })
      ).toBeNull();
    });

    it('enviar el formulario de "Cerrar sesión" invoca la Server Action cerrarSesion', async () => {
      const user = userEvent.setup();
      render(<HeaderNav estaLogueado={true} />);

      await user.click(screen.getByRole("button", { name: "Abrir menú" }));
      const panel = screen.getByRole("navigation", {
        name: "Principal (mobile)",
      });

      await user.click(
        within(panel).getByRole("button", { name: "Cerrar sesión" })
      );

      expect(cerrarSesion).toHaveBeenCalledTimes(1);
    });
  });
});
