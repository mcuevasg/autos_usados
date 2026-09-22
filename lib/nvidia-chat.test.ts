// Test (QA, T-29) de `lib/nvidia-chat.ts`: la integración server-side con
// NVIDIA NIM. No llama a la API real -se mockea `fetch` global-, cubre la
// verificación de variables de entorno faltantes (mismo patrón que
// `lib/supabase/server.ts`) y el manejo de error cuando la llamada al
// proveedor falla, que es justo lo que el Route Handler necesita para
// cumplir el criterio de aceptación ("si falla NVIDIA, mensaje de error
// claro sin romper el resto de la página").

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` (ver `lib/nvidia-chat.ts`) resuelve su condición
// "react-server" solo dentro del bundler de Next.js; en Vitest siempre cae
// al `index.js` que lanza un error a propósito. Se mockea acá (igual que
// cualquier otra dependencia externa) para poder ejercitar la lógica real
// del módulo sin levantar el runtime completo de Next.
vi.mock("server-only", () => ({}));

const VARIABLES_NVIDIA = [
  "NVIDIA_API_KEY",
  "NVIDIA_API_ENDPOINT",
  "NVIDIA_MODEL_ID",
] as const;

function setEnvValido() {
  process.env.NVIDIA_API_KEY = "test-api-key";
  process.env.NVIDIA_API_ENDPOINT = "https://nvidia.test/v1";
  process.env.NVIDIA_MODEL_ID = "test-model-id";
}

beforeEach(() => {
  vi.resetModules();
  setEnvValido();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const variable of VARIABLES_NVIDIA) {
    delete process.env[variable];
  }
});

describe("lib/nvidia-chat: variables de entorno", () => {
  it("lanza un error claro si falta NVIDIA_API_KEY", async () => {
    delete process.env.NVIDIA_API_KEY;

    await expect(import("./nvidia-chat")).rejects.toThrow(/NVIDIA_API_KEY/);
  });

  it("lanza un error claro si falta NVIDIA_API_ENDPOINT", async () => {
    delete process.env.NVIDIA_API_ENDPOINT;

    await expect(import("./nvidia-chat")).rejects.toThrow(
      /NVIDIA_API_ENDPOINT/
    );
  });

  it("lanza un error claro si falta NVIDIA_MODEL_ID", async () => {
    delete process.env.NVIDIA_MODEL_ID;

    await expect(import("./nvidia-chat")).rejects.toThrow(/NVIDIA_MODEL_ID/);
  });
});

describe("llamarNvidiaChat", () => {
  it("llama al endpoint de chat completions con el modelo/mensajes correctos y devuelve el contenido de la respuesta", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "  Hola, ¿en qué te ayudo?  " } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { llamarNvidiaChat } = await import("./nvidia-chat");

    const resultado = await llamarNvidiaChat([
      { role: "system", content: "eres un asistente" },
      { role: "user", content: "hola" },
    ]);

    expect(resultado).toBe("Hola, ¿en qué te ayudo?");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe("https://nvidia.test/v1/chat/completions");
    expect(opciones.method).toBe("POST");
    expect(opciones.headers.Authorization).toBe("Bearer test-api-key");

    const body = JSON.parse(opciones.body);
    expect(body.model).toBe("test-model-id");
    expect(body.messages).toEqual([
      { role: "system", content: "eres un asistente" },
      { role: "user", content: "hola" },
    ]);
  });

  it("lanza NvidiaChatError si el fetch rechaza (error de red)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const { llamarNvidiaChat, NvidiaChatError } = await import(
      "./nvidia-chat"
    );

    await expect(
      llamarNvidiaChat([{ role: "user", content: "hola" }])
    ).rejects.toBeInstanceOf(NvidiaChatError);
  });

  it("lanza NvidiaChatError si el proveedor responde un status no-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      })
    );

    const { llamarNvidiaChat, NvidiaChatError } = await import(
      "./nvidia-chat"
    );

    await expect(
      llamarNvidiaChat([{ role: "user", content: "hola" }])
    ).rejects.toThrow(/500/);
    await expect(
      llamarNvidiaChat([{ role: "user", content: "hola" }])
    ).rejects.toBeInstanceOf(NvidiaChatError);
  });

  it("lanza NvidiaChatError si la respuesta no es JSON válido", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      })
    );

    const { llamarNvidiaChat, NvidiaChatError } = await import(
      "./nvidia-chat"
    );

    await expect(
      llamarNvidiaChat([{ role: "user", content: "hola" }])
    ).rejects.toBeInstanceOf(NvidiaChatError);
  });

  it("lanza NvidiaChatError si la respuesta no trae contenido (formato inesperado)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      })
    );

    const { llamarNvidiaChat, NvidiaChatError } = await import(
      "./nvidia-chat"
    );

    await expect(
      llamarNvidiaChat([{ role: "user", content: "hola" }])
    ).rejects.toBeInstanceOf(NvidiaChatError);
  });
});
