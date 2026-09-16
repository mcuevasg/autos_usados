// Test de QA (regresión del hallazgo BLOQUEANTE de T-17): cierre del gap de
// INSERT sobre el plan "Destacado".
//
// Hallazgo original: `listings_protect_featured_activation`
// (0015_featured_listings.sql) solo se registró `before update`. La
// política `listings_insert_own` no restringe `featured_active` ni
// `featured_expires_at`, así que un vendedor (cualquiera, incluida una
// persona_natural, sin importar el estado del anuncio) podía insertar un
// listing NUEVO ya con `featured_active: true` y `featured_expires_at`
// arbitrario, bypaseando por completo el trigger de T-17 (que nunca corría
// en el camino de creación).
//
// Fix bajo prueba: supabase/migrations/0016_featured_activation_insert_guard.sql
// agrega el trigger `listings_protect_featured_activation_insert`
// (BEFORE INSERT) que fuerza siempre `featured_active := false` y
// `featured_expires_at := null` en cualquier INSERT, sin importar qué envíe
// el cliente.
//
// Esta suite ejerce el INSERT directamente (igual que la Server Action de
// creación de anuncio, T-09, terminaría haciendo bajo RLS), sin pasar por
// Next.js, contra el proyecto Supabase REAL (no un mock/local):
//
//   1. Setup: un vendedor CONCESIONARIO verificado (flujo real de
//      moderador, igual que T-08/T-12/T-17) y, por completitud, un
//      vendedor PERSONA_NATURAL verificado — el hallazgo original no
//      distinguía seller_type porque el trigger de INSERT no valida quién
//      inserta, solo neutraliza las columnas.
//   2. Cada vendedor INSERTA un listing nuevo enviando explícitamente
//      `featured_active: true` y `featured_expires_at` en una fecha muy
//      futura arbitraria, junto con el resto de campos requeridos
//      (`status` no se envía: nace en 'borrador' por default, dueño
//      correcto vía `seller_id`).
//   3. El INSERT debe tener ÉXITO (el resto de columnas son válidas y las
//      demás políticas/triggers lo permiten), pero la fila insertada (tanto
//      en el `.select()` del propio insert como al releerla después) debe
//      mostrar `featured_active: false` y `featured_expires_at: null`,
//      pase lo que pase con lo enviado.
//
// Sigue el mismo patrón (carga de .env.local, skip sin credenciales, setup
// vía service_role + flujo real de verificación por moderador) que
// supabase/tests/destacar-t17.test.ts.
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

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts), no reutilizados en
// otras suites (sellers.rut no tiene constraint de unicidad, pero se evita
// colisión de todos modos).
const RUT_MODERADOR = "12.345.678-5";
const RUT_CONCESIONARIO = "9.000.066-7";
const RUT_PERSONA_NATURAL = "18.000.066-6";

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

// Fecha muy futura arbitraria, deliberadamente incorrecta (nada que ver con
// "ahora + 30 días"): confirma que el trigger de INSERT la neutraliza sin
// importar el valor enviado.
const FECHA_ARBITRARIA_MUY_FUTURA = "2099-12-31T00:00:00.000Z";

describe.skipIf(!hasCredentials)(
  "T-17 (fix bloqueante): trigger BEFORE INSERT neutraliza featured_active/featured_expires_at en el INSERT (proyecto Supabase real, 0016)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t17ins-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailConce = `qa-t17ins-conce-${runId}@example.com`;
    const passwordConce = `Qa-Test-${runId}-c!`;
    const emailPersona = `qa-t17ins-persona-${runId}@example.com`;
    const passwordPersona = `Qa-Test-${runId}-p!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientConce: SupabaseClient;
    let clientPersona: SupabaseClient;

    let modUserId: string | undefined;
    let userConceId: string | undefined;
    let userPersonaId: string | undefined;
    let sellerConceId: string | undefined;
    let sellerPersonaId: string | undefined;

    let listingConceId: string | undefined;
    let listingPersonaId: string | undefined;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Moderador (necesario para verificar a los sellers, flujo real T-08).
      const { data: modData, error: modError } =
        await adminClient.auth.admin.createUser({
          email: emailMod,
          password: passwordMod,
          email_confirm: true,
        });
      if (modError || !modData.user) {
        throw new Error(`No se pudo crear el moderador: ${modError?.message}`);
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

      // Vendedor concesionario.
      const { data: conceData, error: conceError } =
        await adminClient.auth.admin.createUser({
          email: emailConce,
          password: passwordConce,
          email_confirm: true,
        });
      if (conceError || !conceData.user) {
        throw new Error(
          `No se pudo crear el vendedor concesionario: ${conceError?.message}`
        );
      }
      userConceId = conceData.user.id;

      // Vendedor persona_natural.
      const { data: personaData, error: personaError } =
        await adminClient.auth.admin.createUser({
          email: emailPersona,
          password: passwordPersona,
          email_confirm: true,
        });
      if (personaError || !personaData.user) {
        throw new Error(
          `No se pudo crear el vendedor persona_natural: ${personaError?.message}`
        );
      }
      userPersonaId = personaData.user.id;

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

      clientConce = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInConceError } =
        await clientConce.auth.signInWithPassword({
          email: emailConce,
          password: passwordConce,
        });
      if (signInConceError) {
        throw new Error(
          `No se pudo autenticar al concesionario: ${signInConceError.message}`
        );
      }

      clientPersona = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInPersonaError } =
        await clientPersona.auth.signInWithPassword({
          email: emailPersona,
          password: passwordPersona,
        });
      if (signInPersonaError) {
        throw new Error(
          `No se pudo autenticar a la persona_natural: ${signInPersonaError.message}`
        );
      }

      // Seller concesionario: 'pendiente' vía service_role, verificado por
      // el moderador autenticado (flujo real de T-08).
      const { data: sellerConceData, error: sellerConceError } =
        await adminClient
          .from("sellers")
          .insert({
            user_id: userConceId,
            seller_type: "concesionario",
            rut: RUT_CONCESIONARIO,
            verification_status: "pendiente",
          })
          .select("id")
          .single();
      if (sellerConceError || !sellerConceData) {
        throw new Error(
          `No se pudo crear el seller concesionario: ${sellerConceError?.message}`
        );
      }
      sellerConceId = sellerConceData.id as string;

      const { error: verifyConceError } = await modClient
        .from("sellers")
        .update({ verification_status: "verificado" })
        .eq("id", sellerConceId);
      if (verifyConceError) {
        throw new Error(
          `El moderador no pudo verificar al seller concesionario: ${verifyConceError.message}`
        );
      }

      // Seller persona_natural: mismo flujo.
      const { data: sellerPersonaData, error: sellerPersonaError } =
        await adminClient
          .from("sellers")
          .insert({
            user_id: userPersonaId,
            seller_type: "persona_natural",
            rut: RUT_PERSONA_NATURAL,
            verification_status: "pendiente",
          })
          .select("id")
          .single();
      if (sellerPersonaError || !sellerPersonaData) {
        throw new Error(
          `No se pudo crear el seller persona_natural: ${sellerPersonaError?.message}`
        );
      }
      sellerPersonaId = sellerPersonaData.id as string;

      const { error: verifyPersonaError } = await modClient
        .from("sellers")
        .update({ verification_status: "verificado" })
        .eq("id", sellerPersonaId);
      if (verifyPersonaError) {
        throw new Error(
          `El moderador no pudo verificar al seller persona_natural: ${verifyPersonaError.message}`
        );
      }
    }, 60_000);

    afterAll(async () => {
      // Limpieza best-effort vía service_role.
      for (const id of [listingConceId, listingPersonaId]) {
        if (id) {
          await adminClient.from("listings").delete().eq("id", id);
        }
      }
      if (sellerConceId) {
        await adminClient.from("sellers").delete().eq("id", sellerConceId);
      }
      if (sellerPersonaId) {
        await adminClient.from("sellers").delete().eq("id", sellerPersonaId);
      }
      if (modUserId) {
        await adminClient.auth.admin.deleteUser(modUserId);
      }
      if (userConceId) {
        await adminClient.auth.admin.deleteUser(userConceId);
      }
      if (userPersonaId) {
        await adminClient.auth.admin.deleteUser(userPersonaId);
      }
    }, 30_000);

    it("los RUT usados son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_MODERADOR)).toBe(true);
      expect(validarRut(RUT_CONCESIONARIO)).toBe(true);
      expect(validarRut(RUT_PERSONA_NATURAL)).toBe(true);
    });

    it(
      "(vector reproducido y cerrado) un concesionario verificado INSERTA un listing nuevo enviando featured_active=true y featured_expires_at muy futuro: el INSERT tiene éxito, pero la fila queda con featured_active=false y featured_expires_at=null",
      async () => {
        const { data, error } = await clientConce
          .from("listings")
          .insert({
            seller_id: sellerConceId,
            brand: "Toyota",
            ...LISTING_BASE,
            featured_active: true,
            featured_expires_at: FECHA_ARBITRARIA_MUY_FUTURA,
          })
          .select("id, status, seller_id, featured_active, featured_expires_at")
          .single();

        expect(
          error,
          `se esperaba que el INSERT tuviera éxito (los demás campos son válidos): ${error?.message}`
        ).toBeNull();
        expect(data).not.toBeNull();
        listingConceId = data!.id as string;

        // El resto de columnas se insertaron con normalidad (el trigger no
        // afecta nada más que las dos columnas del plan destacado).
        expect(data!.status).toBe("borrador");
        expect(data!.seller_id).toBe(sellerConceId);

        // El corazón del fix: el trigger BEFORE INSERT neutralizó ambos
        // valores, sin importar lo enviado, ya en la respuesta del propio
        // insert.
        expect(
          data!.featured_active,
          "featured_active debía quedar en false pese a haberse enviado true en el INSERT"
        ).toBe(false);
        expect(
          data!.featured_expires_at,
          "featured_expires_at debía quedar en null pese a haberse enviado una fecha futura arbitraria en el INSERT"
        ).toBeNull();

        // Se relee la fila de forma independiente (no solo el .select()
        // encadenado al propio insert) vía service_role, para confirmar que
        // lo persistido en la base es lo mismo, no un artefacto del cliente.
        const { data: releida, error: releidaError } = await adminClient
          .from("listings")
          .select("featured_active, featured_expires_at")
          .eq("id", listingConceId)
          .single();
        expect(releidaError).toBeNull();
        expect(releida?.featured_active).toBe(false);
        expect(releida?.featured_expires_at).toBeNull();
      },
      30_000
    );

    it(
      "(mismo vector, persona_natural) el trigger de INSERT neutraliza featured_active/featured_expires_at sin importar seller_type (no valida QUIÉN inserta, solo neutraliza)",
      async () => {
        const { data, error } = await clientPersona
          .from("listings")
          .insert({
            seller_id: sellerPersonaId,
            brand: "Mazda",
            ...LISTING_BASE,
            featured_active: true,
            featured_expires_at: FECHA_ARBITRARIA_MUY_FUTURA,
          })
          .select("id, status, seller_id, featured_active, featured_expires_at")
          .single();

        expect(
          error,
          `se esperaba que el INSERT tuviera éxito: ${error?.message}`
        ).toBeNull();
        expect(data).not.toBeNull();
        listingPersonaId = data!.id as string;

        expect(data!.status).toBe("borrador");
        expect(data!.seller_id).toBe(sellerPersonaId);
        expect(data!.featured_active).toBe(false);
        expect(data!.featured_expires_at).toBeNull();

        const { data: releida, error: releidaError } = await adminClient
          .from("listings")
          .select("featured_active, featured_expires_at")
          .eq("id", listingPersonaId)
          .single();
        expect(releidaError).toBeNull();
        expect(releida?.featured_active).toBe(false);
        expect(releida?.featured_expires_at).toBeNull();
      },
      30_000
    );
  }
);
