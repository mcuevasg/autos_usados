// Test de integración (no unitario) para el criterio de aceptación de T-10
// (app/vendedor/anuncios/[id]/fotos/actions.ts, .../fotos-form.tsx,
// .../foto-item.tsx, .../page.tsx,
// supabase/migrations/0009_listing_photos_storage_and_minimum.sql, y las
// políticas RLS de `listing_photos` en 0002_rls_policies.sql):
//
//   "El vendedor puede subir fotos a Supabase Storage desde el formulario
//   de anuncio; el anuncio no puede enviarse a publicación con menos de 3
//   fotos cargadas." (REQ-03)
//
// Cubre (ver instrucciones de la tarea QA):
//   1-2. Setup: un moderador y dos vendedores VERIFICADOS (flujo real de
//        T-08: sellers insertados en 'pendiente' vía service_role, luego
//        verificados por un cliente autenticado con role='moderador'),
//        cada uno con un listing propio en 'borrador'.
//   3. Autenticado como el vendedor A: sube 2 fotos al bucket
//      'listing-photos' bajo `{listingA.id}/...` e inserta las filas en
//      `listing_photos` → debe funcionar.
//   4. El vendedor A intenta subir una foto bajo el path del listing del
//      vendedor B (que no le pertenece) → debe FALLAR por RLS de storage
//      (y, adicionalmente, el insert de la fila en `listing_photos`
//      también debe fallar por RLS de tabla).
//   5. Con service_role (bypassa RLS pero NO triggers), intenta
//      `update listings set status='publicado'` en el listing de A que
//      solo tiene 2 fotos → debe FALLAR con el mensaje del trigger
//      `prevent_publish_without_min_photos`.
//   6. Sube una tercera foto (llegando a 3) y repite el mismo update a
//      'publicado' → debe FUNCIONAR ahora.
//   7. Un tercer usuario (no dueño) NO puede leer/listar/descargar las
//      fotos del listing de A mientras está en 'borrador' (RLS de
//      storage.objects vía `listing_photos_storage_select`).
//   8. El mismo tercer usuario SÍ puede leer/listar/descargar las fotos
//      una vez que el listing de A quedó 'publicado'.
//
// Este test corre contra el proyecto Supabase REAL (no un mock/local),
// siguiendo el mismo patrón que supabase/tests/moderador-vendedores-t08.test.ts
// y supabase/tests/anuncio-nuevo-t09.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/verificar/limpiar datos y
//     archivos de prueba sin pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba y probar `listings`,
//     `listing_photos` y `storage.objects` sujetos a RLS, tal como lo
//     haría la app.
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

// Un PNG de 1x1 pixel válido (transparente), suficientemente pequeño para
// no depender de fixtures externas.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngBlob(): Blob {
  const bytes = Buffer.from(PNG_1X1_BASE64, "base64");
  return new Blob([bytes], { type: "image/png" });
}

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts), uno por vendedor.
const RUT_MODERADOR = "12.345.678-5";
const RUT_A = "10.000.013-K";
const RUT_B = "20.000.000-5";

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
  "T-10: carga de fotos del anuncio — Storage RLS y trigger de mínimo 3 fotos (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t10-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t10-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;
    const emailB = `qa-t10-sellerB-${runId}@example.com`;
    const passwordB = `Qa-Test-${runId}-b!`;
    const emailOtro = `qa-t10-otro-${runId}@example.com`;
    const passwordOtro = `Qa-Test-${runId}-o!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let clientOtro: SupabaseClient;

    let modUserId: string | undefined;
    let userAId: string | undefined;
    let userBId: string | undefined;
    let userOtroId: string | undefined;
    let sellerAId: string | undefined;
    let sellerBId: string | undefined;
    let listingAId: string | undefined;
    let listingBId: string | undefined;

    const uploadedPaths: string[] = [];

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

      // Usuario "otro": ni dueño ni moderador, para probar lectura de
      // storage (puntos 7 y 8). No necesita fila en sellers.
      const { data: userOtroData, error: userOtroError } =
        await adminClient.auth.admin.createUser({
          email: emailOtro,
          password: passwordOtro,
          email_confirm: true,
        });
      if (userOtroError || !userOtroData.user) {
        throw new Error(
          `No se pudo crear el usuario "otro": ${userOtroError?.message}`
        );
      }
      userOtroId = userOtroData.user.id;

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

      clientOtro = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInOtroError } = await clientOtro.auth.signInWithPassword(
        { email: emailOtro, password: passwordOtro }
      );
      if (signInOtroError) {
        throw new Error(
          `No se pudo autenticar al usuario "otro": ${signInOtroError.message}`
        );
      }

      // Sellers en 'pendiente' vía service_role, luego verificados por el
      // moderador autenticado (flujo real de T-08, no un bypass directo).
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
        throw new Error(`No se pudo crear el seller A: ${sellerAError?.message}`);
      }
      sellerAId = sellerAData.id as string;

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
        throw new Error(`No se pudo crear el seller B: ${sellerBError?.message}`);
      }
      sellerBId = sellerBData.id as string;

      const { error: verifyAError } = await modClient
        .from("sellers")
        .update({ verification_status: "verificado" })
        .eq("id", sellerAId);
      if (verifyAError) {
        throw new Error(
          `El moderador no pudo verificar al seller A: ${verifyAError.message}`
        );
      }

      const { error: verifyBError } = await modClient
        .from("sellers")
        .update({ verification_status: "verificado" })
        .eq("id", sellerBId);
      if (verifyBError) {
        throw new Error(
          `El moderador no pudo verificar al seller B: ${verifyBError.message}`
        );
      }

      // Un listing en 'borrador' por cada vendedor verificado.
      const { data: listingAData, error: listingAError } = await clientA
        .from("listings")
        .insert({ seller_id: sellerAId, brand: "Toyota", ...LISTING_BASE })
        .select("id, status")
        .single();
      if (listingAError || !listingAData) {
        throw new Error(
          `No se pudo crear el listing de A: ${listingAError?.message}`
        );
      }
      listingAId = listingAData.id as string;
      expect(listingAData.status).toBe("borrador");

      const { data: listingBData, error: listingBError } = await clientB
        .from("listings")
        .insert({ seller_id: sellerBId, brand: "Nissan", ...LISTING_BASE })
        .select("id, status")
        .single();
      if (listingBError || !listingBData) {
        throw new Error(
          `No se pudo crear el listing de B: ${listingBError?.message}`
        );
      }
      listingBId = listingBData.id as string;
    }, 60_000);

    afterAll(async () => {
      // Limpieza best-effort vía service_role (bypassa RLS).
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      if (listingAId) {
        await adminClient.from("listing_photos").delete().eq("listing_id", listingAId);
        await adminClient.from("listings").delete().eq("id", listingAId);
      }
      if (listingBId) {
        await adminClient.from("listing_photos").delete().eq("listing_id", listingBId);
        await adminClient.from("listings").delete().eq("id", listingBId);
      }
      if (sellerAId) {
        await adminClient.from("sellers").delete().eq("id", sellerAId);
      }
      if (sellerBId) {
        await adminClient.from("sellers").delete().eq("id", sellerBId);
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
      if (userOtroId) {
        await adminClient.auth.admin.deleteUser(userOtroId);
      }
    }, 30_000);

    it("los RUT usados son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_MODERADOR)).toBe(true);
      expect(validarRut(RUT_A)).toBe(true);
      expect(validarRut(RUT_B)).toBe(true);
    });

    it(
      "(3) el vendedor A sube 2 fotos a su propio listing (Storage + listing_photos)",
      async () => {
        for (let i = 0; i < 2; i++) {
          const storagePath = `${listingAId}/foto-${i}-${runId}.png`;

          const { error: uploadError } = await clientA.storage
            .from("listing-photos")
            .upload(storagePath, pngBlob(), {
              contentType: "image/png",
              upsert: false,
            });
          expect(
            uploadError,
            `subida de foto ${i} falló: ${uploadError?.message}`
          ).toBeNull();
          uploadedPaths.push(storagePath);

          const { error: insertError } = await clientA
            .from("listing_photos")
            .insert({
              listing_id: listingAId,
              storage_path: storagePath,
              position: i,
            });
          expect(
            insertError,
            `insert de fila listing_photos ${i} falló: ${insertError?.message}`
          ).toBeNull();
        }

        const { data: fotos, error: fotosError } = await adminClient
          .from("listing_photos")
          .select("id")
          .eq("listing_id", listingAId);
        expect(fotosError).toBeNull();
        expect(fotos).toHaveLength(2);
      },
      30_000
    );

    it(
      "(4) el vendedor A NO puede subir una foto bajo el path del listing de B (RLS de storage.objects)",
      async () => {
        const storagePath = `${listingBId}/intento-ajeno-${runId}.png`;

        const { data, error } = await clientA.storage
          .from("listing-photos")
          .upload(storagePath, pngBlob(), {
            contentType: "image/png",
            upsert: false,
          });

        expect(
          error,
          "se esperaba que RLS de storage.objects bloqueara la subida a un listing ajeno"
        ).not.toBeNull();
        expect(data).toBeNull();

        // Confirmación con service_role: no quedó el objeto fantasma.
        const { data: listadoB } = await adminClient.storage
          .from("listing-photos")
          .list(listingBId);
        expect(
          listadoB?.some((obj) => obj.name === `intento-ajeno-${runId}.png`),
          "no debería haber quedado ningún objeto en el path del listing de B"
        ).toBeFalsy();
      },
      20_000
    );

    it(
      "(4b) el vendedor A tampoco puede insertar la fila en listing_photos para el listing de B (RLS de tabla)",
      async () => {
        const { data, error } = await clientA
          .from("listing_photos")
          .insert({
            listing_id: listingBId,
            storage_path: `${listingBId}/intento-ajeno-fila-${runId}.png`,
            position: 0,
          })
          .select("id");

        expect(
          error,
          "se esperaba que listing_photos_insert_own bloqueara el insert cruzado"
        ).not.toBeNull();
        expect(data).toBeNull();
      },
      20_000
    );

    it(
      "(7) un usuario ajeno (no dueño) NO puede listar ni descargar las fotos del listing de A mientras está en 'borrador'",
      async () => {
        const { data: listado, error: listadoError } = await clientOtro.storage
          .from("listing-photos")
          .list(listingAId);
        // `list` filtrado por RLS no devuelve error: simplemente no expone
        // objetos que el usuario no puede ver.
        expect(listadoError).toBeNull();
        expect(
          listado ?? [],
          "el usuario ajeno no debería poder listar fotos de un listing en borrador que no es suyo"
        ).toHaveLength(0);

        const primeraFoto = uploadedPaths[0];
        const { data: descarga, error: descargaError } = await clientOtro.storage
          .from("listing-photos")
          .download(primeraFoto);
        expect(
          descargaError,
          "se esperaba que la descarga directa fallara por RLS"
        ).not.toBeNull();
        expect(descarga).toBeNull();

        const { data: signed, error: signedError } = await clientOtro.storage
          .from("listing-photos")
          .createSignedUrl(primeraFoto, 60);
        expect(
          signedError,
          "se esperaba que crear una signed URL fallara por RLS (listing en borrador)"
        ).not.toBeNull();
        expect(signed).toBeNull();
      },
      20_000
    );

    it(
      "(5) con service_role, publicar el listing de A con solo 2 fotos FALLA por el trigger de mínimo 3 fotos",
      async () => {
        const { data, error } = await adminClient
          .from("listings")
          .update({ status: "publicado" })
          .eq("id", listingAId)
          .select("id, status");

        expect(
          error,
          "se esperaba que el trigger prevent_publish_without_min_photos bloqueara la publicación con 2 fotos"
        ).not.toBeNull();
        expect(error?.message ?? "").toContain(
          "El anuncio necesita al menos 3 fotos para poder publicarse."
        );
        expect(data).toBeNull();

        const { data: check, error: checkError } = await adminClient
          .from("listings")
          .select("status")
          .eq("id", listingAId)
          .single();
        expect(checkError).toBeNull();
        expect(check?.status).toBe("borrador");
      },
      20_000
    );

    it(
      "(6) tras subir una tercera foto (llegando a 3), publicar el mismo listing FUNCIONA",
      async () => {
        const storagePath = `${listingAId}/foto-2-${runId}.png`;

        const { error: uploadError } = await clientA.storage
          .from("listing-photos")
          .upload(storagePath, pngBlob(), {
            contentType: "image/png",
            upsert: false,
          });
        expect(uploadError, `subida de la 3ra foto falló: ${uploadError?.message}`).toBeNull();
        uploadedPaths.push(storagePath);

        const { error: insertError } = await clientA.from("listing_photos").insert({
          listing_id: listingAId,
          storage_path: storagePath,
          position: 2,
        });
        expect(insertError, `insert de la 3ra fila falló: ${insertError?.message}`).toBeNull();

        const { data: fotos } = await adminClient
          .from("listing_photos")
          .select("id")
          .eq("listing_id", listingAId);
        expect(fotos).toHaveLength(3);

        const { data, error } = await adminClient
          .from("listings")
          .update({ status: "publicado" })
          .eq("id", listingAId)
          .select("id, status")
          .single();

        expect(
          error,
          `se esperaba que publicar con 3 fotos funcionara: ${error?.message}`
        ).toBeNull();
        expect(data?.status).toBe("publicado");
      },
      20_000
    );

    it(
      "(8) el mismo usuario ajeno SÍ puede ahora listar y descargar las fotos, porque el listing quedó 'publicado'",
      async () => {
        const { data: listado, error: listadoError } = await clientOtro.storage
          .from("listing-photos")
          .list(listingAId);
        expect(listadoError, `list falló: ${listadoError?.message}`).toBeNull();
        expect(listado).toHaveLength(3);

        const primeraFoto = uploadedPaths[0];
        const { data: descarga, error: descargaError } = await clientOtro.storage
          .from("listing-photos")
          .download(primeraFoto);
        expect(
          descargaError,
          `se esperaba poder descargar la foto de un listing publicado: ${descargaError?.message}`
        ).toBeNull();
        expect(descarga).not.toBeNull();

        const { data: signed, error: signedError } = await clientOtro.storage
          .from("listing-photos")
          .createSignedUrl(primeraFoto, 60);
        expect(
          signedError,
          `se esperaba poder crear una signed URL para un listing publicado: ${signedError?.message}`
        ).toBeNull();
        expect(signed?.signedUrl).toBeTruthy();

        const res = await fetch(signed!.signedUrl);
        expect(res.status).toBe(200);
      },
      20_000
    );
  }
);
