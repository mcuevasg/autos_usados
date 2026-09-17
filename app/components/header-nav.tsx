"use client";

import { useState } from "react";
import Link from "next/link";
import { cerrarSesion } from "@/app/cuenta/actions";

type HeaderNavProps = {
  /** `true` si hay una sesión activa; `false` si es un visitante anónimo. */
  estaLogueado: boolean;
};

function IconoMenu() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconoCerrar() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
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

/**
 * Botón hamburguesa + panel mobile colapsable del header global (T-23).
 *
 * `app/components/site-header.tsx` renderiza el logo, el link "Buscar" y el
 * nav de escritorio directamente (son estáticos o streamean por su cuenta);
 * `HeaderNav` solo se encarga de la parte que necesita estado local
 * (`useState` del menú mobile, por eso es Client Component) y de mostrar,
 * dentro del panel, los mismos enlaces de sesión que el nav de escritorio:
 * si `estaLogueado` es `false` se muestran "Ingresar" y "Vender /
 * Registrarme"; si es `true`, "Mi cuenta" y "Cerrar sesión" (Server Action
 * `cerrarSesion`, la misma que ya usa `app/cuenta/page.tsx`).
 *
 * `estaLogueado` llega ya resuelto (booleano, no una promesa ni el email):
 * `site-header.tsx` lo calcula en un Server Component async y solo pasa el
 * booleano, así el email del usuario (PII) nunca viaja al navegador.
 *
 * El panel se posiciona con `absolute` (en vez de depender de ser hermano
 * de `<header>` en el DOM) porque ahora vive anidado dentro del layout de
 * `site-header.tsx`; `<header>` es `relative`, así que el panel igual
 * aparece como una franja completa debajo del header.
 */
export function HeaderNav({ estaLogueado }: HeaderNavProps) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const cerrarMenu = () => setMenuAbierto(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuAbierto((valor) => !valor)}
        aria-expanded={menuAbierto}
        aria-controls="menu-mobile"
        aria-label={menuAbierto ? "Cerrar menú" : "Abrir menú"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-border-strong text-foreground md:hidden"
      >
        {menuAbierto ? <IconoCerrar /> : <IconoMenu />}
      </button>

      {menuAbierto && (
        <nav
          id="menu-mobile"
          aria-label="Principal (mobile)"
          className="absolute inset-x-0 top-full z-20 flex flex-col gap-1 border-t border-border bg-surface px-4 py-3 md:hidden"
        >
          <Link
            href="/buscar"
            onClick={cerrarMenu}
            className="rounded-control px-3 py-2 text-body-sm font-medium text-foreground hover:bg-surface-muted"
          >
            Buscar
          </Link>

          {estaLogueado ? (
            <>
              <Link
                href="/cuenta"
                onClick={cerrarMenu}
                className="rounded-control px-3 py-2 text-body-sm font-medium text-foreground hover:bg-surface-muted"
              >
                Mi cuenta
              </Link>
              <form action={cerrarSesion}>
                <button
                  type="submit"
                  className="w-full rounded-control px-3 py-2 text-left text-body-sm font-medium text-foreground hover:bg-surface-muted"
                >
                  Cerrar sesión
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                onClick={cerrarMenu}
                className="rounded-control px-3 py-2 text-body-sm font-medium text-foreground hover:bg-surface-muted"
              >
                Ingresar
              </Link>
              <Link
                href="/registro"
                onClick={cerrarMenu}
                className="rounded-control px-3 py-2 text-body-sm font-medium text-primary hover:bg-surface-muted"
              >
                Vender / Registrarme
              </Link>
            </>
          )}
        </nav>
      )}
    </>
  );
}
