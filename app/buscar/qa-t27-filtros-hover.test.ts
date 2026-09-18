// QA independiente (T-27) — NO forma parte de la entrega del developer.
//
// `app/buscar/page.tsx` es un Server Component async con llamadas directas
// a Supabase (createSupabaseServerClient / cookies()), por lo que no es
// practico renderizarlo en jsdom sin levantar toda la infraestructura que
// ya cubren supabase/tests/buscar-t13.test.ts y
// supabase/tests/buscar-agrupacion-t14.test.ts (datos reales).
//
// Este test verifica a nivel de fuente que los 4 inputs del formulario de
// filtros (brand, model, year, location) efectivamente incorporan las
// clases de hover/focus/placeholder que T-27 dice haber agregado, y que
// ningún otro input del formulario quedó sin el tratamiento.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const fuente = readFileSync(
  path.join(process.cwd(), "app/buscar/page.tsx"),
  "utf-8"
);

const CAMPOS = ["brand", "model", "year", "location"] as const;

describe("QA T-27: hover/focus en inputs de filtros de /buscar", () => {
  it.each(CAMPOS)('el input name="%s" incluye las clases de micro-interacción', (nombre) => {
    const regex = new RegExp(
      `name="${nombre}"[\\s\\S]{0,200}?className="([^"]*)"`
    );
    const match = fuente.match(regex);
    expect(match, `no se encontró el input name="${nombre}"`).not.toBeNull();

    const className = match![1];
    expect(className).toContain("hover:border-primary");
    expect(className).toContain("focus:border-primary");
    expect(className).toContain("placeholder:text-foreground-subtle");
    expect(className).toContain("transition-colors");
  });

  it("no quedan inputs de texto del formulario de filtros sin transition-colors", () => {
    const inputs = [...fuente.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
    expect(inputs.length).toBeGreaterThanOrEqual(CAMPOS.length);
    for (const input of inputs) {
      expect(input).toContain("transition-colors");
    }
  });
});
