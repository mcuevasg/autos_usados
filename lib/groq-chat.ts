import "server-only";

/**
 * Integración server-side con el LLM de Groq (T-29, "Asistente de Compra
 * con IA"), usada por `app/api/asistente/chat/route.ts`.
 *
 * Vive en su propio módulo `lib/` (mismo criterio que `lib/email.ts` para
 * Resend) por dos motivos: (1) `import "server-only"` garantiza que este
 * archivo -y por lo tanto `GROQ_API_KEY`- nunca pueda terminar en un
 * bundle de cliente, y (2) queda testeable con `vi.mock("@/lib/groq-chat")`
 * desde el test del Route Handler, sin tener que llamar a la API real de
 * Groq en cada corrida de `npm test`.
 *
 * Nota de historia: T-29 se implementó originalmente contra NVIDIA NIM
 * (`integrate.api.nvidia.com`), pero esa cuenta respondía `403
 * "Authorization failed"` en `/chat/completions` por falta del permiso
 * "Public API Endpoints" en la organización personal -un bloqueo de cuenta
 * de NVIDIA sin solución self-service (ver `.project/tasks.md`, T-29).
 * Se migró a Groq, que expone el mismo formato de API "chat completions"
 * compatible con OpenAI (`https://api.groq.com/openai/v1`), así que este
 * módulo es prácticamente idéntico al original salvo el nombre de las
 * variables de entorno y los mensajes de error.
 *
 * A diferencia de `enviarEmailEvento` (lib/email.ts, diseño "fire and
 * forget" que nunca lanza), esta función SÍ debe propagar el error de forma
 * controlada: el criterio de aceptación de T-29 exige que el chat muestre un
 * mensaje de error claro cuando falla el proveedor, así que el Route
 * Handler necesita poder distinguir "la llamada falló" de "la llamada
 * funcionó" para responder con el status HTTP correcto.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_ENDPOINT = process.env.GROQ_API_ENDPOINT;
const GROQ_MODEL_ID = process.env.GROQ_MODEL_ID;

if (!GROQ_API_KEY) {
  throw new Error(
    "Falta la variable de entorno GROQ_API_KEY. Define su valor en .env.local (ver .env.local.example)."
  );
}

if (!GROQ_API_ENDPOINT) {
  throw new Error(
    "Falta la variable de entorno GROQ_API_ENDPOINT. Define su valor en .env.local (ver .env.local.example)."
  );
}

if (!GROQ_MODEL_ID) {
  throw new Error(
    "Falta la variable de entorno GROQ_MODEL_ID. Define su valor en .env.local (ver .env.local.example)."
  );
}

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/**
 * Error controlado de esta integración: el Route Handler lo distingue de
 * cualquier otra excepción inesperada (`err instanceof GroqChatError`)
 * para decidir el `status` de la respuesta y el mensaje que se muestra en
 * el chat, sin nunca dejar escapar el detalle crudo del proveedor (que
 * podría incluir información interna) directo a la UI.
 */
export class GroqChatError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "GroqChatError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

type GroqChatCompletionResponse = {
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

  const contenido = (data as GroqChatCompletionResponse).choices?.[0]
    ?.message?.content;

  if (typeof contenido !== "string" || contenido.trim().length === 0) {
    return null;
  }

  return contenido.trim();
}

/**
 * Llama al endpoint de chat completions de Groq (compatible con la API de
 * OpenAI) con `fetch` nativo -no hay SDK de Groq/OpenAI instalado como
 * dependencia, y no hace falta uno para un solo endpoint REST simple.
 *
 * Lanza `GroqChatError` ante cualquier falla (red, status no-2xx,
 * respuesta sin el formato esperado) en vez de devolver un valor de error:
 * el llamador (`app/api/asistente/chat/route.ts`) necesita un solo `catch`
 * para mapear cualquiera de esos casos a una respuesta HTTP de error clara,
 * sin que la excepción tire abajo el Route Handler.
 */
export async function llamarGroqChat(
  messages: ChatMessage[]
): Promise<string> {
  let response: Response;

  try {
    response = await fetch(`${GROQ_API_ENDPOINT}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL_ID,
        messages,
        temperature: 0.4,
        max_tokens: 700,
      }),
    });
  } catch (err) {
    throw new GroqChatError(
      "No se pudo conectar con el proveedor Groq (error de red).",
      { cause: err }
    );
  }

  if (!response.ok) {
    throw new GroqChatError(
      `El proveedor Groq respondió con un error (status ${response.status}).`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new GroqChatError(
      "El proveedor Groq devolvió una respuesta que no se pudo interpretar.",
      { cause: err }
    );
  }

  const contenido = extraerContenido(data);

  if (!contenido) {
    throw new GroqChatError(
      "El proveedor Groq devolvió una respuesta vacía o con un formato inesperado."
    );
  }

  return contenido;
}
