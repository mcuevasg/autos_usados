// Test de integración (no unitario) para el criterio de aceptación de T-08
// (app/moderador/vendedores/page.tsx, app/moderador/vendedores/actions.ts,
// supabase/migrations/0006_moderator_seller_review.sql,
// supabase/migrations/0007_protect_verification_status.sql,
// supabase/migrations/0008_protect_verification_status_insert.sql):
//
//   "Un usuario con rol moderador ve la lista de vendedores en estado
//   'Pendiente de revisión' con su documentación, y puede cambiar el
//   estado a 'Verificado' o 'Rechazado'. Un vendedor no verificado no
//   puede publicar anuncios." (REQ-01)
//
// Cubre (ver .project/tasks.md T-08 y las instrucciones de la tarea QA):
//   0. Vector de INSERT (0008): un usuario SIN fila en sellers no puede
//      insertar directamente su propia fila con verification_status
//      distinto de 'pendiente' (bypaseando la app), pero SÍ puede
//      insertarla con verification_status = 'pendiente' (flujo legítimo,
//      idéntico a app/vendedor/registro/actions.ts).
//   1. Setup vía service_role: un moderador (profiles.role='moderador') y
//      dos vendedores con sellers en estado 'pendiente', cada uno con un
//      documento subido a su propio path en el bucket 'seller-documents'.
//   2. Autenticado como moderador: puede leer AMBAS filas de sellers
//      pendientes (sellers_select_moderator) y generar/usar una signed
//      URL para descargar el documento de CUALQUIERA de los dos
//      vendedores (seller_documents_select_moderator).
//   3. Autenticado como moderador: actualiza verification_status de un
//      vendedor a 'verificado' y del otro a 'rechazado'. Ambos updates
//      deben tener éxito (sellers_update_moderator).
//   4. Autenticado como un vendedor NO moderador: no puede leer la fila de
//      sellers de OTRO vendedor (sellers_select_moderator no aplica a
//      no-moderadores, sellers_select_own sigue aislando), y no puede
//      auto-verificarse actualizando su propia fila (sellers_update_own
//      no incluye esa capacidad, y el trigger de 0007 lo bloquea aunque
//      RLS lo permitiera).
//   5. "Vendedor no verificado no puede publicar anuncios"
//      (listings_insert_own, 0006_moderator_seller_review.sql): con el
//      vendedor que queda 'rechazado', el insert en `listings` con su
//      seller_id debe FALLAR por RLS. Con el vendedor que queda
//      'verificado', el mismo insert debe FUNCIONAR.
//
// Este test corre contra el proyecto Supabase REAL (no un mock/local),
// siguiendo el mismo patrón que supabase/tests/vendedor-registro-t07.test.ts
// y supabase/tests/rls-sales-insert-policy.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/verificar/limpiar datos y
//     archivos de prueba sin pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba (moderador y vendedores) y
//     probar `sellers`, `storage.objects` y `listings` sujetos a RLS, tal
//     como lo haría la app.
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

// Tres RUTs válidos conocidos (cubiertos por lib/rut.test.ts), uno por
// vendedor, para no reutilizar el mismo RUT entre ellos.
const RUT_VALIDO_A = "12.345.678-5";
const RUT_VALIDO_B = "10.000.013-K";
const RUT_VALIDO_C = "20.000.000-5";

describe.skipIf(!hasCredentials)(
  "T-08: panel de moderador — RLS/trigger de sellers, storage y listings (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t08-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t08-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;
    const emailB = `qa-t08-sellerB-${runId}@example.com`;
    const passwordB = `Qa-Test-${runId}-b!`;
    const emailC = `qa-t08-sellerC-${runId}@example.com`;
    const passwordC = `Qa-Test-${runId}-c!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let clientC: SupabaseClient;

    let modUserId: string | undefined;
    let userAId: string | undefined;
    let userBId: string | undefined;
    let userCId: string | undefined;
    let sellerAId: string | undefined;
    let sellerBId: string | undefined;
    let sellerCId: string | undefined;
    const createdListingIds: string[] = [];
    const docPathsC: string[] = [];

    const docPathA = () => `${userAId}/doc-a.txt`;
    const docPathB = () => `${userBId}/doc-b.txt`;

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

      // Vendedor A.
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

      // Vendedor B.
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

      // Vendedor C: usuario SIN fila en sellers todavía (para el vector de
      // INSERT, punto 0/1 del reporte QA). Su fila se crea (o se intenta
      // crear) directamente dentro de los `it` correspondientes, nunca vía
      // service_role, para probar exactamente la ruta que un atacante o la
      // app usarían.
      const { data: userCData, error: userCError } =
        await adminClient.auth.admin.createUser({
          email: emailC,
          password: passwordC,
          email_confirm: true,
        });
      if (userCError || !userCData.user) {
        throw new Error(
          `No se pudo crear el usuario vendedor C: ${userCError?.message}`
        );
      }
      userCId = userCData.user.id;

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

      clientC = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInCError } = await clientC.auth.signInWithPassword({
        email: emailC,
        password: passwordC,
      });
      if (signInCError) {
        throw new Error(
          `No se pudo autenticar al vendedor C: ${signInCError.message}`
        );
      }

      // Documentos de respaldo subidos por cada vendedor a su propio path.
      const { error: uploadAError } = await clientA.storage
        .from("seller-documents")
        .upload(
          docPathA(),
          new Blob(["documento de prueba QA T-08 - A"], {
            type: "text/plain",
          }),
          { contentType: "text/plain", upsert: false }
        );
      if (uploadAError) {
        throw new Error(
          `No se pudo subir el documento del vendedor A: ${uploadAError.message}`
        );
      }

      const { error: uploadBError } = await clientB.storage
        .from("seller-documents")
        .upload(
          docPathB(),
          new Blob(["documento de prueba QA T-08 - B"], {
            type: "text/plain",
          }),
          { contentType: "text/plain", upsert: false }
        );
      if (uploadBError) {
        throw new Error(
          `No se pudo subir el documento del vendedor B: ${uploadBError.message}`
        );
      }

      // Sellers en estado 'pendiente' (vía service_role, para no depender
      // del flujo completo de T-07, ya probado en su propio test).
      const { data: sellerAData, error: sellerAError } = await adminClient
        .from("sellers")
        .insert({
          user_id: userAId,
          seller_type: "persona_natural",
          rut: RUT_VALIDO_A,
          verification_status: "pendiente",
          verification_document_url: docPathA(),
        })
        .select("id")
        .single();
      if (sellerAError || !sellerAData) {
        throw new Error(
          `No se pudo crear el seller A: ${sellerAError?.message}`
        );
      }
      sellerAId = sellerAData.id as string;

      const { data: sellerBData, error: sellerBError } = await adminClient
        .from("sellers")
        .insert({
          user_id: userBId,
          seller_type: "persona_natural",
          rut: RUT_VALIDO_B,
          verification_status: "pendiente",
          verification_document_url: docPathB(),
        })
        .select("id")
        .single();
      if (sellerBError || !sellerBData) {
        throw new Error(
          `No se pudo crear el seller B: ${sellerBError?.message}`
        );
      }
      sellerBId = sellerBData.id as string;
    }, 45_000);

    afterAll(async () => {
      // Limpieza vía service_role (bypassa RLS), best-effort.
      if (createdListingIds.length > 0) {
        await adminClient.from("listings").delete().in("id", createdListingIds);
      }
      if (sellerAId) {
        await adminClient.from("sellers").delete().eq("id", sellerAId);
      }
      if (sellerBId) {
        await adminClient.from("sellers").delete().eq("id", sellerBId);
      }
      if (sellerCId) {
        await adminClient.from("sellers").delete().eq("id", sellerCId);
      }
      // Por si el vector de INSERT hubiera logrado crear una fila fantasma
      // para C (violación crítica), se limpia también por user_id.
      if (userCId) {
        await adminClient.from("sellers").delete().eq("user_id", userCId);
      }
      if (userAId) {
        await adminClient.storage.from("seller-documents").remove([docPathA()]);
      }
      if (userBId) {
        await adminClient.storage.from("seller-documents").remove([docPathB()]);
      }
      if (docPathsC.length > 0) {
        await adminClient.storage.from("seller-documents").remove(docPathsC);
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
      if (userCId) {
        await adminClient.auth.admin.deleteUser(userCId);
      }
    }, 30_000);

    it("los RUT usados por los tres vendedores son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_VALIDO_A)).toBe(true);
      expect(validarRut(RUT_VALIDO_B)).toBe(true);
      expect(validarRut(RUT_VALIDO_C)).toBe(true);
    });

    it(
      "(0) un usuario SIN fila en sellers NO puede insertar directamente su propia fila con verification_status='verificado' (0008, vector de INSERT)",
      async () => {
        const docPath = `${userCId}/doc-c-intento-bypass.txt`;
        const { error: uploadError } = await clientC.storage
          .from("seller-documents")
          .upload(
            docPath,
            new Blob(["documento de prueba QA T-08 - C (bypass intento)"], {
              type: "text/plain",
            }),
            { contentType: "text/plain", upsert: false }
          );
        expect(
          uploadError,
          `no se pudo subir el documento de C: ${uploadError?.message}`
        ).toBeNull();
        docPathsC.push(docPath);

        const { data, error } = await clientC
          .from("sellers")
          .insert({
            user_id: userCId,
            seller_type: "persona_natural",
            rut: RUT_VALIDO_C,
            verification_status: "verificado",
            verification_document_url: docPath,
          })
          .select("id");

        expect(
          error,
          "se esperaba que el trigger sellers_protect_verification_status_insert (0008) bloqueara el insert"
        ).not.toBeNull();
        expect(data).toBeNull();
        expect(error?.message ?? "").toContain(
          "Un vendedor solo puede registrarse con verification_status = pendiente."
        );

        // Confirmación definitiva vía service_role: no quedó ninguna fila
        // fantasma para C.
        const { data: sellerCCheck, error: sellerCCheckError } =
          await adminClient
            .from("sellers")
            .select("id, verification_status")
            .eq("user_id", userCId);
        expect(sellerCCheckError).toBeNull();
        expect(
          sellerCCheck,
          "el usuario C logró insertar su fila de sellers ya 'verificado': violación crítica del trigger de INSERT"
        ).toHaveLength(0);
      },
      20_000
    );

    it(
      "(0) el mismo usuario C SÍ puede insertar su fila con verification_status='pendiente' (flujo legítimo, idéntico a app/vendedor/registro/actions.ts)",
      async () => {
        // Mismo patrón exacto que registrarVendedor() en
        // app/vendedor/registro/actions.ts: sube el documento con el
        // cliente autenticado y luego inserta la fila en `sellers` con
        // verification_status = 'pendiente' (nunca enviado por el
        // formulario ni por el usuario; queda fijo en el código).
        const docPath = `${userCId}/doc-c-legitimo.txt`;
        const { error: uploadError } = await clientC.storage
          .from("seller-documents")
          .upload(
            docPath,
            new Blob(["documento de prueba QA T-08 - C (legítimo)"], {
              type: "text/plain",
            }),
            { contentType: "text/plain", upsert: false }
          );
        expect(
          uploadError,
          `no se pudo subir el documento de C: ${uploadError?.message}`
        ).toBeNull();
        docPathsC.push(docPath);

        const { data, error } = await clientC
          .from("sellers")
          .insert({
            user_id: userCId,
            seller_type: "persona_natural",
            rut: RUT_VALIDO_C,
            verification_status: "pendiente",
            verification_document_url: docPath,
          })
          .select("id, verification_status")
          .single();

        expect(
          error,
          `el registro legítimo de vendedor (verification_status='pendiente') falló: ${error?.message}`
        ).toBeNull();
        expect(data?.verification_status).toBe("pendiente");
        sellerCId = data?.id as string;

        // Confirmación vía service_role.
        const { data: sellerCCheck, error: sellerCCheckError } =
          await adminClient
            .from("sellers")
            .select("verification_status")
            .eq("id", sellerCId)
            .single();
        expect(sellerCCheckError).toBeNull();
        expect(sellerCCheck?.verification_status).toBe("pendiente");
      },
      20_000
    );

    it(
      "(2) el moderador ve AMBAS filas de sellers pendientes (sellers_select_moderator)",
      async () => {
        const { data, error } = await modClient
          .from("sellers")
          .select("id, verification_status, verification_document_url")
          .eq("verification_status", "pendiente")
          .in("id", [sellerAId, sellerBId]);

        expect(error, `select del moderador falló: ${error?.message}`).toBeNull();
        expect(data).toHaveLength(2);
        const ids = (data ?? []).map((s) => s.id).sort();
        expect(ids).toEqual([sellerAId, sellerBId].sort());
      },
      20_000
    );

    it(
      "(2) el moderador puede generar y usar una signed URL para el documento de CUALQUIERA de los dos vendedores",
      async () => {
        const { data: signedA, error: signedAError } =
          await modClient.storage
            .from("seller-documents")
            .createSignedUrl(docPathA(), 60);
        expect(
          signedAError,
          `signed URL para A falló: ${signedAError?.message}`
        ).toBeNull();
        expect(signedA?.signedUrl).toBeTruthy();

        const resA = await fetch(signedA!.signedUrl);
        expect(resA.status).toBe(200);
        expect(await resA.text()).toContain("documento de prueba QA T-08 - A");

        const { data: signedB, error: signedBError } =
          await modClient.storage
            .from("seller-documents")
            .createSignedUrl(docPathB(), 60);
        expect(
          signedBError,
          `signed URL para B falló: ${signedBError?.message}`
        ).toBeNull();
        expect(signedB?.signedUrl).toBeTruthy();

        const resB = await fetch(signedB!.signedUrl);
        expect(resB.status).toBe(200);
        expect(await resB.text()).toContain("documento de prueba QA T-08 - B");
      },
      20_000
    );

    it(
      "(4) un vendedor NO moderador no puede leer la fila de sellers de OTRO vendedor",
      async () => {
        const { data, error } = await clientA
          .from("sellers")
          .select("id")
          .eq("id", sellerBId);

        expect(error, `select cruzado falló con error: ${error?.message}`).toBeNull();
        expect(
          data,
          "sellers_select_moderator no debería aplicar a un vendedor no moderador"
        ).toHaveLength(0);
      },
      20_000
    );

    it(
      "(4) un vendedor NO moderador no puede auto-verificarse (update de su propia fila a 'verificado')",
      async () => {
        const { data, error } = await clientA
          .from("sellers")
          .update({ verification_status: "verificado" })
          .eq("id", sellerAId)
          .select("id, verification_status");

        if (error) {
          expect(error.code === "42501" || error.message.length > 0).toBe(true);
        } else {
          expect(
            data,
            "el update no debería afectar ninguna fila (sellers_update_own no permite este cambio)"
          ).toHaveLength(0);
        }

        // Confirmación definitiva vía service_role: sigue 'pendiente'.
        const { data: sellerAfter, error: sellerAfterError } = await adminClient
          .from("sellers")
          .select("verification_status")
          .eq("id", sellerAId)
          .single();
        expect(sellerAfterError).toBeNull();
        expect(
          sellerAfter?.verification_status,
          "el vendedor logró auto-verificarse: violación crítica de RLS"
        ).toBe("pendiente");
      },
      20_000
    );

    it(
      "(5) un vendedor NO verificado ('pendiente') no puede insertar un listing propio (listings_insert_own exige verificado)",
      async () => {
        const { data, error } = await clientB
          .from("listings")
          .insert({
            seller_id: sellerBId,
            brand: "Nissan",
            model: "Versa",
            year: 2019,
            mileage: 40000,
            price: 7000000,
            vehicle_condition: "usado",
            papers_up_to_date: true,
            usage_type: "familiar",
            location: "Santiago",
          })
          .select("id");

        expect(
          error,
          "se esperaba un error de RLS al insertar un listing con un seller no verificado"
        ).not.toBeNull();
        expect(data).toBeNull();
        expect(error?.code).toBe("42501");
      },
      20_000
    );

    it(
      "(3) el moderador actualiza a un vendedor a 'verificado' y al otro a 'rechazado' (sellers_update_moderator)",
      async () => {
        const { data: verificadoData, error: verificadoError } = await modClient
          .from("sellers")
          .update({ verification_status: "verificado" })
          .eq("id", sellerAId)
          .select("id, verification_status")
          .single();
        expect(
          verificadoError,
          `update a 'verificado' falló: ${verificadoError?.message}`
        ).toBeNull();
        expect(verificadoData?.verification_status).toBe("verificado");

        const { data: rechazadoData, error: rechazadoError } = await modClient
          .from("sellers")
          .update({ verification_status: "rechazado" })
          .eq("id", sellerBId)
          .select("id, verification_status")
          .single();
        expect(
          rechazadoError,
          `update a 'rechazado' falló: ${rechazadoError?.message}`
        ).toBeNull();
        expect(rechazadoData?.verification_status).toBe("rechazado");
      },
      20_000
    );

    it(
      "(5) tras quedar 'rechazado', el vendedor B sigue sin poder publicar anuncios",
      async () => {
        const { data, error } = await clientB
          .from("listings")
          .insert({
            seller_id: sellerBId,
            brand: "Nissan",
            model: "Versa",
            year: 2019,
            mileage: 40000,
            price: 7000000,
            vehicle_condition: "usado",
            papers_up_to_date: true,
            usage_type: "familiar",
            location: "Santiago",
          })
          .select("id");

        expect(
          error,
          "se esperaba un error de RLS: el seller 'rechazado' no debería poder publicar"
        ).not.toBeNull();
        expect(data).toBeNull();
        expect(error?.code).toBe("42501");
      },
      20_000
    );

    it(
      "(5) tras quedar 'verificado', el vendedor A SÍ puede publicar un anuncio",
      async () => {
        const { data, error } = await clientA
          .from("listings")
          .insert({
            seller_id: sellerAId,
            brand: "Toyota",
            model: "Corolla",
            year: 2021,
            mileage: 15000,
            price: 12000000,
            vehicle_condition: "usado",
            papers_up_to_date: true,
            usage_type: "familiar",
            location: "Santiago",
          })
          .select("id, seller_id")
          .single();

        expect(
          error,
          `insert de listing con seller verificado falló: ${error?.message}`
        ).toBeNull();
        expect(data?.seller_id).toBe(sellerAId);

        if (data?.id) {
          createdListingIds.push(data.id as string);
        }
      },
      20_000
    );
  }
);
