import { NextResponse } from "next/server";

import {
  construirMensajeSistema,
  obtenerAnunciosContexto,
  type AnuncioContexto,
} from "@/lib/asistente-contexto";
import {
  llamarGroqChat,
  GroqChatError,
  type ChatMessage,
} from "@/lib/groq-chat";

/**
 * Route Handler del Asistente de Compra con IA (T-29).
 *
 * Público (no requiere sesión, mismo criterio de visibilidad que
 * `/buscar`), por lo que valida el body con cuidado: es un endpoint sin
 * autenticación que dispara una llamada a un proveedor externo (Groq), así
 * que se limita tanto la cantidad de mensajes por conversación como el
 * largo de cada uno para acotar el costo/abuso.
 *
 * Flujo:
 * 1. Valida el body (`validarMensajes`).
 * 2. Consulta anuncios PUBLICADOS reales acotados al último mensaje del
 *    comprador (`obtenerAnunciosContexto`, lib/asistente-contexto.ts) para
 *    fundamentar la respuesta del LLM y evitar que invente autos.
 * 3. Arma el mensaje de sistema con esos anuncios y llama a Groq
 *    (`llamarGroqChat`, lib/groq-chat.ts) -la única pieza de este módulo
 *    que toca `GROQ_API_KEY`, y solo server-side.
 * 4. Si la consulta a Supabase falla, se sigue igual con contexto vacío (el
 *    mensaje de sistema ya le indica al modelo que, sin anuncios, debe
 *    decirlo en vez de inventar) en vez de romper el chat completo por un
 *    problema ajeno al proveedor de IA.
 * 5. Si la llamada a Groq falla, responde 502 con un mensaje de error
 *    claro (nunca deja escapar la excepción cruda ni tira abajo el
 *    handler).
 */

const ROLES_VALIDOS = new Set(["user", "assistant"]);
const MAXIMO_MENSAJES = 20;
const MAXIMO_CARACTERES_POR_MENSAJE = 2000;

type ResultadoValidacion =
  | { ok: true; mensajes: ChatMessage[] }
  | { ok: false; error: string };

/**
 * Valida la forma del body recibido: debe ser `{ messages: [...] }`, un
 * arreglo no vacío de `{ role: "user" | "assistant", content: string }`,
 * dentro de los límites de cantidad/largo definidos arriba. Se exporta
 * para poder testearla sin tener que invocar `POST` con un `Request`
 * completo.
 */
export function validarMensajes(valor: unknown): ResultadoValidacion {
  if (!Array.isArray(valor) || valor.length === 0) {
    return { ok: false, error: "Debes enviar al menos un mensaje." };
  }

  if (valor.length > MAXIMO_MENSAJES) {
    return {
      ok: false,
      error: `Se permite un máximo de ${MAXIMO_MENSAJES} mensajes por conversación.`,
    };
  }

  const mensajes: ChatMessage[] = [];

  for (const item of valor) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("role" in item) ||
      !("content" in item)
    ) {
      return {
        ok: false,
        error: "Cada mensaje debe tener 'role' y 'content'.",
      };
    }

    const { role, content } = item as { role: unknown; content: unknown };

    if (typeof role !== "string" || !ROLES_VALIDOS.has(role)) {
      return {
        ok: false,
        error: "El rol de cada mensaje debe ser 'user' o 'assistant'.",
      };
    }

    if (typeof content !== "string" || content.trim().length === 0) {
      return {
        ok: false,
        error: "El contenido de cada mensaje no puede estar vacío.",
      };
    }

    if (content.length > MAXIMO_CARACTERES_POR_MENSAJE) {
      return {
        ok: false,
        error: `Cada mensaje debe tener a lo más ${MAXIMO_CARACTERES_POR_MENSAJE} caracteres.`,
      };
    }

    mensajes.push({ role: role as "user" | "assistant", content });
  }

  return { ok: true, mensajes };
}

function obtenerUltimoMensajeUsuario(mensajes: ChatMessage[]): string {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    if (mensajes[i].role === "user") {
      return mensajes[i].content;
    }
  }
  return "";
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "El cuerpo de la petición debe ser JSON válido." },
      { status: 400 }
    );
  }

  const messages =
    typeof body === "object" && body !== null && "messages" in body
      ? (body as { messages: unknown }).messages
      : undefined;

  const validacion = validarMensajes(messages);

  if (!validacion.ok) {
    return NextResponse.json({ error: validacion.error }, { status: 400 });
  }

  const { mensajes } = validacion;
  const ultimoMensajeUsuario = obtenerUltimoMensajeUsuario(mensajes);

  let anuncios: AnuncioContexto[] = [];
  try {
    anuncios = await obtenerAnunciosContexto(ultimoMensajeUsuario);
  } catch (err) {
    console.error(
      "[asistente] Error al consultar anuncios para el contexto del chat:",
      err
    );
    // Se continúa con contexto vacío: `construirMensajeSistema` ya le deja
    // claro al modelo que, sin anuncios, debe decirlo en vez de inventar.
  }

  const mensajeSistema: ChatMessage = {
    role: "system",
    content: construirMensajeSistema(anuncios),
  };

  try {
    const respuesta = await llamarGroqChat([mensajeSistema, ...mensajes]);

    return NextResponse.json(
      {
        message: { role: "assistant", content: respuesta },
        anuncios: anuncios.map((a) => ({
          id: a.id,
          brand: a.brand,
          model: a.model,
          year: a.year,
        })),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[asistente] Error al llamar al proveedor Groq:", err);

    const mensajeError =
      err instanceof GroqChatError
        ? err.message
        : "No se pudo conectar con el asistente. Intenta nuevamente en unos minutos.";

    return NextResponse.json({ error: mensajeError }, { status: 502 });
  }
}
