// Test de integración (no unitario) para el criterio de aceptación de T-09
// (app/vendedor/anuncios/nuevo/page.tsx, app/vendedor/anuncios/nuevo/actions.ts,
// app/vendedor/anuncios/nuevo/anuncio-form.tsx, app/vendedor/anuncios/[id]/page.tsx,
// política RLS `listings_insert_own` de 0006_moderator_seller_review.sql y los
// CHECK/NOT NULL de `listings` en 0001_initial_schema.sql):
//
//   "Solo un vendedor en estado 'Verificado' puede crear un anuncio; el
//   formulario exige marca, modelo, año, kilometraje y precio, y no
//   permite guardar si falta alguno." (REQ-03)
//
// Cubre (ver instrucciones de la tarea QA):
//   1. Confirma quién puede cambiar `sellers.verification_status` a
//      'verificado': un update directo con service_role NO alcanza,
//      porque el trigger `sellers_protect_verification_status` (0007)
//      evalúa `auth.uid()`, que también es NULL bajo el rol service_role
//      (no lleva claim `sub`), así que se comporta igual que un usuario
//      no-moderador y bloquea el cambio. Hay que simular el flujo real
//      del moderador (T-08): un cliente autenticado cuyo `profiles.role`
//      es 'moderador'.
//   2. Autenticado como vendedor NO verificado ('pendiente'): insertar un
//      listing completo debe FALLAR por RLS (`listings_insert_own` exige
//      verificado), código 42501.
//   3. Autenticado como vendedor VERIFICADO: insertar un listing SIN
//      `brand` debe fallar por el NOT NULL constraint de la tabla
//      (defensa de BD, código 23502). Además se revisa en el reporte que
//      `actions.ts` valida esto mismo en servidor ANTES del insert.
//   4. Autenticado como vendedor VERIFICADO: insertar un listing completo
//      (brand, model, year, mileage, price, vehicle_condition,
//      usage_type, location) debe funcionar y quedar en
//      `status = 'borrador'` por defecto.
//   5. Casos inválidos de los 5 campos principales vía CHECK de BD:
//      year=1800 (year >= 1900), mileage=-1 (mileage >= 0), price=-1
//      (price >= 0), todos con código 23514 (check_violation).
//
// Este test corre contra el proyecto Supabase REAL (no un mock/local),
// siguiendo el mismo patrón que supabase/tests/moderador-vendedores-t08.test.ts
// y supabase/tests/vendedor-registro-t07.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/verificar/limpiar datos de
//     prueba sin pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba (moderador y vendedores) y
//     probar `sellers`/`listings` sujetos a RLS, tal como lo haría la app.
//
// Si las variables de entorno no están disponibles, el test se salta en
// vez de fallar, para no romper `npm test` en checkouts sin secretos.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validarRut } from "../../lib/rut";

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

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts), uno por vendedor.
const RUT_MODERADOR = "12.345.678-5";
const RUT_PENDIENTE = "10.000.013-K";
const RUT_VERIFICADO = "20.000.000-5";

const LISTING_BASE = {
  model: "Corolla",
  year: 2021,
  mileage: 15000,
  price: 12000000,
  vehicle_condition: "usado en buen estado",
  papers_up_to_date: true,
  usage_type: "familiar" as const,
  location: "Santiago",
};

describe.skipIf(!hasCredentials)(
  "T-09: formulario de creación de anuncio — RLS/constraints de listings (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t09-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailPendiente = `qa-t09-pendiente-${runId}@example.com`;
    const passwordPendiente = `Qa-Test-${runId}-pend!`;
    const emailVerificado = `qa-t09-verificado-${runId}@example.com`;
    const passwordVerificado = `Qa-Test-${runId}-ver!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientPendiente: SupabaseClient;
    let clientVerificado: SupabaseClient;

    let modUserId: string | undefined;
    let userPendienteId: string | undefined;
    let userVerificadoId: string | undefined;
    let sellerPendienteId: string | undefined;
    let sellerVerificadoId: string | undefined;
    const createdListingIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Moderador.
      const { data: modData, error: modError } =
        await adminClient.auth.admin.createUser({
          email: emailMod,
          password: passwordMod,
          email_confirm: true,
        });
      if (modError || !modData.user) {
        throw new Error(
          `No se pudo crear el usuario moderador: ${modError?.message}`
        );
      }
      modUserId = modData.user.id;

      const { error: promoteError } = await adminClient
        .from("profiles")
        .update({ role: "moderador" })
        .eq("id", modUserId);
      if (promoteError) {
        throw new Error(
          `No se pudo promover al usuario a moderador: ${promoteError.message}`
        );
      }

      // Vendedor pendiente (nunca queda verificado).
      const { data: userPendienteData, error: userPendienteError } =
        await adminClient.auth.admin.createUser({
          email: emailPendiente,
          password: passwordPendiente,
          email_confirm: true,
        });
      if (userPendienteError || !userPendienteData.user) {
        throw new Error(
          `No se pudo crear el vendedor pendiente: ${userPendienteError?.message}`
        );
      }
      userPendienteId = userPendienteData.user.id;

      // Vendedor a verificar.
      const { data: userVerificadoData, error: userVerificadoError } =
        await adminClient.auth.admin.createUser({
          email: emailVerificado,
          password: passwordVerificado,
          email_confirm: true,
        });
      if (userVerificadoError || !userVerificadoData.user) {
        throw new Error(
          `No se pudo crear el vendedor a verificar: ${userVerificadoError?.message}`
        );
      }
      userVerificadoId = userVerificadoData.user.id;

      // Clientes autenticados.
      modClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInModError } = await modClient.auth.signInWithPassword(
        { email: emailMod, password: passwordMod }
      );
      if (signInModError) {
        throw new Error(
          `No se pudo autenticar al moderador: ${signInModError.message}`
        );
      }

      clientPendiente = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInPendienteError } =
        await clientPendiente.auth.signInWithPassword({
          email: emailPendiente,
          password: passwordPendiente,
        });
      if (signInPendienteError) {
        throw new Error(
          `No se pudo autenticar al vendedor pendiente: ${signInPendienteError.message}`
        );
      }

      clientVerificado = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInVerificadoError } =
        await clientVerificado.auth.signInWithPassword({
          email: emailVerificado,
          password: passwordVerificado,
        });
      if (signInVerificadoError) {
        throw new Error(
          `No se pudo autenticar al vendedor a verificar: ${signInVerificadoError.message}`
        );
      }

      // Sellers en estado 'pendiente' vía service_role (INSERT con
      // verification_status='pendiente' está permitido para cualquier
      // rol por el trigger de 0008; ya probado exhaustivamente en T-07).
      const { data: sellerPendienteData, error: sellerPendienteError } =
        await adminClient
          .from("sellers")
          .insert({
            user_id: userPendienteId,
            seller_type: "persona_natural",
            rut: RUT_PENDIENTE,
            verification_status: "pendiente",
          })
          .select("id")
          .single();
      if (sellerPendienteError || !sellerPendienteData) {
        throw new Error(
          `No se pudo crear el seller pendiente: ${sellerPendienteError?.message}`
        );
      }
      sellerPendienteId = sellerPendienteData.id as string;

      const { data: sellerVerificadoData, error: sellerVerificadoError } =
        await adminClient
          .from("sellers")
          .insert({
            user_id: userVerificadoId,
            seller_type: "persona_natural",
            rut: RUT_VERIFICADO,
            verification_status: "pendiente",
          })
          .select("id")
          .single();
      if (sellerVerificadoError || !sellerVerificadoData) {
        throw new Error(
          `No se pudo crear el seller a verificar: ${sellerVerificadoError?.message}`
        );
      }
      sellerVerificadoId = sellerVerificadoData.id as string;
    }, 45_000);

    afterAll(async () => {
      // Limpieza vía service_role (bypassa RLS), best-effort.
      if (createdListingIds.length > 0) {
        await adminClient.from("listings").delete().in("id", createdListingIds);
      }
      if (sellerPendienteId) {
        await adminClient.from("sellers").delete().eq("id", sellerPendienteId);
      }
      if (sellerVerificadoId) {
        await adminClient.from("sellers").delete().eq("id", sellerVerificadoId);
      }
      if (modUserId) {
        await adminClient.auth.admin.deleteUser(modUserId);
      }
      if (userPendienteId) {
        await adminClient.auth.admin.deleteUser(userPendienteId);
      }
      if (userVerificadoId) {
        await adminClient.auth.admin.deleteUser(userVerificadoId);
      }
    }, 30_000);

    it("los RUT usados son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_MODERADOR)).toBe(true);
      expect(validarRut(RUT_PENDIENTE)).toBe(true);
      expect(validarRut(RUT_VERIFICADO)).toBe(true);
    });

    it(
      "(1) service_role NO puede cambiar verification_status a 'verificado' directamente (auth.uid() es NULL bajo service_role, igual que un no-moderador; trigger 0007 lo bloquea)",
      async () => {
        const { data, error } = await adminClient
          .from("sellers")
          .update({ verification_status: "verificado" })
          .eq("id", sellerVerificadoId)
          .select("id, verification_status");

        expect(
          error,
          "se esperaba que el trigger sellers_protect_verification_status bloqueara también a service_role"
        ).not.toBeNull();
        expect(error?.message ?? "").toContain(
          "Solo un moderador puede cambiar verification_status."
        );
        expect(data).toBeNull();

        const { data: check, error: checkError } = await adminClient
          .from("sellers")
          .select("verification_status")
          .eq("id", sellerVerificadoId)
          .single();
        expect(checkError).toBeNull();
        expect(check?.verification_status).toBe("pendiente");
      },
      20_000
    );

    it(
      "(1) el moderador SÍ puede verificar al vendedor (sellers_update_moderator, flujo real de T-08)",
      async () => {
        const { data, error } = await modClient
          .from("sellers")
          .update({ verification_status: "verificado" })
          .eq("id", sellerVerificadoId)
          .select("id, verification_status")
          .single();

        expect(error, `update a 'verificado' falló: ${error?.message}`).toBeNull();
        expect(data?.verification_status).toBe("verificado");
      },
      20_000
    );

    it(
      "(2) un vendedor NO verificado ('pendiente') NO puede insertar un listing completo (listings_insert_own exige verificado, 42501)",
      async () => {
        const { data, error } = await clientPendiente
          .from("listings")
          .insert({
            seller_id: sellerPendienteId,
            brand: "Nissan",
            ...LISTING_BASE,
          })
          .select("id");

        expect(
          error,
          "se esperaba un error de RLS al insertar un listing con un seller no verificado"
        ).not.toBeNull();
        expect(error?.code).toBe("42501");
        expect(data).toBeNull();

        const { data: check } = await adminClient
          .from("listings")
          .select("id")
          .eq("seller_id", sellerPendienteId);
        expect(
          check,
          "no debería haber quedado ningún listing fantasma para el seller pendiente"
        ).toHaveLength(0);
      },
      20_000
    );

    it(
      "(3) un vendedor VERIFICADO NO puede insertar un listing SIN brand: falla por NOT NULL constraint de BD (23502), defensa de última línea",
      async () => {
        // Se omite `brand` intencionalmente para probar el NOT NULL
        // constraint de la tabla `listings` (el cliente Supabase no está
        // tipado contra el esquema generado, así que TypeScript no marca
        // esto como error; la validación real ocurre en Postgres).
        const { data, error } = await clientVerificado
          .from("listings")
          .insert({
            seller_id: sellerVerificadoId,
            ...LISTING_BASE,
          })
          .select("id");

        expect(
          error,
          "se esperaba que faltar brand violara el NOT NULL de la tabla listings"
        ).not.toBeNull();
        expect(error?.code).toBe("23502");
        expect(data).toBeNull();
      },
      20_000
    );

    it(
      "(4) un vendedor VERIFICADO SÍ puede insertar un listing completo, quedando en status='borrador' por defecto",
      async () => {
        const { data, error } = await clientVerificado
          .from("listings")
          .insert({
            seller_id: sellerVerificadoId,
            brand: "Toyota",
            ...LISTING_BASE,
          })
          .select(
            "id, seller_id, brand, model, year, mileage, price, status"
          )
          .single();

        expect(
          error,
          `insert de listing con seller verificado falló: ${error?.message}`
        ).toBeNull();
        expect(data?.seller_id).toBe(sellerVerificadoId);
        expect(data?.brand).toBe("Toyota");
        expect(data?.status).toBe("borrador");

        if (data?.id) {
          createdListingIds.push(data.id as string);
        }
      },
      20_000
    );

    it(
      "(5) year=1800 viola el CHECK year >= 1900 (23514)",
      async () => {
        const { data, error } = await clientVerificado
          .from("listings")
          .insert({
            seller_id: sellerVerificadoId,
            brand: "Toyota",
            ...LISTING_BASE,
            year: 1800,
          })
          .select("id");

        expect(error, "se esperaba una violación del CHECK year >= 1900").not.toBeNull();
        expect(error?.code).toBe("23514");
        expect(data).toBeNull();
      },
      20_000
    );

    it(
      "(5) mileage=-1 viola el CHECK mileage >= 0 (23514)",
      async () => {
        const { data, error } = await clientVerificado
          .from("listings")
          .insert({
            seller_id: sellerVerificadoId,
            brand: "Toyota",
            ...LISTING_BASE,
            mileage: -1,
          })
          .select("id");

        expect(error, "se esperaba una violación del CHECK mileage >= 0").not.toBeNull();
        expect(error?.code).toBe("23514");
        expect(data).toBeNull();
      },
      20_000
    );

    it(
      "(5) price=-1 viola el CHECK price >= 0 (23514)",
      async () => {
        const { data, error } = await clientVerificado
          .from("listings")
          .insert({
            seller_id: sellerVerificadoId,
            brand: "Toyota",
            ...LISTING_BASE,
            price: -1,
          })
          .select("id");

        expect(error, "se esperaba una violación del CHECK price >= 0").not.toBeNull();
        expect(error?.code).toBe("23514");
        expect(data).toBeNull();
      },
      20_000
    );
  }
);
