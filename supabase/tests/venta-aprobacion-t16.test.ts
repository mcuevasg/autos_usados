// Test de integración (no unitario) de QA que corrige un hallazgo
// BLOQUEANTE del reviewer sobre T-16 (REQ-08), en la Server Action
// `aprobarVenta` (app/moderador/ventas/actions.ts):
//
//   HALLAZGO: `aprobarVenta` hacía, en orden, (1) leer `sales`, (2) si
//   `sale.status !== 'pendiente_aprobacion'` rechazar de inmediato con
//   "Esta solicitud de venta ya fue procesada.", (3) actualizar `sales`
//   (status='aprobada' + commission), (4) actualizar
//   `listings.status='vendido'`. Si el paso (3) tenía éxito pero el (4)
//   fallaba (red, timeout, etc.), la fila de `sales` quedaba 'aprobada'
//   para siempre, pero un reintento posterior con el mismo `saleId` caía
//   en el guard del paso (2) (porque `sale.status` ya era 'aprobada') y
//   NUNCA volvía a intentar el paso (4): el anuncio jamás pasaba a
//   'vendido', sin ningún camino de recuperación automático. El
//   comentario original afirmaba que "reintentar es seguro", lo cual era
//   falso en la práctica.
//
//   FIX: cuando `sale.status === 'aprobada'`, `aprobarVenta` ahora relee
//   el `listing` asociado antes de rechazar. Si `listing.status !==
//   'vendido'`, asume el escenario de fallo parcial y reintenta
//   ÚNICAMENTE el update de `listings` (sin volver a tocar `sales`, cuyo
//   status/commission ya son correctos), devolviendo éxito si funciona.
//   Solo si el `listing` ya está 'vendido' se concluye que la solicitud
//   está completamente procesada y se devuelve el error correspondiente.
//
// Archivo bajo prueba: app/moderador/ventas/actions.ts (aprobarVenta).
// Dado que `aprobarVenta` depende de `next/headers` (cookies) vía
// `createSupabaseServerClient`, no se invoca directamente fuera de un
// request de Next.js (mismo enfoque que `supabase/tests/venta-t16.test.ts`,
// que "simula" la Server Action reproduciendo exactamente sus mismas
// llamadas a Supabase con el cliente autenticado del moderador). Este
// archivo reproduce, paso a paso, la lógica de recuperación descrita
// arriba y verifica el mismo comportamiento contra el proyecto Supabase
// REAL (no un mock/local).
//
// Sigue el mismo patrón que supabase/tests/venta-t15.test.ts y
// supabase/tests/venta-t16.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/limpiar datos de prueba y
//     preparar directamente el escenario de fallo parcial (equivalente a
//     que el update de `sales` de un intento anterior haya tenido éxito
//     pero el de `listings` no) sin pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba (moderador y vendedores) y
//     ejercer RLS real, tal como lo haría la app.
//
// Cubre:
//   1. Flujo feliz: aprobar una venta pendiente actualiza `sales`
//      (status='aprobada', commission=final_price*0.05) y
//      `listings.status='vendido'`.
//   2. Escenario de fallo parcial simulado: se deja `sales.status =
//      'aprobada'` (con su commission ya calculada) pero
//      `listings.status` en un valor distinto de 'vendido' (simulando
//      que el paso (4) de un intento anterior falló). Se reproduce la
//      lógica de recuperación de `aprobarVenta` (releer el listing, ver
//      que no está 'vendido', reintentar SOLO ese update) y se confirma
//      que logra completar `listings.status='vendido'` sin volver a
//      tocar `sales` (su commission queda exactamente igual a la que ya
//      tenía antes del reintento).
//   3. Un vendedor no moderador NO puede hacer update directo sobre
//      `sales` (RLS): confirma que la única vía de mutación de `sales`
//      es a través de `aprobarVenta` con un moderador autenticado.
//   4. `sales_select_moderator` permite a un moderador ver solicitudes
//      de cualquier vendedor (no solo las propias).

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

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngBlob(): Blob {
  const bytes = Buffer.from(PNG_1X1_BASE64, "base64");
  return new Blob([bytes], { type: "image/png" });
}

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts); `sellers.rut`
// no tiene constraint de unicidad, así que reutilizarlos entre suites de
// test no genera conflicto.
const RUT_MODERADOR = "12.345.678-5";
const RUT_A = "9.000.021-7";
const RUT_B = "10.000.013-K";

const LISTING_BASE = {
  brand: "Toyota",
  model: "Corolla",
  year: 2021,
  mileage: 15000,
  price: 12000000,
  vehicle_condition: "usado en buen estado",
  papers_up_to_date: true,
  usage_type: "familiar" as const,
  location: "Santiago",
};

const FINAL_PRICE_A = 10_000_000;
const COMISION_ESPERADA_A = 500_000; // 10.000.000 * 0.05
const FINAL_PRICE_B = 8_000_000;
const COMISION_SIMULADA_B = 400_000; // 8.000.000 * 0.05, ya calculada de "antes"

describe.skipIf(!hasCredentials)(
  "T-16 (fix reviewer): recuperación de aprobarVenta ante fallo parcial (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t16fix-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t16fix-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;
    const emailB = `qa-t16fix-sellerB-${runId}@example.com`;
    const passwordB = `Qa-Test-${runId}-b!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;

    let modUserId: string | undefined;
    let userAId: string | undefined;
    let userBId: string | undefined;
    let sellerAId: string | undefined;
    let sellerBId: string | undefined;

    let listingAId: string | undefined;
    let listingBId: string | undefined;

    let saleAId: string | undefined;
    let saleBId: string | undefined;

    const uploadedPaths: string[] = [];

    async function publicarListingConFotos(
      client: SupabaseClient,
      sellerId: string,
      overrides: Partial<typeof LISTING_BASE> = {}
    ): Promise<string> {
      const { data: listingData, error: listingError } = await client
        .from("listings")
        .insert({ seller_id: sellerId, ...LISTING_BASE, ...overrides })
        .select("id, status")
        .single();
      if (listingError || !listingData) {
        throw new Error(
          `No se pudo crear el listing: ${listingError?.message}`
        );
      }
      const listingId = listingData.id as string;
      expect(listingData.status).toBe("borrador");

      for (let i = 0; i < 3; i++) {
        const storagePath = `${listingId}/foto-${i}-${runId}.png`;
        const { error: uploadError } = await client.storage
          .from("listing-photos")
          .upload(storagePath, pngBlob(), {
            contentType: "image/png",
            upsert: false,
          });
        if (uploadError) {
          throw new Error(
            `No se pudo subir la foto ${i}: ${uploadError.message}`
          );
        }
        uploadedPaths.push(storagePath);

        const { error: insertPhotoError } = await client
          .from("listing_photos")
          .insert({
            listing_id: listingId,
            storage_path: storagePath,
            position: i,
          });
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
          `El moderador no pudo publicar el listing: ${publicarError.message}`
        );
      }

      return listingId;
    }

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

      // Vendedor A (flujo feliz).
      const { data: userAData, error: userAError } =
        await adminClient.auth.admin.createUser({
          email: emailA,
          password: passwordA,
          email_confirm: true,
        });
      if (userAError || !userAData.user) {
        throw new Error(
          `No se pudo crear el usuario vendedor A: ${userAError?.message}`
        );
      }
      userAId = userAData.user.id;

      // Vendedor B (escenario de fallo parcial simulado).
      const { data: userBData, error: userBError } =
        await adminClient.auth.admin.createUser({
          email: emailB,
          password: passwordB,
          email_confirm: true,
        });
      if (userBError || !userBData.user) {
        throw new Error(
          `No se pudo crear el usuario vendedor B: ${userBError?.message}`
        );
      }
      userBId = userBData.user.id;

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

      clientA = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInAError } = await clientA.auth.signInWithPassword({
        email: emailA,
        password: passwordA,
      });
      if (signInAError) {
        throw new Error(
          `No se pudo autenticar al vendedor A: ${signInAError.message}`
        );
      }

      clientB = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInBError } = await clientB.auth.signInWithPassword({
        email: emailB,
        password: passwordB,
      });
      if (signInBError) {
        throw new Error(
          `No se pudo autenticar al vendedor B: ${signInBError.message}`
        );
      }

      // Seller A: flujo real (pendiente -> verificado por el moderador
      // autenticado), igual que T-08/T-15/T-16.
      const { data: sellerAData, error: sellerAError } = await adminClient
        .from("sellers")
        .insert({
          user_id: userAId,
          seller_type: "persona_natural",
          rut: RUT_A,
          verification_status: "pendiente",
        })
        .select("id")
        .single();
      if (sellerAError || !sellerAData) {
        throw new Error(
          `No se pudo crear el seller A: ${sellerAError?.message}`
        );
      }
      sellerAId = sellerAData.id as string;

      const { error: verifyAError } = await modClient
        .from("sellers")
        .update({ verification_status: "verificado" })
        .eq("id", sellerAId);
      if (verifyAError) {
        throw new Error(
          `El moderador no pudo verificar al seller A: ${verifyAError.message}`
        );
      }

      // Seller B: mismo flujo real.
      const { data: sellerBData, error: sellerBError } = await adminClient
        .from("sellers")
        .insert({
          user_id: userBId,
          seller_type: "persona_natural",
          rut: RUT_B,
          verification_status: "pendiente",
        })
        .select("id")
        .single();
      if (sellerBError || !sellerBData) {
        throw new Error(
          `No se pudo crear el seller B: ${sellerBError?.message}`
        );
      }
      sellerBId = sellerBData.id as string;

      const { error: verifyBError } = await modClient
        .from("sellers")
        .update({ verification_status: "verificado" })
        .eq("id", sellerBId);
      if (verifyBError) {
        throw new Error(
          `El moderador no pudo verificar al seller B: ${verifyBError.message}`
        );
      }

      // Anuncios publicados (flujo real: crea en 'borrador' -> sube 3
      // fotos -> moderador publica), igual que T-12/T-15/T-16.
      listingAId = await publicarListingConFotos(clientA, sellerAId);
      listingBId = await publicarListingConFotos(clientB, sellerBId, {
        model: "Yaris",
      });

      // Cada vendedor solicita una venta concretada (flujo real de T-15).
      const { data: saleAData, error: saleAError } = await clientA
        .from("sales")
        .insert({ listing_id: listingAId, final_price: FINAL_PRICE_A })
        .select("id, status, commission")
        .single();
      if (saleAError || !saleAData) {
        throw new Error(
          `No se pudo crear la solicitud de venta de A: ${saleAError?.message}`
        );
      }
      saleAId = saleAData.id as string;
      expect(saleAData.status).toBe("pendiente_aprobacion");
      expect(saleAData.commission).toBeNull();

      const { data: saleBData, error: saleBError } = await clientB
        .from("sales")
        .insert({ listing_id: listingBId, final_price: FINAL_PRICE_B })
        .select("id, status, commission")
        .single();
      if (saleBError || !saleBData) {
        throw new Error(
          `No se pudo crear la solicitud de venta de B: ${saleBError?.message}`
        );
      }
      saleBId = saleBData.id as string;
      expect(saleBData.status).toBe("pendiente_aprobacion");
      expect(saleBData.commission).toBeNull();
    }, 60_000);

    afterAll(async () => {
      // Limpieza best-effort vía service_role, en orden inverso de FKs.
      const saleIds = [saleAId, saleBId].filter(Boolean) as string[];
      if (saleIds.length > 0) {
        await adminClient.from("sales").delete().in("id", saleIds);
      }
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      for (const id of [listingAId, listingBId]) {
        if (id) {
          await adminClient.from("listing_photos").delete().eq("listing_id", id);
          await adminClient.from("listings").delete().eq("id", id);
        }
      }
      for (const id of [sellerAId, sellerBId]) {
        if (id) {
          await adminClient.from("sellers").delete().eq("id", id);
        }
      }
      if (modUserId) {
        await adminClient.auth.admin.deleteUser(modUserId);
      }
      if (userAId) {
        await adminClient.auth.admin.deleteUser(userAId);
      }
      if (userBId) {
        await adminClient.auth.admin.deleteUser(userBId);
      }
    }, 30_000);

    it("los RUT usados son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_MODERADOR)).toBe(true);
      expect(validarRut(RUT_A)).toBe(true);
      expect(validarRut(RUT_B)).toBe(true);
    });

    it(
      "(3) un vendedor no moderador (A) NO puede hacer update directo sobre `sales` (sin política de UPDATE para no-moderador)",
      async () => {
        const { data, error } = await clientA
          .from("sales")
          .update({ status: "aprobada" })
          .eq("id", saleAId!)
          .select("id");

        // RLS en UPDATE puede manifestarse de dos formas equivalentes: un
        // error explícito, o un éxito silencioso con 0 filas afectadas
        // (cuando no hay ninguna política de UPDATE que otorgue acceso al
        // rol) — mismo patrón que supabase/tests/venta-t16.test.ts punto
        // (3).
        if (error) {
          expect(error.code === "42501" || error.message.length > 0).toBe(
            true
          );
        } else {
          expect(
            data,
            "el update no debería afectar ninguna fila (no hay política de UPDATE para no-moderador sobre `sales`)"
          ).toHaveLength(0);
        }

        const { data: saleCheck, error: saleCheckError } = await adminClient
          .from("sales")
          .select("status")
          .eq("id", saleAId!)
          .single();
        expect(saleCheckError).toBeNull();
        expect(saleCheck?.status).toBe("pendiente_aprobacion");
      },
      20_000
    );

    it(
      "(4) `sales_select_moderator` permite al moderador ver solicitudes pendientes de CUALQUIER vendedor",
      async () => {
        const { data, error } = await modClient
          .from("sales")
          .select("id, listing_id, final_price, status")
          .eq("status", "pendiente_aprobacion");

        expect(error).toBeNull();
        const ids = (data ?? []).map((row) => row.id);
        expect(
          ids,
          "el moderador debe ver la solicitud pendiente del vendedor A"
        ).toContain(saleAId);
        expect(
          ids,
          "el moderador debe ver también la solicitud pendiente del vendedor B, aunque sea un vendedor distinto"
        ).toContain(saleBId);
      },
      20_000
    );

    it(
      "(1) flujo feliz: aprobar la venta pendiente de A actualiza `sales` (aprobada + commission=final_price*0.05) y `listings.status='vendido'`",
      async () => {
        const comisionCalculada = FINAL_PRICE_A * 0.05;
        expect(comisionCalculada).toBe(COMISION_ESPERADA_A);

        // Paso (3) de `aprobarVenta`: actualizar `sales`.
        const { data: saleUpdateData, error: saleUpdateError } =
          await modClient
            .from("sales")
            .update({ status: "aprobada", commission: comisionCalculada })
            .eq("id", saleAId!)
            .select("id, status, commission")
            .single();

        expect(
          saleUpdateError,
          `el moderador no pudo aprobar la venta: ${saleUpdateError?.message}`
        ).toBeNull();
        expect(saleUpdateData?.status).toBe("aprobada");
        expect(Number(saleUpdateData?.commission)).toBe(COMISION_ESPERADA_A);

        // Paso (4) de `aprobarVenta`: actualizar `listings`.
        const { data: listingUpdateData, error: listingUpdateError } =
          await modClient
            .from("listings")
            .update({ status: "vendido" })
            .eq("id", listingAId!)
            .select("id, status")
            .single();

        expect(
          listingUpdateError,
          `el moderador no pudo marcar el anuncio como vendido: ${listingUpdateError?.message}`
        ).toBeNull();
        expect(listingUpdateData?.status).toBe("vendido");

        // Confirmación definitiva vía service_role.
        const { data: saleCheck, error: saleCheckError } = await adminClient
          .from("sales")
          .select("status, commission, final_price")
          .eq("id", saleAId!)
          .single();
        expect(saleCheckError).toBeNull();
        expect(saleCheck?.status).toBe("aprobada");
        expect(Number(saleCheck?.commission)).toBe(COMISION_ESPERADA_A);
        expect(Number(saleCheck?.commission)).toBe(
          Number(saleCheck?.final_price) * 0.05
        );

        const { data: listingCheck, error: listingCheckError } =
          await adminClient
            .from("listings")
            .select("status")
            .eq("id", listingAId!)
            .single();
        expect(listingCheckError).toBeNull();
        expect(listingCheck?.status).toBe("vendido");
      },
      20_000
    );

    it(
      "(2) fallo parcial simulado + recuperación: `sales` de B ya quedó 'aprobada' pero `listings` no llegó a 'vendido'; la lógica de recuperación de aprobarVenta completa SOLO el update de listings, sin volver a tocar `sales`",
      async () => {
        // --- Preparación del escenario de fallo parcial ---
        // Simula que, en un intento anterior de `aprobarVenta`, el paso
        // (3) (update de `sales`) tuvo éxito pero el paso (4) (update de
        // `listings`) falló: dejamos `sales.status = 'aprobada'` con su
        // commission ya calculada, pero `listings.status` se queda en
        // 'publicado' (no 'vendido'). Se hace directamente vía
        // service_role para preparar el escenario sin depender de que el
        // update de sales-por-moderador (ya cubierto en el test anterior)
        // se ejecute aquí de nuevo.
        const comisionSimulada = FINAL_PRICE_B * 0.05;
        expect(comisionSimulada).toBe(COMISION_SIMULADA_B);

        const { error: prepSaleError } = await adminClient
          .from("sales")
          .update({ status: "aprobada", commission: comisionSimulada })
          .eq("id", saleBId!);
        expect(prepSaleError).toBeNull();

        const { data: listingAntesCheck, error: listingAntesError } =
          await adminClient
            .from("listings")
            .select("status")
            .eq("id", listingBId!)
            .single();
        expect(listingAntesError).toBeNull();
        expect(
          listingAntesCheck?.status,
          "precondición del escenario de fallo parcial: el listing NO debe estar 'vendido' todavía"
        ).toBe("publicado");

        // --- Reproducción de la lógica de recuperación de aprobarVenta ---
        // 1. Releer `sales` (equivalente al primer `select` de la Server
        //    Action): status ya es 'aprobada', no 'pendiente_aprobacion'.
        const { data: saleReread, error: saleRereadError } = await modClient
          .from("sales")
          .select("id, listing_id, final_price, status, commission")
          .eq("id", saleBId!)
          .maybeSingle();
        expect(saleRereadError).toBeNull();
        expect(saleReread?.status).toBe("aprobada");

        // 2. Como `sale.status === 'aprobada'`, releer el `listing`
        //    asociado (equivalente al nuevo paso de aprobarVenta) para
        //    distinguir "fallo parcial recuperable" de "ya procesada".
        const { data: listingReread, error: listingRereadError } =
          await modClient
            .from("listings")
            .select("status")
            .eq("id", saleReread!.listing_id)
            .maybeSingle();
        expect(listingRereadError).toBeNull();
        expect(
          listingReread?.status,
          "el listing todavía no está 'vendido': este es el escenario de fallo parcial recuperable"
        ).not.toBe("vendido");

        // 3. Reintentar ÚNICAMENTE el update de `listings` (sin volver a
        //    tocar `sales`).
        const { data: retryListingData, error: retryListingError } =
          await modClient
            .from("listings")
            .update({ status: "vendido" })
            .eq("id", saleReread!.listing_id)
            .select("id, status")
            .single();

        expect(
          retryListingError,
          `la recuperación no pudo completar el update de listings: ${retryListingError?.message}`
        ).toBeNull();
        expect(retryListingData?.status).toBe("vendido");

        // --- Verificación: el listing quedó 'vendido' y `sales` NO fue
        // tocada de nuevo (su commission/status siguen siendo exactamente
        // los que dejó la preparación del escenario, no un nuevo cálculo).
        const { data: listingDespues, error: listingDespuesError } =
          await adminClient
            .from("listings")
            .select("status")
            .eq("id", listingBId!)
            .single();
        expect(listingDespuesError).toBeNull();
        expect(listingDespues?.status).toBe("vendido");

        const { data: saleDespues, error: saleDespuesError } =
          await adminClient
            .from("sales")
            .select("status, commission, final_price")
            .eq("id", saleBId!)
            .single();
        expect(saleDespuesError).toBeNull();
        expect(saleDespues?.status).toBe("aprobada");
        expect(
          Number(saleDespues?.commission),
          "la recuperación no debe recalcular ni volver a tocar `sales`: la commission debe seguir siendo la de la preparación del escenario"
        ).toBe(COMISION_SIMULADA_B);
        expect(Number(saleDespues?.final_price)).toBe(FINAL_PRICE_B);
      },
      20_000
    );

    it(
      "una vez que `listings.status` ya es 'vendido', la solicitud está completamente procesada: no queda ningún camino de recuperación pendiente",
      async () => {
        const { data: saleFinal, error: saleFinalError } = await adminClient
          .from("sales")
          .select("status")
          .eq("id", saleBId!)
          .single();
        expect(saleFinalError).toBeNull();
        expect(saleFinal?.status).toBe("aprobada");

        const { data: listingFinal, error: listingFinalError } =
          await adminClient
            .from("listings")
            .select("status")
            .eq("id", listingBId!)
            .single();
        expect(listingFinalError).toBeNull();
        expect(
          listingFinal?.status,
          "con sales.status='aprobada' y listings.status='vendido', aprobarVenta debe responder con el error de 'ya procesada', sin reintentar ningún update adicional"
        ).toBe("vendido");
      },
      20_000
    );

    it("actions.ts (aprobarVenta) implementa el mecanismo de recuperación descrito (releer el listing cuando sale.status ya es 'aprobada')", () => {
      const actionsPath = path.resolve(
        process.cwd(),
        "app/moderador/ventas/actions.ts"
      );
      const source = readFileSync(actionsPath, "utf-8");

      expect(source).toContain('sale.status === "aprobada"');
      expect(source).toContain('listing.status !== "vendido"');
      // El comentario ya no debe afirmar, sin más, que "reintentar es
      // seguro" de forma genérica sin explicar el mecanismo real.
      expect(source).not.toContain(
        "reintentar es seguro: el segundo update de"
      );
    });
  }
);
