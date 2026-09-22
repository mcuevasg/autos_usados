"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

/**
 * Interfaz de chat del Asistente de Compra con IA (T-29).
 *
 * Client Component: mantiene el historial de la conversación en estado de
 * React (sin persistir en base de datos, MVP) y llama al Route Handler
 * propio (`POST /api/asistente/chat`), que es el único lugar que toca
 * `NVIDIA_API_KEY` -esta pieza NUNCA llama directo al proveedor NVIDIA.
 *
 * Si la llamada al Route Handler falla o responde error, se muestra un
 * mensaje de error claro dentro del panel del chat (estado `error`, con
 * `role="alert"`) sin lanzar ninguna excepción no capturada: el resto de
 * la página (y del sitio) sigue funcionando igual.
 */

type Rol = "user" | "assistant";

type Mensaje = {
  role: Rol;
  content: string;
};

type AnuncioSugerido = {
  id: string;
  brand: string;
  model: string;
  year: number;
};

const MENSAJE_BIENVENIDA: Mensaje = {
  role: "assistant",
  content:
    "Hola, soy el asistente de compra de Autos Usados Chile. Cuéntame qué auto buscas (marca, modelo, año, ubicación y presupuesto) y te ayudo a encontrar anuncios publicados que calcen.",
};

const MENSAJE_ERROR_GENERICO =
  "No se pudo conectar con el asistente. Intenta de nuevo en unos minutos.";

export function ChatAsistente() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([MENSAJE_BIENVENIDA]);
  const [anunciosPorIndice, setAnunciosPorIndice] = useState<
    Record<number, AnuncioSugerido[]>
  >({});
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finConversacionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finConversacionRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, enviando]);

  async function enviarMensaje(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    const contenido = input.trim();
    if (!contenido || enviando) return;

    const historial = [...mensajes, { role: "user" as const, content: contenido }];

    setMensajes(historial);
    setInput("");
    setError(null);
    setEnviando(true);

    try {
      let respuesta: Response;
      try {
        respuesta = await fetch("/api/asistente/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: historial }),
        });
      } catch {
        // Falla de red (sin conexión, DNS, CORS, etc.): no hay respuesta del
        // servidor que traiga un mensaje de error propio, así que se usa
        // siempre el mensaje genérico en vez de exponer el error crudo del
        // navegador (ej. "Failed to fetch").
        throw new Error(MENSAJE_ERROR_GENERICO);
      }

      const datos = await respuesta.json().catch(() => null);

      if (!respuesta.ok || !datos?.message?.content) {
        throw new Error(
          typeof datos?.error === "string" ? datos.error : MENSAJE_ERROR_GENERICO
        );
      }

      const mensajeAsistente: Mensaje = {
        role: "assistant",
        content: datos.message.content,
      };

      setMensajes((previos) => {
        const actualizados = [...previos, mensajeAsistente];

        if (Array.isArray(datos.anuncios) && datos.anuncios.length > 0) {
          const indiceNuevoMensaje = actualizados.length - 1;
          setAnunciosPorIndice((previo) => ({
            ...previo,
            [indiceNuevoMensaje]: datos.anuncios as AnuncioSugerido[],
          }));
        }

        return actualizados;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : MENSAJE_ERROR_GENERICO);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
      <div
        aria-live="polite"
        className="flex max-h-[55vh] min-h-[320px] flex-col gap-3 overflow-y-auto pr-1"
      >
        {mensajes.map((mensaje, indice) => (
          <div key={indice} className="flex flex-col gap-2">
            <BurbujaMensaje mensaje={mensaje} />
            {anunciosPorIndice[indice] && (
              <ListaAnunciosSugeridos anuncios={anunciosPorIndice[indice]} />
            )}
          </div>
        ))}

        {enviando && <IndicadorEscribiendo />}

        <div ref={finConversacionRef} />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-body-sm text-danger"
        >
          {error}
        </p>
      )}

      <form onSubmit={enviarMensaje} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="asistente-input" className="sr-only">
          Escribe qué auto buscas
        </label>
        <input
          id="asistente-input"
          type="text"
          value={input}
          onChange={(evento) => setInput(evento.target.value)}
          placeholder="Ej: busco un SUV familiar en Santiago, bajo 8 millones"
          disabled={enviando}
          maxLength={2000}
          autoComplete="off"
          className="h-11 flex-1 rounded-control border border-border-strong bg-surface px-3 text-body text-foreground transition-colors placeholder:text-foreground-subtle hover:border-primary focus:border-primary disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={enviando || input.trim().length === 0}
          className="h-11 shrink-0 rounded-control bg-primary px-5 text-body-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? "Enviando..." : "Enviar"}
        </button>
      </form>

      <p className="text-caption text-foreground-subtle">
        ¿Prefieres filtrar tú mismo? Ve directo a{" "}
        <Link
          href="/buscar"
          className="font-medium text-primary underline-offset-4 hover:text-primary-hover hover:underline"
        >
          /buscar
        </Link>
        .
      </p>
    </div>
  );
}

function BurbujaMensaje({ mensaje }: { mensaje: Mensaje }) {
  const esUsuario = mensaje.role === "user";

  return (
    <div
      className={`flex ${esUsuario ? "justify-end" : "justify-start"}`}
    >
      <p
        className={
          esUsuario
            ? "max-w-[85%] whitespace-pre-wrap rounded-card bg-primary px-3.5 py-2.5 text-body-sm text-primary-foreground"
            : "max-w-[85%] whitespace-pre-wrap rounded-card bg-surface-muted px-3.5 py-2.5 text-body-sm text-foreground"
        }
      >
        {mensaje.content}
      </p>
    </div>
  );
}

function ListaAnunciosSugeridos({
  anuncios,
}: {
  anuncios: AnuncioSugerido[];
}) {
  return (
    <ul className="flex flex-wrap gap-2 pl-1">
      {anuncios.map((anuncio) => (
        <li key={anuncio.id}>
          <Link
            href={`/anuncio/${anuncio.id}`}
            className="inline-flex items-center gap-1 rounded-pill border border-border-strong bg-surface px-3 py-1 text-caption font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
          >
            {anuncio.brand} {anuncio.model} {anuncio.year}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function IndicadorEscribiendo() {
  return (
    <div className="flex justify-start" aria-hidden="true">
      <div className="flex items-center gap-1 rounded-card bg-surface-muted px-3.5 py-3">
        <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-foreground-subtle [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-foreground-subtle [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-foreground-subtle [animation-delay:300ms]" />
      </div>
    </div>
  );
}
