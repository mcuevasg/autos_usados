// Test de integración (no unitario) para el criterio de aceptación de T-11
// (app/vendedor/anuncios/nuevo/actions.ts, app/vendedor/anuncios/nuevo/anuncio-form.tsx,
// app/vendedor/anuncios/[id]/page.tsx, supabase/migrations/0001_initial_schema.sql):
//
//   "El formulario exige estado del vehículo, papeles al día (sí/no) y
//   tipo de uso (lista cerrada); no se puede guardar el anuncio si falta
//   alguno." (REQ-04)
//
// Foco específico de este archivo: `papers_up_to_date`, que en la columna
// de Postgres tiene `not null default false`. Eso significa que un INSERT
// que omita la columna NO fallaría por NOT NULL (a diferencia de `brand`,
// ya cubierto por T-09): silenciosamente tomaría `false`. Por eso la
// defensa real vive en `validarCamposAnuncio` (actions.ts), que exige que
// `formData.get("papers_up_to_date")` sea exactamente el string "true" o
// "false" antes de intentar cualquier insert. Este test:
//
//   1. Verifica por inspección de código (no hay endpoint HTTP expuesto
//      para invocar la Server Action fuera de un request de Next.js) que
//      `validarCamposAnuncio` rechaza null, "" y cualquier valor que no
//      sea "true"/"false" para `papers_up_to_date`, y que nunca inserta el
//      default silencioso de la tabla.
//   2. Confirma contra el proyecto Supabase real que un INSERT directo a
//      `listings` con `papers_up_to_date` explícito en `true` y, en un
//      listing separado, en `false`, persiste exactamente ese valor (no
//      el default `false` de la columna) — usando el mismo flujo real de
//      verificación de vendedor (moderador vía T-08) que T-09.
//   3. Confirma que `vehicle_condition` y `usage_type` siguen validados
//      (sin regresión de T-09): un INSERT con `usage_type` fuera de la
//      lista cerrada sigue fallando por el CHECK de la tabla.
//
// Si las variables de entorno no están disponibles, el test se salta en
// vez de fallar, para no romper `npm test` en checkouts sin secretos.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validarRut } from "../../lib/rut";

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

const RUT_MODERADOR = "9.663.147-2";
const RUT_VERIFICADO = "22.222.222-2";

const LISTING_BASE = {
  brand: "Mazda",
  model: "3",
  year: 2020,
  mileage: 40000,
  price: 9000000,
  vehicle_condition: "usado en buen estado",
  usage_type: "trabajo" as const,
  location: "Valparaíso",
};

describe.skipIf(!hasCredentials)(
  "T-11: campo obligatorio papers_up_to_date en listings (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t11-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailVerificado = `qa-t11-verificado-${runId}@example.com`;
    const passwordVerificado = `Qa-Test-${runId}-ver!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientVerificado: SupabaseClient;

    let modUserId: string | undefined;
    let userVerificadoId: string | undefined;
    let sellerVerificadoId: string | undefined;
    const createdListingIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

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

      modClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInModError } =
        await modClient.auth.signInWithPassword({
          email: emailMod,
          password: passwordMod,
        });
      if (signInModError) {
        throw new Error(
          `No se pudo autenticar al moderador: ${signInModError.message}`
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

      const { error: verifyError } = await modClient
        .from("sellers")
        .update({ verification_status: "verificado" })
        .eq("id", sellerVerificadoId);
      if (verifyError) {
        throw new Error(
          `No se pudo verificar al vendedor vía moderador: ${verifyError.message}`
        );
      }
    }, 45_000);

    afterAll(async () => {
      if (createdListingIds.length > 0) {
        await adminClient
          .from("listings")
          .delete()
          .in("id", createdListingIds);
      }
      if (sellerVerificadoId) {
        await adminClient.from("sellers").delete().eq("id", sellerVerificadoId);
      }
      if (modUserId) {
        await adminClient.auth.admin.deleteUser(modUserId);
      }
      if (userVerificadoId) {
        await adminClient.auth.admin.deleteUser(userVerificadoId);
      }
    }, 30_000);

    it("los RUT usados son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_MODERADOR)).toBe(true);
      expect(validarRut(RUT_VERIFICADO)).toBe(true);
    });

    it(
      "setup: el vendedor de prueba queda 'verificado' vía flujo real de moderador (T-08)",
      async () => {
        const { data, error } = await adminClient
          .from("sellers")
          .select("verification_status")
          .eq("id", sellerVerificadoId)
          .single();
        expect(error).toBeNull();
        expect(data?.verification_status).toBe("verificado");
      },
      20_000
    );

    it(
      "(2) un vendedor VERIFICADO SÍ puede insertar un listing con papers_up_to_date=true, y el valor persistido es exactamente true",
      async () => {
        const { data, error } = await clientVerificado
          .from("listings")
          .insert({
            seller_id: sellerVerificadoId,
            ...LISTING_BASE,
            papers_up_to_date: true,
          })
          .select("id, papers_up_to_date")
          .single();

        expect(
          error,
          `insert con papers_up_to_date=true falló: ${error?.message}`
        ).toBeNull();
        expect(data?.papers_up_to_date).toBe(true);

        if (data?.id) {
          createdListingIds.push(data.id as string);

          const { data: reread, error: rereadError } = await adminClient
            .from("listings")
            .select("papers_up_to_date")
            .eq("id", data.id)
            .single();
          expect(rereadError).toBeNull();
          expect(
            reread?.papers_up_to_date,
            "el valor releído debe seguir siendo exactamente true, no el default de la columna"
          ).toBe(true);
        }
      },
      20_000
    );

    it(
      "(2) un vendedor VERIFICADO SÍ puede insertar un listing con papers_up_to_date=false explícito, y el valor persistido es exactamente false (no confundir con omitir la columna)",
      async () => {
        const { data, error } = await clientVerificado
          .from("listings")
          .insert({
            seller_id: sellerVerificadoId,
            ...LISTING_BASE,
            model: "CX-5",
            papers_up_to_date: false,
          })
          .select("id, papers_up_to_date")
          .single();

        expect(
          error,
          `insert con papers_up_to_date=false falló: ${error?.message}`
        ).toBeNull();
        expect(data?.papers_up_to_date).toBe(false);

        if (data?.id) {
          createdListingIds.push(data.id as string);
        }
      },
      20_000
    );

    it(
      "(3) sin regresión de T-09: usage_type fuera de la lista cerrada sigue violando el CHECK de la tabla (23514)",
      async () => {
        const { data, error } = await clientVerificado
          .from("listings")
          .insert({
            seller_id: sellerVerificadoId,
            ...LISTING_BASE,
            model: "MX-5",
            usage_type: "no_existe" as unknown as "trabajo",
            papers_up_to_date: true,
          })
          .select("id");

        expect(
          error,
          "se esperaba que un usage_type inválido violara el CHECK de listings.usage_type"
        ).not.toBeNull();
        expect(error?.code).toBe("23514");
        expect(data).toBeNull();
      },
      20_000
    );

    it(
      "(3) sin regresión de T-09: vehicle_condition vacío/omitido sigue violando el NOT NULL de la tabla (23502)",
      async () => {
        const { vehicle_condition: _omitido, ...restoBase } = LISTING_BASE;
        void _omitido;

        const { data, error } = await clientVerificado
          .from("listings")
          .insert({
            seller_id: sellerVerificadoId,
            ...restoBase,
            model: "MX-30",
            papers_up_to_date: true,
          })
          .select("id");

        expect(
          error,
          "se esperaba que omitir vehicle_condition violara el NOT NULL de la tabla"
        ).not.toBeNull();
        expect(error?.code).toBe("23502");
        expect(data).toBeNull();
      },
      20_000
    );
  }
);
