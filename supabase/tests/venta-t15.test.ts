// Test de integración (no unitario) de QA para T-15 (REQ-08): solicitud de
// venta concretada por el vendedor.
//
//   "Desde un anuncio en estado 'Publicado', el vendedor puede enviar una
//   solicitud de venta concretada indicando el precio final; el anuncio
//   permanece 'Publicado' mientras la solicitud está pendiente de
//   aprobación."
//
// Archivos bajo prueba: app/vendedor/anuncios/[id]/venta/page.tsx,
// app/vendedor/anuncios/[id]/venta/actions.ts (solicitarVenta), y las
// políticas RLS de `sales` (0002_rls_policies.sql /
// 0003_fix_sales_insert_policy.sql / 0013_sales_insert_requires_published.sql).
//
// HISTORIAL: una versión anterior de esta suite documentaba dos hallazgos
// bloqueantes de la política `sales_insert_own`:
//   (a) no exigía `listings.status = 'publicado'` para el listing
//       referenciado, permitiendo crear solicitudes de venta para anuncios
//       en 'borrador'/'pausado'/etc. vía API directa; y
//   (b) no impedía múltiples solicitudes 'pendiente_aprobacion'
//       simultáneas para el mismo listing (esa protección solo vivía en el
//       `select` previo, no atómico, de `solicitarVenta`).
// Ambos se corrigieron en 0013_sales_insert_requires_published.sql
// (política `sales_insert_own` reemplazada + índice único parcial
// `sales_one_pending_per_listing`). Esta suite ahora verifica que ambos
// hallazgos están cerrados, contra el proyecto Supabase REAL (no un
// mock/local):
//
//   1. Setup: vendedor verificado (vía flujo real de moderador, igual que
//      T-08/T-12) con un anuncio 'publicado' con 3+ fotos (flujo real de
//      T-10/T-12) y un segundo anuncio del mismo vendedor que se queda en
//      'borrador'.
//   2. FIX (a): un insert directo en `sales` para el listing en 'borrador'
//      del mismo vendedor es RECHAZADO por RLS (antes tenía éxito).
//   3. Autenticado como el vendedor dueño, inserta en `sales` solo
//      `listing_id` y `final_price` (sin `status` ni `commission`),
//      exactamente como hace `solicitarVenta`, para el listing publicado:
//      confirma que queda `status='pendiente_aprobacion'` y
//      `commission=null` por default, y que `listings.status` sigue
//      'publicado' después del insert.
//   4. FIX (b): un segundo insert directo en `sales` para el MISMO
//      listing, mientras el primero sigue 'pendiente_aprobacion', es
//      RECHAZADO por el índice único parcial `sales_one_pending_per_listing`
//      (error de constraint 23505), no solo por el `select` previo de
//      `solicitarVenta` (antes tenía éxito).
//   5. Tras aprobar (vía service_role, simulando T-16 que aún no existe)
//      la primera solicitud, un nuevo insert 'pendiente_aprobacion' para
//      el mismo listing SÍ tiene éxito: el índice único es parcial (solo
//      aplica a filas `pendiente_aprobacion`), no bloquea historial ya
//      resuelto.
//   6. `solicitarVenta` (actions.ts) traduce el código de error 23505 al
//      mismo mensaje amigable que ya usaba para el caso detectado por su
//      `select` previo no atómico.
//
// Sigue el mismo patrón que supabase/tests/listing-status-lifecycle-t12.test.ts
// y supabase/tests/rls-sales-insert-policy.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/limpiar datos de prueba sin
//     pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba (moderador y vendedor) y
//     ejercer RLS real, tal como lo haría la app.
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

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngBlob(): Blob {
  const bytes = Buffer.from(PNG_1X1_BASE64, "base64");
  return new Blob([bytes], { type: "image/png" });
}

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts).
const RUT_MODERADOR = "12.345.678-5";
const RUT_A = "9.000.021-7";

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

describe.skipIf(!hasCredentials)(
  "T-15: solicitud de venta concretada por el vendedor (proyecto Supabase real, post-fix 0013)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t15-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t15-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientA: SupabaseClient;

    let modUserId: string | undefined;
    let userAId: string | undefined;
    let sellerAId: string | undefined;

    // Listing publicado, con 3+ fotos: caso principal.
    let listingPublicadoId: string | undefined;
    // Listing en 'borrador' del mismo vendedor: para el fix (a).
    let listingBorradorId: string | undefined;

    // Id de la primera solicitud pendiente creada sobre el listing
    // publicado, reutilizado entre los tests del fix (b).
    let primeraSolicitudId: string | undefined;

    const uploadedPaths: string[] = [];
    const createdSaleIds: string[] = [];

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

      // Seller de A: 'pendiente' vía service_role, verificado por el
      // moderador autenticado (flujo real de T-08).
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

      // Anuncio publicado (flujo real: crea en 'borrador' -> sube 3 fotos
      // -> moderador publica), igual que T-12.
      const { data: listingData, error: listingError } = await clientA
        .from("listings")
        .insert({ seller_id: sellerAId, ...LISTING_BASE })
        .select("id, status")
        .single();
      if (listingError || !listingData) {
        throw new Error(
          `No se pudo crear el listing publicado de A: ${listingError?.message}`
        );
      }
      listingPublicadoId = listingData.id as string;
      expect(listingData.status).toBe("borrador");

      for (let i = 0; i < 3; i++) {
        const storagePath = `${listingPublicadoId}/foto-${i}-${runId}.png`;
        const { error: uploadError } = await clientA.storage
          .from("listing-photos")
          .upload(storagePath, pngBlob(), {
            contentType: "image/png",
            upsert: false,
          });
        if (uploadError) {
          throw new Error(`No se pudo subir la foto ${i}: ${uploadError.message}`);
        }
        uploadedPaths.push(storagePath);

        const { error: insertPhotoError } = await clientA
          .from("listing_photos")
          .insert({
            listing_id: listingPublicadoId,
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
        .eq("id", listingPublicadoId);
      if (publicarError) {
        throw new Error(
          `El moderador no pudo publicar el listing de A: ${publicarError.message}`
        );
      }

      // Segundo anuncio de A, que se queda en 'borrador' (para el fix (a)).
      const { data: listingBorradorData, error: listingBorradorError } =
        await clientA
          .from("listings")
          .insert({
            seller_id: sellerAId,
            ...LISTING_BASE,
            model: "Yaris",
          })
          .select("id, status")
          .single();
      if (listingBorradorError || !listingBorradorData) {
        throw new Error(
          `No se pudo crear el listing en borrador de A: ${listingBorradorError?.message}`
        );
      }
      listingBorradorId = listingBorradorData.id as string;
      expect(listingBorradorData.status).toBe("borrador");
    }, 60_000);

    afterAll(async () => {
      // Limpieza best-effort vía service_role, en orden inverso de FKs.
      if (createdSaleIds.length > 0) {
        await adminClient.from("sales").delete().in("id", createdSaleIds);
      }
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      for (const id of [listingPublicadoId, listingBorradorId]) {
        if (id) {
          await adminClient.from("listing_photos").delete().eq("listing_id", id);
          await adminClient.from("listings").delete().eq("id", id);
        }
      }
      if (sellerAId) {
        await adminClient.from("sellers").delete().eq("id", sellerAId);
      }
      if (modUserId) {
        await adminClient.auth.admin.deleteUser(modUserId);
      }
      if (userAId) {
        await adminClient.auth.admin.deleteUser(userAId);
      }
    }, 30_000);

    it("los RUT usados son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_MODERADOR)).toBe(true);
      expect(validarRut(RUT_A)).toBe(true);
    });

    it(
      "setup: el listing principal de A quedó 'publicado' con 3 fotos, y el segundo listing quedó en 'borrador'",
      async () => {
        const { data, error } = await adminClient
          .from("listings")
          .select("status")
          .eq("id", listingPublicadoId)
          .single();
        expect(error).toBeNull();
        expect(data?.status).toBe("publicado");

        const { data: fotos, error: fotosError } = await adminClient
          .from("listing_photos")
          .select("id")
          .eq("listing_id", listingPublicadoId);
        expect(fotosError).toBeNull();
        expect(fotos).toHaveLength(3);

        const { data: borradorData, error: borradorError } = await adminClient
          .from("listings")
          .select("status")
          .eq("id", listingBorradorId)
          .single();
        expect(borradorError).toBeNull();
        expect(borradorData?.status).toBe("borrador");
      },
      20_000
    );

    it(
      "(2) FIX: un insert directo en `sales` para un listing NO publicado ('borrador') del mismo vendedor es RECHAZADO por RLS",
      async () => {
        const { data, error } = await clientA
          .from("sales")
          .insert({
            listing_id: listingBorradorId,
            final_price: 9000000,
          })
          .select("id");

        expect(
          error,
          "se esperaba un error de RLS (row-level security policy) para un listing no publicado, pero el insert tuvo éxito"
        ).not.toBeNull();
        expect(data).toBeNull();
        expect(error?.code).toBe("42501");
        expect(error?.message.toLowerCase()).toContain("row-level security");

        // Confirmación definitiva vía service_role: no quedó ninguna fila.
        const { data: saleCheck, error: saleCheckError } = await adminClient
          .from("sales")
          .select("id")
          .eq("listing_id", listingBorradorId);
        expect(saleCheckError).toBeNull();
        expect(saleCheck).toHaveLength(0);
      },
      20_000
    );

    it(
      "(3) el vendedor A inserta una solicitud de venta (solo listing_id + final_price, como hace solicitarVenta) para el listing publicado y queda pendiente_aprobacion/commission=null; el listing sigue 'publicado'",
      async () => {
        const { data, error } = await clientA
          .from("sales")
          .insert({
            listing_id: listingPublicadoId,
            final_price: 11500000,
          })
          .select("id, listing_id, final_price, status, commission")
          .single();

        expect(
          error,
          `el insert de la solicitud de venta falló: ${error?.message}`
        ).toBeNull();
        expect(data).not.toBeNull();
        expect(data?.status).toBe("pendiente_aprobacion");
        expect(data?.commission).toBeNull();
        expect(Number(data?.final_price)).toBe(11500000);

        primeraSolicitudId = data?.id as string;
        if (primeraSolicitudId) {
          createdSaleIds.push(primeraSolicitudId);
        }

        // Confirmación definitiva vía service_role.
        const { data: saleCheck, error: saleCheckError } = await adminClient
          .from("sales")
          .select("status, commission")
          .eq("id", primeraSolicitudId)
          .single();
        expect(saleCheckError).toBeNull();
        expect(saleCheck?.status).toBe("pendiente_aprobacion");
        expect(saleCheck?.commission).toBeNull();

        // El listings.status NO cambió: sigue 'publicado'.
        const { data: listingCheck, error: listingCheckError } =
          await adminClient
            .from("listings")
            .select("status")
            .eq("id", listingPublicadoId)
            .single();
        expect(listingCheckError).toBeNull();
        expect(
          listingCheck?.status,
          "el anuncio debe permanecer 'Publicado' mientras la solicitud está pendiente de aprobación (criterio de aceptación T-15)"
        ).toBe("publicado");
      },
      20_000
    );

    it(
      "(4) FIX: un segundo insert directo para el MISMO listing mientras la primera solicitud sigue pendiente es RECHAZADO por el índice único parcial (23505)",
      async () => {
        // Reconfirmamos que ya existe una solicitud pendiente para este
        // listing (creada en el test anterior).
        const { data: pendientesAntes, error: pendientesAntesError } =
          await adminClient
            .from("sales")
            .select("id")
            .eq("listing_id", listingPublicadoId)
            .eq("status", "pendiente_aprobacion");
        expect(pendientesAntesError).toBeNull();
        expect(pendientesAntes).toHaveLength(1);

        const { data, error } = await clientA
          .from("sales")
          .insert({
            listing_id: listingPublicadoId,
            final_price: 12000000,
          })
          .select("id, status, commission");

        expect(
          error,
          "se esperaba un error de constraint (índice único sales_one_pending_per_listing), pero el segundo insert tuvo éxito"
        ).not.toBeNull();
        expect(data).toBeNull();
        expect(error?.code).toBe("23505");
        expect(error?.message).toContain("sales_one_pending_per_listing");

        const { data: pendientesDespues, error: pendientesDespuesError } =
          await adminClient
            .from("sales")
            .select("id")
            .eq("listing_id", listingPublicadoId)
            .eq("status", "pendiente_aprobacion");
        expect(pendientesDespuesError).toBeNull();
        expect(
          pendientesDespues,
          "debe seguir habiendo exactamente 1 solicitud 'pendiente_aprobacion' para el listing: el índice único bloqueó la segunda"
        ).toHaveLength(1);
      },
      20_000
    );

    it(
      "(5) tras aprobar (service_role, simulando T-16) la primera solicitud, SÍ se puede insertar una nueva solicitud pendiente para el mismo listing (el índice único es parcial)",
      async () => {
        expect(primeraSolicitudId).toBeDefined();

        const { error: aprobarError } = await adminClient
          .from("sales")
          .update({ status: "aprobada" })
          .eq("id", primeraSolicitudId!);
        expect(aprobarError).toBeNull();

        const { data: aprobadaCheck, error: aprobadaCheckError } =
          await adminClient
            .from("sales")
            .select("status")
            .eq("id", primeraSolicitudId!)
            .single();
        expect(aprobadaCheckError).toBeNull();
        expect(aprobadaCheck?.status).toBe("aprobada");

        // Ahora el índice único parcial (solo sobre status =
        // 'pendiente_aprobacion') ya no bloquea: se puede insertar una
        // nueva solicitud pendiente para el mismo listing.
        const { data, error } = await clientA
          .from("sales")
          .insert({
            listing_id: listingPublicadoId,
            final_price: 11800000,
          })
          .select("id, status, commission")
          .single();

        expect(
          error,
          `se esperaba que el nuevo insert tuviera éxito tras aprobar la solicitud anterior: ${error?.message}`
        ).toBeNull();
        expect(data?.status).toBe("pendiente_aprobacion");
        expect(data?.commission).toBeNull();

        if (data?.id) {
          createdSaleIds.push(data.id as string);
        }

        // El listing publicado sigue 'publicado' (T-16, que cambiaría el
        // estado a 'vendido' al aprobar, todavía no existe).
        const { data: listingCheck, error: listingCheckError } =
          await adminClient
            .from("listings")
            .select("status")
            .eq("id", listingPublicadoId)
            .single();
        expect(listingCheckError).toBeNull();
        expect(listingCheck?.status).toBe("publicado");
      },
      20_000
    );

    it(
      "(6) solicitarVenta (actions.ts) traduce el error de constraint 23505 al mismo mensaje amigable que usa su chequeo previo de duplicado",
      () => {
        const actionsPath = path.resolve(
          process.cwd(),
          "app/vendedor/anuncios/[id]/venta/actions.ts"
        );
        const source = readFileSync(actionsPath, "utf-8");

        const mensajeEsperado =
          "Ya existe una solicitud de venta pendiente de aprobación para este anuncio.";

        // El mensaje amigable debe aparecer al menos dos veces: una para
        // el `select` previo (no atómico) y otra para el `catch` del
        // código de error 23505 del insert (la garantía atómica real, a
        // nivel de índice único).
        const ocurrencias = source.split(mensajeEsperado).length - 1;
        expect(
          ocurrencias,
          "el mensaje amigable de duplicado debe usarse tanto en el chequeo previo como en el manejo del error 23505"
        ).toBeGreaterThanOrEqual(2);

        expect(source).toContain('insertError.code === "23505"');

        // El manejo del código 23505 debe estar dentro del bloque que
        // procesa el resultado del `insert` final (no del `select`
        // previo), y debe devolver el mensaje amigable esperado.
        const idxCodigo = source.indexOf('insertError.code === "23505"');
        const bloqueDespuesDelCodigo = source.slice(
          idxCodigo,
          idxCodigo + 200
        );
        expect(bloqueDespuesDelCodigo).toContain(mensajeEsperado);
      }
    );
  }
);
