import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Config mínima de Vitest (QA, T-23).
 *
 * Sin este archivo, Vitest no resuelve el alias `@/*` definido en
 * `tsconfig.json` (`"@/*": ["./*"]`): los tests que importan módulos reales
 * (no mockeados) vía `@/...` fallan con "Cannot find package '@/...'"
 * porque Vite no lee `tsconfig.json` para alias por defecto. Antes de este
 * archivo, el único test existente (`app/auth/callback/route.test.ts`)
 * pasaba solo porque mockeaba ese import con `vi.mock`, sin ejercitar la
 * resolución real del alias — un componente que además importe módulos
 * `@/...` sin mockear (como `app/components/header-nav.tsx`, que importa
 * `@/app/cuenta/actions`) sí lo necesita.
 *
 * `setupFiles` registra los matchers de `@testing-library/jest-dom`
 * (`toHaveAttribute`, `toBeInTheDocument`, etc.), usados por los tests de
 * componentes bajo `app/components/*.test.tsx`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
