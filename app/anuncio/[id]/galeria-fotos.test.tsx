// @vitest-environment jsdom
//
// Test de componente (QA, T-26) para la galería de fotos del detalle de un
// anuncio (`app/anuncio/[id]/galeria-fotos.tsx`). Mismo patrón que
// `app/buscar/anuncio-card.test.tsx`: se renderiza el componente
// directamente con props ya resueltas, sin montar la página completa ni
// tocar Supabase.
//
// Cubre el criterio de aceptación de T-26 relativo a la galería: sin
// fotos cae al placeholder "Sin foto" ya establecido (T-21); con fotos,
// muestra la primera como imagen principal y permite cambiarla haciendo
// click en una miniatura.

import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GaleriaFotos } from "./galeria-fotos";

afterEach(() => {
  cleanup();
});

describe("GaleriaFotos", () => {
  it("sin fotos, muestra el placeholder 'Sin foto' y no muestra miniaturas", () => {
    render(<GaleriaFotos fotosUrls={[]} />);

    expect(screen.getByText("Sin foto")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("con una sola foto, la muestra como imagen principal sin fila de miniaturas", () => {
    render(<GaleriaFotos fotosUrls={["https://ejemplo.test/foto-1.jpg"]} />);

    const imagenes = screen.getAllByAltText("Foto del anuncio");
    expect(imagenes).toHaveLength(1);
    expect(imagenes[0]).toHaveAttribute("src", "https://ejemplo.test/foto-1.jpg");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("con varias fotos, muestra la primera como principal y cambia al hacer click en una miniatura", async () => {
    const usuario = userEvent.setup();
    const fotosUrls = [
      "https://ejemplo.test/foto-1.jpg",
      "https://ejemplo.test/foto-2.jpg",
      "https://ejemplo.test/foto-3.jpg",
    ];

    render(<GaleriaFotos fotosUrls={fotosUrls} />);

    // La imagen principal es la primera de las 4 (1 principal + 3 miniaturas).
    const imagenesIniciales = screen.getAllByAltText("Foto del anuncio");
    expect(imagenesIniciales).toHaveLength(4);
    expect(imagenesIniciales[0]).toHaveAttribute(
      "src",
      "https://ejemplo.test/foto-1.jpg"
    );

    const botonTercerFoto = screen.getByRole("button", {
      name: "Ver foto 3 de 3",
    });
    await usuario.click(botonTercerFoto);

    const imagenesTrasClick = screen.getAllByAltText("Foto del anuncio");
    expect(imagenesTrasClick[0]).toHaveAttribute(
      "src",
      "https://ejemplo.test/foto-3.jpg"
    );
  });
});
