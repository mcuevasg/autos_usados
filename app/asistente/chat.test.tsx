// @vitest-environment jsdom
//
// Test de componente (QA, T-29) para `ChatAsistente`: cubre el criterio de
// aceptación "si falla la llamada al proveedor Groq, el chat muestra un
// mensaje de error claro sin romper el resto de la página" desde el punto
// de vista del cliente. Se mockea `fetch` global (nunca se llama al Route
// Handler real ni a Groq).

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatAsistente } from "./chat";

// jsdom no implementa `scrollIntoView` (usado para hacer scroll al final de
// la conversación en cada mensaje nuevo); se stubea una sola vez.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatAsistente", () => {
  it("muestra el mensaje de bienvenida al montarse", () => {
    render(<ChatAsistente />);

    expect(
      screen.getByText(/soy el asistente de compra de Autos Usados Chile/i)
    ).toBeInTheDocument();
  });

  it("envía el mensaje del usuario y muestra la respuesta del asistente", async () => {
    const usuario = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "Te recomiendo el Toyota Yaris 2020 en Santiago.",
          },
          anuncios: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              brand: "Toyota",
              model: "Yaris",
              year: 2020,
            },
          ],
        }),
      })
    );

    render(<ChatAsistente />);

    const input = screen.getByLabelText(/escribe qué auto buscas/i);
    await usuario.type(input, "busco un Toyota Yaris en Santiago");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));

    expect(
      await screen.findByText(
        "Te recomiendo el Toyota Yaris 2020 en Santiago."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /toyota yaris 2020/i })
    ).toHaveAttribute(
      "href",
      "/anuncio/11111111-1111-1111-1111-111111111111"
    );
  });

  it("cuando la respuesta trae un rango de precio, muestra un link a /buscar con esos filtros", async () => {
    const usuario = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "Tengo varios autos en ese rango.",
          },
          anuncios: [],
          filtros: { priceMin: 5_000_000, priceMax: 10_000_000 },
        }),
      })
    );

    render(<ChatAsistente />);

    const input = screen.getByLabelText(/escribe qué auto buscas/i);
    await usuario.type(input, "autos entre 5 y 10 millones");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));

    const link = await screen.findByRole("link", {
      name: /ver resultados en buscar/i,
    });
    expect(link).toHaveAttribute(
      "href",
      "/buscar?priceMin=5000000&priceMax=10000000"
    );
    expect(link).toHaveTextContent(
      "entre $5.000.000 y $10.000.000"
    );
  });

  it("cuando la respuesta trae marca, modelo y ubicación, arma el link con esos tres filtros", async () => {
    const usuario = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            role: "assistant",
            content: "Tengo un Toyota Yaris en Santiago.",
          },
          anuncios: [],
          filtros: { brand: "Toyota", model: "Yaris", location: "Santiago" },
        }),
      })
    );

    render(<ChatAsistente />);

    const input = screen.getByLabelText(/escribe qué auto buscas/i);
    await usuario.type(input, "busco un Toyota Yaris en Santiago");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));

    const link = await screen.findByRole("link", {
      name: /ver resultados en buscar/i,
    });
    expect(link).toHaveAttribute(
      "href",
      "/buscar?brand=Toyota&model=Yaris&location=Santiago"
    );
    expect(link).toHaveTextContent("Toyota Yaris, en Santiago");
  });

  it("cuando la respuesta no trae ningún filtro, no muestra el link a /buscar", async () => {
    const usuario = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { role: "assistant", content: "¿Qué auto buscas?" },
          anuncios: [],
          filtros: {},
        }),
      })
    );

    render(<ChatAsistente />);

    const input = screen.getByLabelText(/escribe qué auto buscas/i);
    await usuario.type(input, "hola");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));

    await screen.findByText("¿Qué auto buscas?");
    expect(
      screen.queryByRole("link", { name: /ver resultados en buscar/i })
    ).not.toBeInTheDocument();
  });

  it("si el Route Handler responde error, muestra un mensaje de error claro sin romper el chat", async () => {
    const usuario = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "El proveedor Groq no respondió." }),
      })
    );

    render(<ChatAsistente />);

    const input = screen.getByLabelText(/escribe qué auto buscas/i);
    await usuario.type(input, "busco un Toyota Yaris en Santiago");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));

    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent("El proveedor Groq no respondió.");
    // El input sigue disponible: el resto del chat no se rompió.
    expect(
      screen.getByLabelText(/escribe qué auto buscas/i)
    ).toBeInTheDocument();
  });

  it("si la petición fetch rechaza (error de red), muestra un mensaje de error genérico", async () => {
    const usuario = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<ChatAsistente />);

    const input = screen.getByLabelText(/escribe qué auto buscas/i);
    await usuario.type(input, "hola");
    await usuario.click(screen.getByRole("button", { name: /enviar/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /no se pudo conectar con el asistente/i
      );
    });
  });
});
