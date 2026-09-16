// Test de integración (no unitario) para el criterio de aceptación de T-05
// (supabase/migrations/0004_profiles_and_roles.sql):
//
//   "Un usuario puede registrarse e iniciar sesión vía Supabase Auth, y
//   queda asociado a uno de los roles: comprador, vendedor, moderador."
//
// Cubre:
//   1. Crear un usuario en auth.users dispara el trigger `handle_new_user`,
//      que crea automáticamente su fila en `public.profiles` con
//      role='comprador'.
//   2. auth.signInWithPassword funciona con las credenciales registradas
//      (login real vía Supabase Auth).
//   3. El propio usuario autenticado puede leer su fila (`profiles_select_own`).
//   4. El propio usuario NO puede auto-promoverse (no hay política de
//      update para 'authenticated': el update debe fallar o no afectar filas).
//   5. El propio usuario NO puede leer el profile de otro usuario (RLS).
//   6. (Best-effort) el flujo público real `auth.signUp` (el que usa
//      app/registro/actions.ts) también crea el usuario y su profile.
//      Esta prueba se salta (no falla la suite) si el proveedor de email
//      incluido en el tier gratuito de Supabase responde con rate limit o
//      rechaza el dominio del correo de prueba, ya que es una limitación
//      de infraestructura externa al código de la app, no un defecto del
//      trigger/RLS de T-05 (que sí se prueba exhaustivamente en los
//      puntos 1-5 usando un usuario creado vía service_role, sin depender
//      del envío de emails).
//
// Este test corre contra el proyecto Supabase REAL (no un mock/local),
// usando el mismo patrón que supabase/tests/rls-sales-insert-policy.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/verificar/limpiar datos de
//     prueba (usuarios, profiles) sin pasar por RLS ni por el envío de
//     emails de confirmación.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba y probar `profiles` sujeto a
//     RLS, tal como lo haría la app.
//
// Si las variables de entorno no están disponibles, el test se salta en
// vez de fallar, para no romper `npm test` en checkouts sin secretos.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Carga `.env.local` directamente a `process.env` si existe, sin imprimir
 * ni loguear su contenido. Necesario porque `vitest run` no carga
 * `.env.local` automáticamente (a diferencia de Next.js).
 */
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
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasCredentials = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY
);

// Códigos de error de auth conocidos y externos al código de la app
// (proveedor de email del tier gratuito de Supabase), que no deben hacer
// fallar la suite si aparecen en el intento de signUp público real.
const AUTH_INFRA_ERROR_CODES = new Set([
  "over_email_send_rate_limit",
  "email_address_invalid",
]);

describe.skipIf(!hasCredentials)(
  "T-05: registro/login con roles vía Supabase Auth (0004_profiles_and_roles.sql) — proyecto Supabase real",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const testEmailA = `qa-profiles-a-${runId}@example.com`;
    const testPasswordA = `Qa-Test-${runId}!`;
    const testEmailB = `qa-profiles-b-${runId}@example.com`;
    const testPasswordB = `Qa-Test-${runId}-b!`;

    let adminClient: SupabaseClient;
    let userAId: string | undefined;
    let userBId: string | undefined;
    let signUpUserId: string | undefined;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Usuario A: creado vía service_role (auth.admin.createUser), con
      // `email_confirm: true` para poder iniciar sesión inmediatamente sin
      // depender del envío de un email de confirmación (evita el rate
      // limit del proveedor de email del tier gratuito). Esto inserta en
      // `auth.users` exactamente igual que `auth.signUp`, disparando el
      // mismo trigger `handle_new_user`.
      const { data: userAData, error: userAError } =
        await adminClient.auth.admin.createUser({
          email: testEmailA,
          password: testPasswordA,
          email_confirm: true,
        });
      if (userAError || !userAData.user) {
        throw new Error(
          `No se pudo crear el usuario de prueba A: ${userAError?.message}`
        );
      }
      userAId = userAData.user.id;
    }, 30_000);

    afterAll(async () => {
      // Limpieza vía service_role. Los profiles se borran en cascada al
      // borrar el usuario (on delete cascade en profiles.id -> auth.users.id).
      if (userAId) {
        await adminClient.auth.admin.deleteUser(userAId);
      }
      if (userBId) {
        await adminClient.auth.admin.deleteUser(userBId);
      }
      if (signUpUserId) {
        await adminClient.auth.admin.deleteUser(signUpUserId);
      }
    }, 30_000);

    it(
      "crear el usuario dispara el trigger handle_new_user y crea su profile con role='comprador'",
      async () => {
        const { data: profile, error: profileError } = await adminClient
          .from("profiles")
          .select("id, role")
          .eq("id", userAId)
          .maybeSingle();

        expect(
          profileError,
          `error leyendo profile como service_role: ${profileError?.message}`
        ).toBeNull();
        expect(
          profile,
          "el trigger handle_new_user no creó la fila en public.profiles"
        ).not.toBeNull();
        expect(profile?.role).toBe("comprador");
      },
      20_000
    );

    it(
      "auth.signInWithPassword funciona con las credenciales registradas (login real vía Supabase Auth)",
      async () => {
        const anonClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const { data, error } = await anonClient.auth.signInWithPassword({
          email: testEmailA,
          password: testPasswordA,
        });

        expect(error, `signInWithPassword falló: ${error?.message}`).toBeNull();
        expect(data.session).not.toBeNull();
        expect(data.user?.id).toBe(userAId);
      },
      20_000
    );

    it(
      "el usuario autenticado puede leer su propia fila en profiles (role='comprador')",
      async () => {
        const anonAuthedClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error: signInError } =
          await anonAuthedClient.auth.signInWithPassword({
            email: testEmailA,
            password: testPasswordA,
          });
        expect(signInError).toBeNull();

        const { data, error } = await anonAuthedClient
          .from("profiles")
          .select("*")
          .eq("id", userAId);

        expect(error, `select propio falló: ${error?.message}`).toBeNull();
        expect(data).toHaveLength(1);
        expect(data?.[0]?.role).toBe("comprador");
      },
      20_000
    );

    it(
      "el usuario autenticado NO puede auto-promoverse a moderador (sin política de update)",
      async () => {
        const anonAuthedClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error: signInError } =
          await anonAuthedClient.auth.signInWithPassword({
            email: testEmailA,
            password: testPasswordA,
          });
        expect(signInError).toBeNull();

        const { data, error } = await anonAuthedClient
          .from("profiles")
          .update({ role: "moderador" })
          .eq("id", userAId)
          .select("id, role");

        // PostgREST con RLS sin política de update para 'authenticated'
        // puede responder con éxito pero 0 filas afectadas (el `where`
        // resultante de la policy filtra todo), en vez de un error 42501.
        // Cualquiera de los dos comportamientos es aceptable siempre que
        // el rol NO cambie.
        if (error) {
          expect(error.code === "42501" || error.message.length > 0).toBe(true);
        } else {
          expect(
            data,
            "el update no debería afectar ninguna fila (no hay política de update)"
          ).toHaveLength(0);
        }

        // Confirmación definitiva vía service_role: el rol sigue siendo
        // 'comprador', el usuario NO logró auto-promoverse.
        const { data: profileAfter, error: profileAfterError } =
          await adminClient
            .from("profiles")
            .select("role")
            .eq("id", userAId)
            .single();

        expect(profileAfterError).toBeNull();
        expect(
          profileAfter?.role,
          "el usuario logró auto-promoverse: violación crítica de RLS"
        ).toBe("comprador");
      },
      20_000
    );

    it(
      "el usuario autenticado NO puede leer el profile de OTRO usuario",
      async () => {
        // Crea un segundo usuario (B) vía admin, para tener otro id
        // distinto cuyo profile el usuario A intentará leer.
        const { data: userBData, error: userBError } =
          await adminClient.auth.admin.createUser({
            email: testEmailB,
            password: testPasswordB,
            email_confirm: true,
          });
        expect(
          userBError,
          `no se pudo crear usuario B: ${userBError?.message}`
        ).toBeNull();
        userBId = userBData.user?.id;
        expect(userBId).toBeDefined();

        const anonAuthedClientA = createClient(
          SUPABASE_URL!,
          SUPABASE_ANON_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );
        const { error: signInError } =
          await anonAuthedClientA.auth.signInWithPassword({
            email: testEmailA,
            password: testPasswordA,
          });
        expect(signInError).toBeNull();

        const { data, error } = await anonAuthedClientA
          .from("profiles")
          .select("*")
          .eq("id", userBId);

        expect(error, `select cruzado falló con error: ${error?.message}`).toBeNull();
        expect(
          data,
          "RLS debería impedir leer el profile de otro usuario"
        ).toHaveLength(0);
      },
      20_000
    );

    it(
      "(best-effort) el flujo público real auth.signUp también crea el usuario y su profile",
      async (ctx) => {
        const anonClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        // Dominio real (alias +) para minimizar el riesgo de que el
        // proveedor de email rechace el dominio por no ser entregable;
        // igual puede toparse con el rate limit del tier gratuito.
        const signUpEmail = `mcuevasg+qa-t05-${runId}@gmail.com`;
        const signUpPassword = `Qa-Test-${runId}-signup!`;

        const { data, error } = await anonClient.auth.signUp({
          email: signUpEmail,
          password: signUpPassword,
        });

        if (error && AUTH_INFRA_ERROR_CODES.has(error.code ?? "")) {
          ctx.skip(
            `auth.signUp real omitido: limitación de infraestructura externa del proveedor de email (${error.code}: ${error.message}), no del código de T-05.`
          );
          return;
        }

        expect(error, `signUp falló: ${error?.message}`).toBeNull();
        expect(data.user).not.toBeNull();
        signUpUserId = data.user!.id;

        const { data: profile, error: profileError } = await adminClient
          .from("profiles")
          .select("id, role")
          .eq("id", signUpUserId)
          .maybeSingle();

        expect(profileError).toBeNull();
        expect(profile).not.toBeNull();
        expect(profile?.role).toBe("comprador");
      },
      20_000
    );
  }
);
