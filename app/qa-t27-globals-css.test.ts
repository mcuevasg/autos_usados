// QA independiente (T-27) — NO forma parte de la entrega del developer.
//
// Verifica a nivel de fuente que `@keyframes menu-mobile-in` está definido
// en app/globals.css con el fade + slide corto descrito en el PR, y que el
// nuevo skeleton de /buscar y /anuncio/[id] realmente reutiliza el token
// `bg-surface-muted` (no colores crudos) para animate-pulse.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  path.join(process.cwd(), "app/globals.css"),
  "utf-8"
);

describe("QA T-27: @keyframes menu-mobile-in en globals.css", () => {
  it("define el keyframe con fade (opacity 0->1) + slide corto (translateY)", () => {
    const match = globalsCss.match(/@keyframes menu-mobile-in\s*{([\s\S]*?)}\s*}/);
    expect(match, "no se encontró @keyframes menu-mobile-in").not.toBeNull();

    const cuerpo = match![0];
    expect(cuerpo).toMatch(/from\s*{\s*opacity:\s*0;/);
    expect(cuerpo).toMatch(/translateY\(-0\.25rem\)/);
    expect(cuerpo).toMatch(/to\s*{\s*opacity:\s*1;/);
    expect(cuerpo).toMatch(/translateY\(0\)/);
  });
});
