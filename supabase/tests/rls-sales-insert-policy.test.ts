// Test de integración (no unitario) para el criterio de aceptación de las
// migraciones 0003_fix_sales_insert_policy.sql y
// 0013_sales_insert_requires_published.sql:
//
//   La política `sales_insert_own` debe exigir, además del check de dueño
//   del listing, que el insert tenga `status = 'pendiente_aprobacion'` y
//   `commission is null`. Antes de la corrección (0003), solo se validaba
//   el dueño, permitiendo que un vendedor se auto-aprobara una venta con
//   una comisión arbitraria.
//
//   0013 agregó además la exigencia de que el listing referenciado esté
//   en `status = 'publicado'` (requisito explícito del criterio de
//   aceptación de T-15/REQ-08: la solicitud de venta se hace "desde un
//   anuncio en estado Publicado"). Por eso el caso de "insert válido"
//   de este archivo ahora requiere publicar el listing primero (vía el
//   flujo real de moderador, mismo patrón que T-08/T-12), en vez de
//   dejarlo en 'borrador' como antes de 0013.
//
// Este test corre contra el proyecto Supabase REAL (no un mock/local),
// usando:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/limpiar datos de prueba
//     (usuarios, seller, listing, fotos, sale) sin pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como el usuario de prueba (vendedor) y como un
//     moderador, y probar el insert en `sales` sujeto a RLS, tal como lo
//     haría la app.
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

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngBlob(): Blob {
  const bytes = Buffer.from(PNG_1X1_BASE64, "base64");
  return new Blob([bytes], { type: "image/png" });
}

describe.skipIf(!hasCredentials)(
  "RLS sales_insert_own (0003_fix_sales_insert_policy.sql, 0013_sales_insert_requires_published.sql) — proyecto Supabase real",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const testEmail = `qa-rls-sales-${runId}@example.com`;
    const testPassword = `Qa-Test-${runId}!`;
    const modEmail = `qa-rls-sales-mod-${runId}@example.com`;
    const modPassword = `Qa-Test-${runId}-mod!`;

    let adminClient: SupabaseClient;
    let anonAuthedClient: SupabaseClient;
    let modClient: SupabaseClient;

    let userId: string | undefined;
    let modUserId: string | undefined;
    let sellerId: string | undefined;
    let listingId: string | undefined;
    const createdSaleIds: string[] = [];
    const uploadedPaths: string[] = [];

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

      // Moderador, para poder publicar el listing (0013 exige
      // `listings.status = 'publicado'`), igual que T-08/T-12.
      const { data: modData, error: modError } =
        await adminClient.auth.admin.createUser({
          email: modEmail,
          password: modPassword,
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
        })
        .select("id")
        .single();
      if (listingError || !listingData) {
        throw new Error(
          `No se pudo crear el listing de prueba: ${listingError?.message}`
        );
      }
      listingId = listingData.id as string;

      // 2. Clientes autenticados como el usuario de prueba y como el
      // moderador (anon key + signInWithPassword), tal como lo usaría la
      // app.
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

      modClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInModError } = await modClient.auth.signInWithPassword(
        { email: modEmail, password: modPassword }
      );
      if (signInModError) {
        throw new Error(
          `No se pudo autenticar al moderador: ${signInModError.message}`
        );
      }

      // 3. Publicar el listing (0013 exige `listings.status =
      // 'publicado'` para que `sales_insert_own` permita el insert): se
      // suben 3 fotos (mínimo exigido por T-10/0009) con el cliente
      // dueño, y el moderador cambia el status (T-12/0010).
      for (let i = 0; i < 3; i++) {
        const storagePath = `${listingId}/foto-${i}-${runId}.png`;
        const { error: uploadError } = await anonAuthedClient.storage
          .from("listing-photos")
          .upload(storagePath, pngBlob(), {
            contentType: "image/png",
            upsert: false,
          });
        if (uploadError) {
          throw new Error(`No se pudo subir la foto ${i}: ${uploadError.message}`);
        }
        uploadedPaths.push(storagePath);

        const { error: insertPhotoError } = await anonAuthedClient
          .from("listing_photos")
          .insert({ listing_id: listingId, storage_path: storagePath, position: i });
        if (insertPhotoError) {
          throw new Error(
            `No se pudo insertar la fila listing_photos ${i}: ${insertPhotoError.message}`
          );
        }
      }

      const { error: publicarError } = await modClient
        .from("listings")
        .update({ status: "publicado" })
        .eq("id", listingId);
      if (publicarError) {
        throw new Error(
          `El moderador no pudo publicar el listing de prueba: ${publicarError.message}`
        );
      }
    }, 45_000);

    afterAll(async () => {
      // Limpieza vía service_role (bypassa RLS), en orden inverso de FKs.
      if (createdSaleIds.length > 0) {
        await adminClient.from("sales").delete().in("id", createdSaleIds);
      }
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      if (listingId) {
        await adminClient.from("listing_photos").delete().eq("listing_id", listingId);
        await adminClient.from("listings").delete().eq("id", listingId);
      }
      if (sellerId) {
        await adminClient.from("sellers").delete().eq("id", sellerId);
      }
      if (userId) {
        await adminClient.auth.admin.deleteUser(userId);
      }
      if (modUserId) {
        await adminClient.auth.admin.deleteUser(modUserId);
      }
    }, 30_000);

    it(
      "el listing de prueba quedó 'publicado' con 3 fotos (setup, requisito de 0013)",
      async () => {
        const { data, error } = await adminClient
          .from("listings")
          .select("status")
          .eq("id", listingId)
          .single();
        expect(error).toBeNull();
        expect(data?.status).toBe("publicado");
      },
      15_000
    );

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
      "PERMITE un insert válido propio en estado pendiente_aprobacion sin comisión, sobre un listing 'publicado'",
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
