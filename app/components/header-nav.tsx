"use client";

import { useState } from "react";
import Link from "next/link";
import { cerrarSesion } from "@/app/cuenta/actions";

type HeaderNavProps = {
  /** Email del usuario logueado, o `null` si es un visitante anónimo. */
  userEmail: string | null;
};

/**
 * Enlaces de navegación en formato de link de texto, usados tanto en el
 * nav de escritorio como en el panel mobile (evita repetir clases).
 */
function EnlaceNav({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="rounded-control px-1 text-body-sm font-medium text-foreground-muted transition-colors hover:text-foreground md:px-0"
    >
      {children}
    </Link>
  );
}

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
 * Header/navegación global persistente (T-23), renderizado desde
 * `app/layout.tsx` en todas las páginas.
 *
 * Reglas de contenido:
 * - Logo/nombre del sitio, siempre visible, enlaza a `/`.
 * - Enlace a `/buscar`, siempre visible (comprar es la acción principal).
 * - Estado de sesión: si `userEmail` es `null` se muestran los enlaces
 *   "Ingresar" y "Vender / Registrarme" (login/registro); si hay sesión,
 *   se reemplazan por "Mi cuenta" y "Cerrar sesión" (Server Action
 *   `cerrarSesion`, la misma que ya usa `app/cuenta/page.tsx`).
 *
 * En mobile el nav colapsa en un botón hamburguesa que despliega un panel
 * con los mismos enlaces apilados (Client Component por el `useState` del
 * menú).
 */
export function HeaderNav({ userEmail }: HeaderNavProps) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const estaLogueado = userEmail !== null;
  const cerrarMenu = () => setMenuAbierto(false);

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          onClick={cerrarMenu}
          className="shrink-0 text-heading-3 font-display text-foreground"
        >
          Autos Usados Chile
        </Link>

        {/* Nav de escritorio: oculto en mobile, visible desde md. */}
        <nav aria-label="Principal" className="hidden items-center gap-6 md:flex">
          <EnlaceNav href="/buscar">Buscar</EnlaceNav>

          {estaLogueado ? (
            <>
              <EnlaceNav href="/cuenta">Mi cuenta</EnlaceNav>
              <form action={cerrarSesion}>
                <button
                  type="submit"
                  className="rounded-pill border border-border-strong px-4 py-2 text-body-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
                >
                  Cerrar sesión
                </button>
              </form>
            </>
          ) : (
            <>
              <EnlaceNav href="/login">Ingresar</EnlaceNav>
              <Link
                href="/registro"
                className="rounded-pill bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                Vender / Registrarme
              </Link>
            </>
          )}
        </nav>

        {/* Botón hamburguesa: solo en mobile, controla el panel de abajo. */}
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
      </div>

      {/* Panel mobile colapsable: mismos enlaces, apilados. */}
      {menuAbierto && (
        <nav
          id="menu-mobile"
          aria-label="Principal (mobile)"
          className="flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden"
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
    </header>
  );
}
