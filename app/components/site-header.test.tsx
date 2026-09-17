// @vitest-environment jsdom
//
// Test de componente (QA, T-23; actualizado en la corrección de hallazgos
// del reviewer) para las piezas de `site-header.tsx` que dependen de
// sesión: `obtenerEstaLogueado` (resuelve la sesión vía
// `createSupabaseServerClient().auth.getUser()`, el mismo patrón que
// `app/cuenta/page.tsx`), `SessionLinksDesktop` (nav de escritorio) y
// `MobileMenu` (delega en `HeaderNav`).
//
// `SiteHeader` ahora es un Server Component SIN `await` al tope (para no
// bloquear el static shell del resto del sitio, ver el comentario en
// `site-header.tsx`): la parte async vive en estos subcomponentes,
// envueltos en `<Suspense>`. Por eso el test ya no invoca `SiteHeader()`
// directamente (no hay nada async que inspeccionar ahí) sino estas piezas,
// que sí son funciones async simples e invocables sin renderer.
//
// Mockea `createSupabaseServerClient` igual que antes (y que
// `app/auth/callback/route.test.ts`), para no depender de cookies/Supabase
// real.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/app/cuenta/actions", () => ({
  cerrarSesion: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  obtenerEstaLogueado,
  SessionLinksDesktop,
  MobileMenu,
} from "./site-header";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function mockSupabaseUser(user: { email?: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  } as unknown as SupabaseServerClient);
}

describe("obtenerEstaLogueado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin sesión, resuelve a false", async () => {
    mockSupabaseUser(null);

    await expect(obtenerEstaLogueado()).resolves.toBe(false);
  });

  it("con sesión, resuelve a true", async () => {
    mockSupabaseUser({ email: "usuario@example.com" });

    await expect(obtenerEstaLogueado()).resolves.toBe(true);
  });

  it("el resultado es un booleano (no expone el email ni el objeto user, evita filtrar PII)", async () => {
    mockSupabaseUser({ email: "usuario@example.com" });

    const resultado = await obtenerEstaLogueado();

    expect(typeof resultado).toBe("boolean");
  });
});

describe("SessionLinksDesktop", () => {
  afterEach(() => {
    cleanup();
  });

  it("sin sesión, muestra Ingresar y Vender / Registrarme", async () => {
    const element = await SessionLinksDesktop({
      estaLogueadoPromise: Promise.resolve(false),
    });
    render(element);

    expect(screen.getByRole("link", { name: "Ingresar" })).toHaveAttribute(
      "href",
      "/login"
    );
    expect(
      screen.getByRole("link", { name: "Vender / Registrarme" })
    ).toHaveAttribute("href", "/registro");
    expect(screen.queryByRole("link", { name: "Mi cuenta" })).toBeNull();
  });

  it("con sesión, muestra Mi cuenta y el botón Cerrar sesión", async () => {
    const element = await SessionLinksDesktop({
      estaLogueadoPromise: Promise.resolve(true),
    });
    render(element);

    expect(screen.getByRole("link", { name: "Mi cuenta" })).toHaveAttribute(
      "href",
      "/cuenta"
    );
    expect(
      screen.getByRole("button", { name: "Cerrar sesión" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ingresar" })).toBeNull();
  });
});

describe("MobileMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("renderiza el botón hamburguesa de HeaderNav una vez resuelta la sesión", async () => {
    const element = await MobileMenu({
      estaLogueadoPromise: Promise.resolve(false),
    });
    render(element);

    expect(
      screen.getByRole("button", { name: "Abrir menú" })
    ).toBeInTheDocument();
  });

  it("propaga estaLogueado=true a HeaderNav (panel mobile con Mi cuenta)", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const element = await MobileMenu({
      estaLogueadoPromise: Promise.resolve(true),
    });
    render(element);

    await user.click(screen.getByRole("button", { name: "Abrir menú" }));

    const panel = screen.getByRole("navigation", {
      name: "Principal (mobile)",
    });
    expect(
      within(panel).getByRole("link", { name: "Mi cuenta" })
    ).toBeInTheDocument();
  });
});
