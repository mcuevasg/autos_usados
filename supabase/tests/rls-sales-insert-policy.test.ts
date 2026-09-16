// Test de integración (no unitario) para el criterio de aceptación de la
// migración 0003_fix_sales_insert_policy.sql:
//
//   La política `sales_insert_own` debe exigir, además del check de dueño
//   del listing, que el insert tenga `status = 'pendiente_aprobacion'` y
//   `commission is null`. Antes de la corrección, solo se validaba el
//   dueño, permitiendo que un vendedor se auto-aprobara una venta con una
//   comisión arbitraria.
//
// Este test corre contra el proyecto Supabase REAL (no un mock/local),
// usando:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/limpiar datos de prueba
//     (usuario, seller, listing, sale) sin pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como el usuario de prueba y probar el insert en `sales`
//     sujeto a RLS, tal como lo haría la app.
//
// Si las variables de entorno no están disponibles (ej. en un entorno de
// CI sin secretos configurados), el test se salta en vez de fallar, para
// no romper `npm test` en checkouts donde no se puede hablar con Supabase.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Carga `.env.local` directamente a `process.env` si existe, sin imprimir
 * ni loguear su contenido. Esto es necesario porque `vitest run` (a
 * diferencia de Next.js) no carga `.env.local` automáticamente.
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
    // Quita comillas envolventes si existen.
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

describe.skipIf(!hasCredentials)(
  "RLS sales_insert_own (0003_fix_sales_insert_policy.sql) — proyecto Supabase real",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const testEmail = `qa-rls-sales-${runId}@example.com`;
    const testPassword = `Qa-Test-${runId}!`;

    let adminClient: SupabaseClient;
    let anonAuthedClient: SupabaseClient;

    let userId: string | undefined;
    let sellerId: string | undefined;
    let listingId: string | undefined;
    const createdSaleIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // 1. Usuario de prueba (auth.users) vía service_role.
      const { data: userData, error: userError } =
        await adminClient.auth.admin.createUser({
          email: testEmail,
          password: testPassword,
          email_confirm: true,
        });
      if (userError || !userData.user) {
        throw new Error(
          `No se pudo crear el usuario de prueba: ${userError?.message}`
        );
      }
      userId = userData.user.id;

      // Seller para ese usuario.
      const { data: sellerData, error: sellerError } = await adminClient
        .from("sellers")
        .insert({
          user_id: userId,
          seller_type: "persona_natural",
          rut: "11.111.111-1",
          verification_status: "pendiente",
        })
        .select("id")
        .single();
      if (sellerError || !sellerData) {
        throw new Error(
          `No se pudo crear el seller de prueba: ${sellerError?.message}`
        );
      }
      sellerId = sellerData.id as string;

      // Listing propio de ese seller.
      const { data: listingData, error: listingError } = await adminClient
        .from("listings")
        .insert({
          seller_id: sellerId,
          brand: "Toyota",
          model: "Yaris",
          year: 2020,
          mileage: 30000,
          price: 8000000,
          vehicle_condition: "usado",
          papers_up_to_date: true,
          usage_type: "familiar",
          location: "Santiago",
          status: "publicado",
        })
        .select("id")
        .single();
      if (listingError || !listingData) {
        throw new Error(
          `No se pudo crear el listing de prueba: ${listingError?.message}`
        );
      }
      listingId = listingData.id as string;

      // 2. Cliente autenticado como el usuario de prueba (anon key +
      // signInWithPassword), tal como lo usaría la app.
      anonAuthedClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInError } =
        await anonAuthedClient.auth.signInWithPassword({
          email: testEmail,
          password: testPassword,
        });
      if (signInError) {
        throw new Error(
          `No se pudo autenticar al usuario de prueba: ${signInError.message}`
        );
      }
    }, 30_000);

    afterAll(async () => {
      // Limpieza vía service_role (bypassa RLS), en orden inverso de FKs.
      if (createdSaleIds.length > 0) {
        await adminClient.from("sales").delete().in("id", createdSaleIds);
      }
      if (listingId) {
        await adminClient.from("listings").delete().eq("id", listingId);
      }
      if (sellerId) {
        await adminClient.from("sellers").delete().eq("id", sellerId);
      }
      if (userId) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    }, 30_000);

    it(
      "RECHAZA un insert auto-aprobado con comisión arbitraria (status='aprobada', commission=999999)",
      async () => {
        const { data, error } = await anonAuthedClient
          .from("sales")
          .insert({
            listing_id: listingId,
            final_price: 7500000,
            status: "aprobada",
            commission: 999999,
          })
          .select("id");

        expect(
          error,
          "se esperaba un error de RLS (row-level security policy), pero el insert tuvo éxito"
        ).not.toBeNull();
        expect(data).toBeNull();
        // Error típico de Postgres/PostgREST al violar un `with check` de RLS.
        expect(error?.code).toBe("42501");
        expect(error?.message.toLowerCase()).toContain("row-level security");
      },
      15_000
    );

    it(
      "PERMITE un insert válido propio en estado pendiente_aprobacion sin comisión",
      async () => {
        const { data, error } = await anonAuthedClient
          .from("sales")
          .insert({
            listing_id: listingId,
            final_price: 7500000,
            status: "pendiente_aprobacion",
            commission: null,
          })
          .select("id, status, commission")
          .single();

        expect(error, `insert válido falló: ${error?.message}`).toBeNull();
        expect(data).not.toBeNull();
        expect(data?.status).toBe("pendiente_aprobacion");
        expect(data?.commission).toBeNull();

        if (data?.id) {
          createdSaleIds.push(data.id as string);
        }
      },
      15_000
    );
  }
);
