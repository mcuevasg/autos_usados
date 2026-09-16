// Test de QA (independiente de la implementación) para el criterio de
// aceptación de T-20 (.project/tasks.md):
//
//   "los mismos eventos de T-19 (cambio de estado de anuncio, aprobación
//   de venta) disparan un correo al usuario afectado vía un proveedor de
//   email con tier gratuito (Resend)."
//
// NOTA IMPORTANTE sobre el enfoque: `lib/email.ts` importa `server-only`,
// cuyo paquete (node_modules/server-only/index.js) LANZA una excepción de
// forma incondicional en cuanto se importa fuera de la condición de
// resolución "react-server" de React Server Components. Bajo Vitest (Node
// normal, sin esa condición) esto ocurre siempre, así que este archivo NO
// puede hacer `import { enviarEmailEvento } from "@/lib/email"` (se
// confirmó manualmente: falla con "This module cannot be imported from a
// Client Component module..."). Los demás tests de este repo que cubren
// código de Server Actions (ej. supabase/tests/venta-t16.test.ts,
// venta-aprobacion-t16.test.ts) evitan el mismo problema:
//   (a) para el comportamiento observable, REPRODUCEN las llamadas a
//       Supabase/Resend directamente (mismo enfoque que "simula" la
//       Server Action), y
//   (b) para la estructura del código (que la lógica correcta esté en el
//       lugar correcto), leen el código fuente con `readFileSync` y
//       hacen aserciones sobre su contenido.
// Este archivo combina ambos enfoques para T-20.
//
// Cubre:
//   1. `lib/email.ts` es "fire and forget": ninguna de las dos funciones
//      exportadas (`enviarEmailEvento`, `obtenerEmailUsuario`) tiene un
//      `throw` en su cuerpo, y ambas envuelven su lógica en `try/catch`
//      con `console.error` en el `catch` (mismo patrón que
//      `crearNotificacion` de T-19, lib/notifications.ts).
//   2. `app/moderador/vendedores/actions.ts` (verificación de vendedor)
//      NO invoca `enviarEmailEvento` en ningún punto.
//   3. `app/moderador/anuncios/actions.ts` y
//      `app/moderador/ventas/actions.ts` SÍ invocan `enviarEmailEvento`
//      después de `crearNotificacion`, y el `userId`/destinatario resuelto
//      para el email es el mismo `seller.user_id` que se usa para la
//      notificación in-app (sin mismatch entre a quién se notifica in-app
//      y a quién se le intenta enviar el email).
//   4. Integración real (si hay credenciales): `obtenerEmailUsuario`
//      resuelve correctamente el email de un usuario real de
//      `auth.users` vía `auth.admin.getUserById` (la misma llamada que
//      hace `lib/email.ts`).
//   5. Integración real con Resend (si `RESEND_API_KEY` está presente):
//      una llamada a `resend.emails.send` con el mismo remitente sandbox
//      que usa `lib/email.ts` (`onboarding@resend.dev`) resuelve sin
//      lanzar una excepción, sea que Resend la acepte o la rechace por la
//      limitación de sandbox (sin dominio verificado) — confirmando que
//      el `try/catch` de `enviarEmailEvento` cubre ambos casos. La
//      API key NUNCA se imprime ni se loguea.
//
// Si no hay credenciales de Supabase y/o de Resend, las partes 4 y 5 se
// saltan (no fallan) para no romper `npm test` en checkouts sin esos
// secretos configurados.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const hasSupabaseCredentials = Boolean(
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
);
// No confundir "la variable existe" con "es una key real": en checkouts
// nuevos, .env.local.example deja un placeholder literal.
const hasResendCredentials = Boolean(
  RESEND_API_KEY && RESEND_API_KEY !== "tu-resend-api-key"
);

const EMAIL_PATH = path.resolve(process.cwd(), "lib/email.ts");
const NOTIFICATIONS_PATH = path.resolve(process.cwd(), "lib/notifications.ts");
const ANUNCIOS_ACTIONS_PATH = path.resolve(
  process.cwd(),
  "app/moderador/anuncios/actions.ts"
);
const VENTAS_ACTIONS_PATH = path.resolve(
  process.cwd(),
  "app/moderador/ventas/actions.ts"
);
const VENDEDORES_ACTIONS_PATH = path.resolve(
  process.cwd(),
  "app/moderador/vendedores/actions.ts"
);

/**
 * Extrae el cuerpo de una función exportada `export async function NAME(`
 * hasta su cierre de llave a nivel 0, para poder inspeccionar solo ESE
 * cuerpo (y no todo el archivo) en busca de `throw`/`try`/`catch`.
 */
function extraerCuerpoFuncion(source: string, nombreFuncion: string): string {
  const inicioFirma = source.indexOf(`export async function ${nombreFuncion}`);
  expect(
    inicioFirma,
    `no se encontró "export async function ${nombreFuncion}" en el archivo`
  ).toBeGreaterThanOrEqual(0);

  // La firma puede desestructurar parámetros entre llaves (ej.
  // `function enviarEmailEvento({ to, subject, html }: Params)`), así que
  // no basta con el primer "{" tras el nombre de la función: hay que
  // encontrar primero el cierre balanceado de los paréntesis de la lista
  // de parámetros, y recién después buscar el "{" que abre el cuerpo.
  const inicioParams = source.indexOf("(", inicioFirma);
  expect(inicioParams).toBeGreaterThan(inicioFirma);

  let profundidadParens = 0;
  let finParams = -1;
  for (let i = inicioParams; i < source.length; i++) {
    if (source[i] === "(") profundidadParens++;
    if (source[i] === ")") {
      profundidadParens--;
      if (profundidadParens === 0) {
        finParams = i;
        break;
      }
    }
  }
  expect(finParams).toBeGreaterThan(inicioParams);

  const inicioLlave = source.indexOf("{", finParams);
  expect(inicioLlave).toBeGreaterThan(finParams);

  let profundidad = 0;
  for (let i = inicioLlave; i < source.length; i++) {
    if (source[i] === "{") profundidad++;
    if (source[i] === "}") {
      profundidad--;
      if (profundidad === 0) {
        return source.slice(inicioLlave, i + 1);
      }
    }
  }

  throw new Error(`no se encontró el cierre de "${nombreFuncion}"`);
}

describe("T-20: notificaciones por email — estructura del código (lib/email.ts, Server Actions)", () => {
  const emailSource = readFileSync(EMAIL_PATH, "utf-8");
  const notificationsSource = readFileSync(NOTIFICATIONS_PATH, "utf-8");
  const anunciosSource = readFileSync(ANUNCIOS_ACTIONS_PATH, "utf-8");
  const ventasSource = readFileSync(VENTAS_ACTIONS_PATH, "utf-8");
  const vendedoresSource = readFileSync(VENDEDORES_ACTIONS_PATH, "utf-8");

  it("(1a) enviarEmailEvento es fire-and-forget: try/catch, sin throw, catch usa console.error", () => {
    const cuerpo = extraerCuerpoFuncion(emailSource, "enviarEmailEvento");

    expect(cuerpo).toContain("try {");
    expect(cuerpo).toContain("catch (err)");
    expect(cuerpo).toContain("console.error");
    expect(cuerpo).not.toContain("throw ");
  });

  it("(1b) obtenerEmailUsuario es fire-and-forget: try/catch, sin throw, retorna null en error, catch usa console.error", () => {
    const cuerpo = extraerCuerpoFuncion(emailSource, "obtenerEmailUsuario");

    expect(cuerpo).toContain("try {");
    expect(cuerpo).toContain("catch (err)");
    expect(cuerpo).toContain("console.error");
    expect(cuerpo).not.toContain("throw ");
    // Camino de error de la API (`error` de Supabase) retorna null, no
    // lanza.
    expect(cuerpo).toMatch(/if \(error\)[\s\S]*?return null;/);
    // Camino catastrófico (excepción) también retorna null.
    expect(cuerpo).toMatch(/catch \(err\) \{[\s\S]*?return null;[\s\S]*?\}/);
  });

  it("(1c) el patrón de lib/email.ts replica el de crearNotificacion (T-19, lib/notifications.ts): try/catch + console.error, sin throw", () => {
    const cuerpoNotif = extraerCuerpoFuncion(
      notificationsSource,
      "crearNotificacion"
    );
    expect(cuerpoNotif).toContain("try {");
    expect(cuerpoNotif).toContain("catch (err)");
    expect(cuerpoNotif).toContain("console.error");
    expect(cuerpoNotif).not.toContain("throw ");
  });

  it("(2) app/moderador/vendedores/actions.ts (verificación de vendedor) NO invoca enviarEmailEvento en ningún punto", () => {
    expect(vendedoresSource).not.toContain("enviarEmailEvento");
    expect(vendedoresSource).not.toContain("from \"@/lib/email\"");
    // Confirma que sí sigue notificando in-app (T-19), para descartar que
    // el archivo simplemente no tenga ningún efecto secundario: el
    // criterio de T-20 es que EXCLUYE el email de este evento en
    // particular, no que se haya roto la notificación in-app.
    expect(vendedoresSource).toContain("crearNotificacion");
  });

  it("(3a) app/moderador/anuncios/actions.ts invoca enviarEmailEvento DESPUÉS de crearNotificacion, para el mismo seller.user_id", () => {
    expect(anunciosSource).toContain("enviarEmailEvento");

    const idxNotificacion = anunciosSource.indexOf("crearNotificacion({");
    const idxEmail = anunciosSource.indexOf("enviarEmailEvento({");
    expect(idxNotificacion).toBeGreaterThan(0);
    expect(idxEmail).toBeGreaterThan(idxNotificacion);

    // El bloque entre ambas llamadas (la llamada a crearNotificacion y la
    // resolución del email) debe usar el mismo identificador
    // `seller.user_id` para ambos destinatarios (sin mismatch).
    const bloque = anunciosSource.slice(idxNotificacion, idxEmail + 200);
    expect(bloque).toContain("userId: seller.user_id");
    expect(bloque).toContain("obtenerEmailUsuario(seller.user_id)");
  });

  it("(3b) app/moderador/ventas/actions.ts invoca enviarEmailEvento DESPUÉS de crearNotificacion, para el mismo seller.user_id", () => {
    expect(ventasSource).toContain("enviarEmailEvento");

    const idxNotificacion = ventasSource.indexOf("crearNotificacion({");
    const idxEmail = ventasSource.indexOf("enviarEmailEvento({");
    expect(idxNotificacion).toBeGreaterThan(0);
    expect(idxEmail).toBeGreaterThan(idxNotificacion);

    const bloque = ventasSource.slice(idxNotificacion, idxEmail + 200);
    expect(bloque).toContain("userId: seller.user_id");
    expect(bloque).toContain("obtenerEmailUsuario(seller.user_id)");
  });

  it("(3c) aprobarVenta invoca la notificación (in-app + email) en AMBOS caminos: flujo feliz y recuperación de fallo parcial (T-16)", () => {
    // `notificarVentaAprobada` encapsula ambos efectos (crearNotificacion +
    // enviarEmailEvento); confirma que se invoca tanto en el flujo feliz
    // como en el camino de recuperación (ver comentario de `aprobarVenta`).
    const invocaciones = ventasSource.match(
      /await notificarVentaAprobada\(/g
    );
    expect(invocaciones?.length).toBe(2);
  });
});

describe.skipIf(!hasSupabaseCredentials)(
  "T-20: integración real — obtenerEmailUsuario (equivalente, proyecto Supabase real)",
  () => {
    let adminClient: SupabaseClient;
    let userId: string | undefined;
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const testEmail = `qa-email-t20-${runId}@example.com`;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data, error } = await adminClient.auth.admin.createUser({
        email: testEmail,
        password: `Qa-Test-${runId}!`,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
      }
      userId = data.user.id;
    }, 30_000);

    afterAll(async () => {
      if (userId) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    }, 15_000);

    it(
      "auth.admin.getUserById (misma llamada que obtenerEmailUsuario) resuelve el email correcto de un userId real",
      async () => {
        const { data, error } = await adminClient.auth.admin.getUserById(
          userId!
        );
        expect(error).toBeNull();
        expect(data.user?.email).toBe(testEmail);
      },
      15_000
    );

    it(
      "auth.admin.getUserById con un userId inexistente retorna error (obtenerEmailUsuario debe mapear esto a null, no lanzar)",
      async () => {
        const { data, error } = await adminClient.auth.admin.getUserById(
          "00000000-0000-0000-0000-000000000000"
        );
        // Según la versión de supabase-js, un id inexistente puede venir
        // como `error` o como `data.user === null`; en ambos casos
        // `obtenerEmailUsuario` retorna `null` sin lanzar (ver test
        // estructural (1b) más arriba).
        expect(error !== null || data.user === null).toBe(true);
      },
      15_000
    );
  }
);

describe.skipIf(!hasResendCredentials)(
  "T-20: integración real — Resend (mismo remitente sandbox que lib/email.ts)",
  () => {
    // No se importa RESEND_API_KEY en ningún `console.log`/mensaje de
    // error de este archivo; solo se pasa al SDK de Resend.
    const resend = new Resend(RESEND_API_KEY);
    const REMITENTE_SANDBOX = "onboarding@resend.dev";

    it(
      "resend.emails.send NO lanza excepción (ni con éxito ni con rechazo por sandbox), igual que enviarEmailEvento",
      async () => {
        let threw = false;
        let outcome: { data: unknown; error: unknown } | undefined;

        try {
          outcome = await resend.emails.send({
            from: REMITENTE_SANDBOX,
            // Destinatario de prueba genérico: en modo sandbox (sin
            // dominio propio verificado) Resend rechaza cualquier
            // destinatario que no sea la casilla dueña de la cuenta, lo
            // cual es exactamente el escenario que enviarEmailEvento debe
            // tolerar sin lanzar.
            to: "qa-t20-destinatario-de-prueba@example.com",
            subject: "[QA T-20] prueba de envío (no debería entregarse)",
            html: "<p>Prueba de integración de QA para T-20, ver supabase/tests/email-t20.test.ts.</p>",
          });
        } catch {
          threw = true;
        }

        expect(
          threw,
          "el SDK de Resend lanzó una excepción; enviarEmailEvento (que usa el mismo await + destructuring de `{ error }`) debe seguir sin lanzar gracias a su try/catch, pero esto indicaría que el escenario de excepción sí puede ocurrir en la práctica"
        ).toBe(false);

        // La llamada resuelve (no lanza) con `{ data, error }`: si Resend
        // rechazó el envío (esperado en sandbox para un destinatario
        // ajeno), viene en `error.message` — exactamente lo que
        // `enviarEmailEvento` loguea con `console.error` sin propagar.
        expect(outcome).toBeDefined();
        expect(outcome).toHaveProperty("data");
        expect(outcome).toHaveProperty("error");
      },
      20_000
    );

    it(
      "resend.emails.send hacia la casilla oficial de pruebas de Resend (delivered@resend.dev) SÍ tiene éxito (data.id presente, error null), confirmando que la cuenta/API key funcionan de punta a punta",
      async () => {
        let threw = false;
        let outcome:
          | { data: { id?: string } | null; error: unknown }
          | undefined;

        try {
          outcome = await resend.emails.send({
            from: REMITENTE_SANDBOX,
            // Dirección de prueba documentada por Resend
            // (https://resend.com/docs/dashboard/emails/send-test-emails):
            // siempre acepta el envío sin necesidad de dominio verificado
            // ni de que sea la casilla dueña de la cuenta.
            to: "delivered@resend.dev",
            subject: "[QA T-20] prueba de envío exitoso",
            html: "<p>Prueba de integración de QA para T-20 (camino exitoso), ver supabase/tests/email-t20.test.ts.</p>",
          });
        } catch {
          threw = true;
        }

        expect(threw).toBe(false);
        expect(outcome?.error).toBeNull();
        expect(outcome?.data?.id).toBeTruthy();
      },
      20_000
    );
  }
);
