// Test (QA, T-29) de `app/api/asistente/chat/route.ts`: validación del body
// (límites de cantidad/largo de mensajes, público y sin autenticación) y el
// manejo de error cuando falla la llamada a NVIDIA, sin llamar a la API
// real -se mockean `lib/asistente-contexto` y `lib/nvidia-chat` completos,
// mismo patrón que `app/auth/callback/route.test.ts` (`vi.mock` + import
// del módulo real después del mock).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/asistente-contexto", () => ({
  obtenerAnunciosContexto: vi.fn(),
  construirMensajeSistema: vi.fn(),
}));

vi.mock("@/lib/nvidia-chat", async () => {
  class NvidiaChatError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "NvidiaChatError";
    }
  }
  return {
    llamarNvidiaChat: vi.fn(),
    NvidiaChatError,
  };
});

import {
  obtenerAnunciosContexto,
  construirMensajeSistema,
} from "@/lib/asistente-contexto";
import { llamarNvidiaChat, NvidiaChatError } from "@/lib/nvidia-chat";
import { POST, validarMensajes } from "./route";

const ANUNCIO_TOYOTA = {
  id: "11111111-1111-1111-1111-111111111111",
  brand: "Toyota",
  model: "Yaris",
  year: 2020,
  price: 8_500_000,
  mileage: 45_000,
  location: "Santiago",
};

function crearRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/asistente/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("validarMensajes", () => {
  it("rechaza un valor que no es un arreglo", () => {
    const resultado = validarMensajes("hola");
    expect(resultado.ok).toBe(false);
  });

  it("rechaza un arreglo vacío", () => {
    const resultado = validarMensajes([]);
    expect(resultado.ok).toBe(false);
  });

  it("rechaza más de 20 mensajes", () => {
    const mensajes = Array.from({ length: 21 }, () => ({
      role: "user",
      content: "hola",
    }));

    const resultado = validarMensajes(mensajes);
    expect(resultado.ok).toBe(false);
  });

  it("rechaza un rol inválido", () => {
    const resultado = validarMensajes([
      { role: "system", content: "hola" },
    ]);
    expect(resultado.ok).toBe(false);
  });

  it("rechaza contenido vacío", () => {
    const resultado = validarMensajes([{ role: "user", content: "   " }]);
    expect(resultado.ok).toBe(false);
  });

  it("rechaza un mensaje de más de 2000 caracteres", () => {
    const resultado = validarMensajes([
      { role: "user", content: "a".repeat(2001) },
    ]);
    expect(resultado.ok).toBe(false);
  });

  it("acepta una lista válida de mensajes user/assistant", () => {
    const resultado = validarMensajes([
      { role: "user", content: "busco un Toyota" },
      { role: "assistant", content: "¿en qué ciudad?" },
      { role: "user", content: "Santiago" },
    ]);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.mensajes).toHaveLength(3);
    }
  });
});

describe("POST /api/asistente/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(construirMensajeSistema).mockReturnValue("system prompt");
  });

  it("responde 400 si el body no es JSON válido", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/asistente/chat",
      { method: "POST", body: "no-es-json" }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(llamarNvidiaChat).not.toHaveBeenCalled();
  });

  it("responde 400 si 'messages' no cumple la validación", async () => {
    const request = crearRequest({ messages: [] });

    const response = await POST(request);
    const datos = await response.json();

    expect(response.status).toBe(400);
    expect(datos.error).toBeTruthy();
    expect(llamarNvidiaChat).not.toHaveBeenCalled();
  });

  it("con mensajes válidos, consulta el contexto, llama a NVIDIA y devuelve la respuesta", async () => {
    vi.mocked(obtenerAnunciosContexto).mockResolvedValue([ANUNCIO_TOYOTA]);
    vi.mocked(llamarNvidiaChat).mockResolvedValue(
      "Te recomiendo el Toyota Yaris 2020 publicado en Santiago."
    );

    const request = crearRequest({
      messages: [{ role: "user", content: "busco un Toyota en Santiago" }],
    });

    const response = await POST(request);
    const datos = await response.json();

    expect(response.status).toBe(200);
    expect(obtenerAnunciosContexto).toHaveBeenCalledWith(
      "busco un Toyota en Santiago"
    );
    expect(llamarNvidiaChat).toHaveBeenCalledWith([
      { role: "system", content: "system prompt" },
      { role: "user", content: "busco un Toyota en Santiago" },
    ]);
    expect(datos.message).toEqual({
      role: "assistant",
      content: "Te recomiendo el Toyota Yaris 2020 publicado en Santiago.",
    });
    expect(datos.anuncios).toEqual([
      { id: ANUNCIO_TOYOTA.id, brand: "Toyota", model: "Yaris", year: 2020 },
    ]);
  });

  it("si obtenerAnunciosContexto falla, igual llama a NVIDIA con contexto vacío (no rompe el chat)", async () => {
    vi.mocked(obtenerAnunciosContexto).mockRejectedValue(
      new Error("supabase caído")
    );
    vi.mocked(llamarNvidiaChat).mockResolvedValue("¿Qué auto buscas?");

    const request = crearRequest({
      messages: [{ role: "user", content: "hola" }],
    });

    const response = await POST(request);
    const datos = await response.json();

    expect(response.status).toBe(200);
    expect(datos.message.content).toBe("¿Qué auto buscas?");
    expect(construirMensajeSistema).toHaveBeenCalledWith([]);
  });

  it("si NVIDIA falla con NvidiaChatError, responde 502 con el mensaje claro del error", async () => {
    vi.mocked(obtenerAnunciosContexto).mockResolvedValue([]);
    vi.mocked(llamarNvidiaChat).mockRejectedValue(
      new NvidiaChatError(
        "El proveedor NVIDIA respondió con un error (status 500)."
      )
    );

    const request = crearRequest({
      messages: [{ role: "user", content: "hola" }],
    });

    const response = await POST(request);
    const datos = await response.json();

    expect(response.status).toBe(502);
    expect(datos.error).toMatch(/NVIDIA respondió con un error/);
  });

  it("si NVIDIA falla con un error inesperado (no NvidiaChatError), responde 502 con un mensaje genérico", async () => {
    vi.mocked(obtenerAnunciosContexto).mockResolvedValue([]);
    vi.mocked(llamarNvidiaChat).mockRejectedValue(new Error("boom interno"));

    const request = crearRequest({
      messages: [{ role: "user", content: "hola" }],
    });

    const response = await POST(request);
    const datos = await response.json();

    expect(response.status).toBe(502);
    expect(datos.error).not.toMatch(/boom interno/);
    expect(datos.error).toBeTruthy();
  });
});
