import "server-only";

/**
 * Integración server-side con el LLM de NVIDIA NIM (T-29, "Asistente de
 * Compra con IA"), usada por `app/api/asistente/chat/route.ts`.
 *
 * Vive en su propio módulo `lib/` (mismo criterio que `lib/email.ts` para
 * Resend) por dos motivos: (1) `import "server-only"` garantiza que este
 * archivo -y por lo tanto `NVIDIA_API_KEY`- nunca pueda terminar en un
 * bundle de cliente, y (2) queda testeable con `vi.mock("@/lib/nvidia-chat")`
 * desde el test del Route Handler, sin tener que llamar a la API real de
 * NVIDIA en cada corrida de `npm test`.
 *
 * A diferencia de `enviarEmailEvento` (lib/email.ts, diseño "fire and
 * forget" que nunca lanza), esta función SÍ debe propagar el error de forma
 * controlada: el criterio de aceptación de T-29 exige que el chat muestre un
 * mensaje de error claro cuando falla el proveedor NVIDIA, así que el
 * Route Handler necesita poder distinguir "la llamada falló" de "la llamada
 * funcionó" para responder con el status HTTP correcto.
 */

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_ENDPOINT = process.env.NVIDIA_API_ENDPOINT;
const NVIDIA_MODEL_ID = process.env.NVIDIA_MODEL_ID;

if (!NVIDIA_API_KEY) {
  throw new Error(
    "Falta la variable de entorno NVIDIA_API_KEY. Define su valor en .env.local (ver .env.local.example)."
  );
}

if (!NVIDIA_API_ENDPOINT) {
  throw new Error(
    "Falta la variable de entorno NVIDIA_API_ENDPOINT. Define su valor en .env.local (ver .env.local.example)."
  );
}

if (!NVIDIA_MODEL_ID) {
  throw new Error(
    "Falta la variable de entorno NVIDIA_MODEL_ID. Define su valor en .env.local (ver .env.local.example)."
  );
}

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/**
 * Error controlado de esta integración: el Route Handler lo distingue de
 * cualquier otra excepción inesperada (`err instanceof NvidiaChatError`)
 * para decidir el `status` de la respuesta y el mensaje que se muestra en
 * el chat, sin nunca dejar escapar el detalle crudo del proveedor (que
 * podría incluir información interna) directo a la UI.
 */
export class NvidiaChatError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "NvidiaChatError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

type NvidiaChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function extraerContenido(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const contenido = (data as NvidiaChatCompletionResponse).choices?.[0]
    ?.message?.content;

  if (typeof contenido !== "string" || contenido.trim().length === 0) {
    return null;
  }

  return contenido.trim();
}

/**
 * Llama al endpoint de chat completions de NVIDIA NIM (compatible con la
 * API de OpenAI) con `fetch` nativo -no hay SDK de NVIDIA/OpenAI instalado
 * como dependencia, y no hace falta uno para un solo endpoint REST simple.
 *
 * Lanza `NvidiaChatError` ante cualquier falla (red, status no-2xx,
 * respuesta sin el formato esperado) en vez de devolver un valor de error:
 * el llamador (`app/api/asistente/chat/route.ts`) necesita un solo `catch`
 * para mapear cualquiera de esos casos a una respuesta HTTP de error clara,
 * sin que la excepción tire abajo el Route Handler.
 */
export async function llamarNvidiaChat(
  messages: ChatMessage[]
): Promise<string> {
  let response: Response;

  try {
    response = await fetch(`${NVIDIA_API_ENDPOINT}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL_ID,
        messages,
        temperature: 0.4,
        max_tokens: 700,
      }),
    });
  } catch (err) {
    throw new NvidiaChatError(
      "No se pudo conectar con el proveedor NVIDIA (error de red).",
      { cause: err }
    );
  }

  if (!response.ok) {
    throw new NvidiaChatError(
      `El proveedor NVIDIA respondió con un error (status ${response.status}).`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new NvidiaChatError(
      "El proveedor NVIDIA devolvió una respuesta que no se pudo interpretar.",
      { cause: err }
    );
  }

  const contenido = extraerContenido(data);

  if (!contenido) {
    throw new NvidiaChatError(
      "El proveedor NVIDIA devolvió una respuesta vacía o con un formato inesperado."
    );
  }

  return contenido;
}
