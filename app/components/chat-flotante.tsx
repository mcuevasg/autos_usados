"use client";

import { useState } from "react";
import { ChatAsistente } from "@/app/asistente/chat";

/**
 * Widget flotante del Asistente de Compra con IA (T-29), montado en
 * `app/layout.tsx` para que aparezca en cualquier página del sitio (no solo
 * en `/asistente`): un botón circular fijo en la esquina inferior derecha
 * que despliega el mismo `ChatAsistente` usado en la página completa, en
 * un panel flotante compacto.
 *
 * No lee cookies, sesión, `searchParams` ni datos del servidor -es un
 * Client Component con un único `useState` local (abierto/cerrado)-, así
 * que no necesita ningún `<Suspense>` ni afecta el prerenderizado estático
 * del resto del sitio (T-28): se renderiza igual en cualquier ruta.
 *
 * `/asistente` (la página completa) sigue existiendo tal cual para quien
 * llega por link directo; el widget simplemente la hace descubrible y
 * accesible desde cualquier otra página sin tener que navegar.
 */
export function ChatFlotante() {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {abierto && (
        <div
          id="chat-flotante-panel"
          className="max-h-[calc(100vh-6rem)] w-[calc(100vw-2rem)] max-w-sm overflow-y-auto sm:w-96"
        >
          <ChatAsistente
            encabezado={{
              titulo: "Asistente de compra",
              onCerrar: () => setAbierto(false),
            }}
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => setAbierto((valor) => !valor)}
        aria-expanded={abierto}
        aria-controls="chat-flotante-panel"
        aria-label={abierto ? "Cerrar asistente de compra" : "Abrir asistente de compra"}
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-pill bg-primary text-primary-foreground shadow-overlay transition-transform duration-200 hover:scale-105 hover:bg-primary-hover"
      >
        {abierto ? <IconoCerrar /> : <IconoChat />}
      </button>
    </div>
  );
}

function IconoChat() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H9l-4 4v-4H5.5A1.5 1.5 0 014 14.5v-9z" />
    </svg>
  );
}

function IconoCerrar() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
