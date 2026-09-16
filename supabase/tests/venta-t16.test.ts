// Test de integración (no unitario) de QA para T-16 (REQ-08): aprobación
// de venta y cálculo de comisión.
//
//   "Un moderador puede aprobar la solicitud de venta; al aprobarla, el
//   anuncio pasa a estado 'Vendido' y el sistema calcula y registra la
//   comisión sobre el precio final indicado."
//
// Archivos bajo prueba: app/moderador/ventas/page.tsx,
// app/moderador/ventas/actions.ts (aprobarVenta),
// app/moderador/ventas/venta-acciones.tsx, app/moderador/layout.tsx (link
// nuevo), y las políticas RLS `sales_select_moderator` /
// `sales_update_moderator` (supabase/migrations/0014_sales_approval.sql,
// aplicada manualmente en el SQL Editor de Supabase).
//
// Sigue el mismo patrón que supabase/tests/venta-t15.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/limpiar datos de prueba sin
//     pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba (moderador y vendedores) y
//     ejercer RLS real, tal como lo haría la app.
//
// Cubre, contra el proyecto Supabase REAL (no un mock/local):
//   1. Flujo real hasta una solicitud `sales` pendiente: moderador
//      verifica vendedor, vendedor publica anuncio con 3+ fotos, vendedor
//      solicita venta con un final_price conocido ($10.000.000).
//   2. El propio vendedor (no moderador) NO puede hacer `update` directo
//      sobre esa fila de `sales` (sin política de UPDATE para
//      no-moderador) → debe fallar con error de RLS.
//   3. El moderador, autenticado con el cliente SSR normal (no
//      service_role), lee TODAS las solicitudes pendientes
//      (`sales_select_moderator`) y ve la de este vendedor de prueba.
//   4. El moderador aprueba: actualiza `sales` (status='aprobada',
//      commission=final_price*0.05) y `listings.status='vendido'`, ambos
//      con su cliente autenticado (no service_role) → ambos updates
//      deben funcionar.
//   5. `commission` queda exactamente en `final_price * 0.05`
//      ($10.000.000 * 0.05 = $500.000), y `listings.status` queda en
//      'vendido'.
//   6. Un vendedor no moderador sigue sin poder leer las solicitudes de
//      OTROS vendedores (`sales_select_own` sigue aislando;
//      `sales_select_moderator` no debilita esto para no-moderadores).

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

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts).
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
const FINAL_PRICE_B = 7_000_000;

describe.skipIf(!hasCredentials)(
  "T-16: aprobación de venta y cálculo de comisión (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t16-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t16-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;
    const emailB = `qa-t16-sellerB-${runId}@example.com`;
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

      // Vendedor A (dueño de la solicitud principal bajo prueba).
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

      // Vendedor B (para probar aislamiento, punto 7).
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
      // autenticado), igual que T-08/T-15.
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
      // fotos -> moderador publica), igual que T-12/T-15.
      listingAId = await publicarListingConFotos(clientA, sellerAId);
      listingBId = await publicarListingConFotos(clientB, sellerBId, {
        model: "Yaris",
      });

      // Vendedor A solicita venta concretada (flujo real de T-15: solo
      // listing_id + final_price, vía su propio cliente autenticado).
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

      // Vendedor B también solicita una venta (para probar aislamiento,
      // punto 7): no se aprueba, solo debe existir.
      const { data: saleBData, error: saleBError } = await clientB
        .from("sales")
        .insert({ listing_id: listingBId, final_price: FINAL_PRICE_B })
        .select("id, status")
        .single();
      if (saleBError || !saleBData) {
        throw new Error(
          `No se pudo crear la solicitud de venta de B: ${saleBError?.message}`
        );
      }
      saleBId = saleBData.id as string;
      expect(saleBData.status).toBe("pendiente_aprobacion");
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
      "setup: existe una solicitud de venta pendiente de A sobre un listing 'publicado' con 3 fotos, con final_price=$10.000.000",
      async () => {
        const { data: listingCheck, error: listingCheckError } =
          await adminClient
            .from("listings")
            .select("status")
            .eq("id", listingAId)
            .single();
        expect(listingCheckError).toBeNull();
        expect(listingCheck?.status).toBe("publicado");

        const { data: fotos, error: fotosError } = await adminClient
          .from("listing_photos")
          .select("id")
          .eq("listing_id", listingAId);
        expect(fotosError).toBeNull();
        expect(fotos).toHaveLength(3);

        const { data: saleCheck, error: saleCheckError } = await adminClient
          .from("sales")
          .select("status, final_price, commission")
          .eq("id", saleAId)
          .single();
        expect(saleCheckError).toBeNull();
        expect(saleCheck?.status).toBe("pendiente_aprobacion");
        expect(Number(saleCheck?.final_price)).toBe(FINAL_PRICE_A);
        expect(saleCheck?.commission).toBeNull();
      },
      20_000
    );

    it(
      "(3) el vendedor A (no moderador) NO puede hacer update directo sobre su propia solicitud de venta (sin política de UPDATE para no-moderador)",
      async () => {
        const { data, error } = await clientA
          .from("sales")
          .update({ status: "aprobada" })
          .eq("id", saleAId!)
          .select("id");

        // RLS en UPDATE puede manifestarse de dos formas equivalentes: un
        // error explícito, o un éxito silencioso con 0 filas afectadas
        // (cuando no hay ninguna política de UPDATE que otorgue acceso al
        // rol, USING se evalúa como falso para todas las filas y
        // PostgREST no reporta error, solo devuelve un array vacío) —
        // mismo patrón usado en supabase/tests/moderador-vendedores-t08.test.ts
        // punto (4).
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

        // Confirmación definitiva vía service_role: el status no cambió.
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
      "(4) el moderador (cliente autenticado, no service_role) lee TODAS las solicitudes pendientes vía `sales_select_moderator`, incluida la de este vendedor de prueba",
      async () => {
        const { data, error } = await modClient
          .from("sales")
          .select("id, listing_id, final_price, status")
          .eq("status", "pendiente_aprobacion");

        expect(error).toBeNull();
        expect(data).not.toBeNull();

        const ids = (data ?? []).map((row) => row.id);
        expect(
          ids,
          "el moderador debe ver la solicitud pendiente del vendedor A, aunque no sea el dueño"
        ).toContain(saleAId);
        expect(
          ids,
          "el moderador debe ver también la solicitud pendiente del vendedor B (ve TODAS, no solo las de un vendedor)"
        ).toContain(saleBId);
      },
      20_000
    );

    it(
      "(5)+(6) simula `aprobarVenta`: el moderador actualiza `sales` (aprobada + comisión) y `listings` (vendido), ambos con su cliente autenticado; la comisión queda en exactamente final_price*0.05 y el listing en 'vendido'",
      async () => {
        const comisionCalculada = FINAL_PRICE_A * 0.05;
        expect(comisionCalculada).toBe(COMISION_ESPERADA_A);

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
        expect(
          Number(saleCheck?.commission)
        ).toBe(Number(saleCheck?.final_price) * 0.05);

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
      "(7) un vendedor no moderador (A) NO puede leer la solicitud de venta de OTRO vendedor (B); `sales_select_moderator` no debilita el aislamiento de `sales_select_own` para no-moderadores",
      async () => {
        const { data, error } = await clientA
          .from("sales")
          .select("id")
          .eq("id", saleBId!);

        // RLS filtra silenciosamente (no es un error): la fila
        // simplemente no aparece en el resultado para un no-dueño.
        expect(error).toBeNull();
        expect(
          data,
          "el vendedor A no debe poder leer la solicitud de venta del vendedor B"
        ).toHaveLength(0);

        // Verificación simétrica: B tampoco puede leer la (ya aprobada)
        // solicitud de A.
        const { data: dataB, error: errorB } = await clientB
          .from("sales")
          .select("id")
          .eq("id", saleAId!);
        expect(errorB).toBeNull();
        expect(
          dataB,
          "el vendedor B no debe poder leer la solicitud de venta del vendedor A"
        ).toHaveLength(0);

        // Cada uno sigue viendo la propia (sales_select_own no se rompió).
        const { data: ownA, error: ownAError } = await clientA
          .from("sales")
          .select("id")
          .eq("id", saleAId!);
        expect(ownAError).toBeNull();
        expect(ownA).toHaveLength(1);

        const { data: ownB, error: ownBError } = await clientB
          .from("sales")
          .select("id")
          .eq("id", saleBId!);
        expect(ownBError).toBeNull();
        expect(ownB).toHaveLength(1);
      },
      20_000
    );

    it("archivos de T-16 existen (page.tsx, actions.ts, venta-acciones.tsx, link en layout)", () => {
      const pagePath = path.resolve(
        process.cwd(),
        "app/moderador/ventas/page.tsx"
      );
      const actionsPath = path.resolve(
        process.cwd(),
        "app/moderador/ventas/actions.ts"
      );
      const accionesPath = path.resolve(
        process.cwd(),
        "app/moderador/ventas/venta-acciones.tsx"
      );
      const layoutPath = path.resolve(
        process.cwd(),
        "app/moderador/layout.tsx"
      );

      expect(existsSync(pagePath)).toBe(true);
      expect(existsSync(actionsPath)).toBe(true);
      expect(existsSync(accionesPath)).toBe(true);
      expect(existsSync(layoutPath)).toBe(true);

      const actionsSource = readFileSync(actionsPath, "utf-8");
      expect(actionsSource).toContain("aprobarVenta");
      expect(actionsSource).toContain("0.05");
      expect(actionsSource).toContain('status: "vendido"');
      expect(actionsSource).toContain('status: "aprobada"');

      const layoutSource = readFileSync(layoutPath, "utf-8");
      expect(layoutSource).toContain("/moderador/ventas");
    });
  }
);
