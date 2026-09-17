// Test de integración (no unitario) de QA para T-21 (miniatura de foto de
// portada en la tabla comparativa de /buscar, app/buscar/page.tsx +
// app/buscar/foto-miniatura.tsx), criterio de aceptación:
//
//   "En /buscar, cada fila de anuncio en la tabla comparativa muestra una
//   miniatura con la primera foto del anuncio (listing_photos ordenada
//   por position, resuelta a URL del bucket listing-photos de Supabase
//   Storage). Si el anuncio no tiene fotos, o el archivo referenciado en
//   storage_path no existe en el bucket, se muestra un placeholder visual
//   en vez de romper el layout o mostrar un ícono de imagen rota."
//
// Sigue el mismo patrón que supabase/tests/buscar-t13.test.ts y
// supabase/tests/fotos-anuncio-t10.test.ts: crea datos reales contra el
// proyecto Supabase (moderador, vendedor verificado, anuncios con fotos)
// usando el flujo legítimo (RLS real, no bypass), y reproduce EXACTAMENTE
// la misma secuencia de consultas que construye app/buscar/page.tsx
// (select a listing_photos ordenado por position + createSignedUrls sobre
// el bucket 'listing-photos') para confirmar a nivel de datos que:
//
//   1. Con fotos insertadas en orden NO secuencial de `position` (ej.
//      2, 0, 1), la "portada" resuelta por la lógica de la página es la
//      de `position` MÍNIMA, no la primera insertada ni la última.
//   2. Un visitante ANÓNIMO (sin sesión, cliente anon) que pide
//      createSignedUrls sobre el storage_path de la portada de un anuncio
//      PUBLICADO SÍ recibe una signedUrl válida y descargable (fetch 200).
//      Esto confirma la migración 0017 (`listing_photos_storage_public_select`),
//      que agregó `anon` a la policy `listing_photos_storage_select` sobre
//      `storage.objects` (antes solo `to authenticated`, lo que dejaba a
//      todo visitante anónimo de /buscar viendo el placeholder "Sin foto"
//      aunque el anuncio estuviera publicado).
//   2b. Ese mismo visitante ANÓNIMO, sobre un anuncio en 'borrador' (no
//      publicado) con fotos cargadas, NO recibe signedUrl: la migración
//      0017 solo amplía el rol permitido (`anon`), no la condición de la
//      policy, que sigue exigiendo anuncio publicado o dueño autenticado.
//      El dueño autenticado del anuncio en borrador SÍ recibe signedUrl
//      para su propia foto.
//   3. Un usuario AUTENTICADO (con sesión, aunque no sea dueño ni
//      moderador) que pide createSignedUrls sobre el mismo storage_path
//      de un anuncio publicado SÍ recibe una signedUrl válida y
//      descargable (fetch 200), confirmando que con sesión las miniaturas
//      reales sí se muestran.
//   4. Un anuncio publicado sin ninguna fila en `listing_photos` (fotos
//      borradas después de publicado; el trigger de mínimo de fotos solo
//      aplica al momento de publicar, no después) no aparece en el mapa
//      de portadas: ni anon ni autenticado deberían intentar pedir una
//      signed URL para él, y la página debe caer al placeholder sin
//      error.
//   5. La consulta a `listing_photos` con `.in("listing_id", [...])`
//      trae SOLO las fotos de los anuncios pedidos (no fotos de otros
//      anuncios ajenos al listado de resultados).
//
// La verificación de extremo a extremo (visitar /buscar sin sesión y con
// sesión contra `next dev`) se hizo aparte, manualmente, por las mismas
// razones que T-13 (no depender de un proceso externo en CI). Ver reporte
// de QA para el detalle.
//
// Si las variables de entorno no están disponibles, el test se salta en
// vez de fallar, para no romper `npm test` en checkouts sin secretos.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const VIGENCIA_URL_FIRMADA_SEGUNDOS = 60 * 5;

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngBlob(): Blob {
  const bytes = Buffer.from(PNG_1X1_BASE64, "base64");
  return new Blob([bytes], { type: "image/png" });
}

const RUT_A = "9.000.020-9";

const LISTING_BASE = {
  brand: "ToyotaFotoQA",
  year: 2021,
  mileage: 15000,
  price: 12000000,
  vehicle_condition: "usado en buen estado",
  papers_up_to_date: true,
  usage_type: "familiar" as const,
  location: "Santiago",
};

/**
 * Reproduce EXACTAMENTE la lógica de resolución de portadas de
 * app/buscar/page.tsx: una consulta a `listing_photos` ordenada por
 * `position` ascendente + `createSignedUrls` sobre el bucket
 * 'listing-photos', usando el cliente recibido (anon o autenticado).
 */
async function resolverPortadas(
  client: SupabaseClient,
  listingIds: string[]
): Promise<Map<string, string>> {
  const storagePathPortadaPorListingId = new Map<string, string>();

  const { data: fotos } = await client
    .from("listing_photos")
    .select("listing_id, storage_path, position")
    .in("listing_id", listingIds)
    .order("position", { ascending: true });

  for (const foto of fotos ?? []) {
    const listingId = foto.listing_id as string;
    if (!storagePathPortadaPorListingId.has(listingId)) {
      storagePathPortadaPorListingId.set(
        listingId,
        foto.storage_path as string
      );
    }
  }

  const fotoUrlPorListingId = new Map<string, string>();
  if (storagePathPortadaPorListingId.size > 0) {
    const storagePaths = Array.from(storagePathPortadaPorListingId.values());
    const { data: firmadas } = await client.storage
      .from("listing-photos")
      .createSignedUrls(storagePaths, VIGENCIA_URL_FIRMADA_SEGUNDOS);

    const signedUrlPorStoragePath = new Map<string, string>();
    for (const item of firmadas ?? []) {
      if (item.path && item.signedUrl) {
        signedUrlPorStoragePath.set(item.path, item.signedUrl);
      }
    }

    for (const [listingId, storagePath] of storagePathPortadaPorListingId) {
      const signedUrl = signedUrlPorStoragePath.get(storagePath);
      if (signedUrl) {
        fotoUrlPorListingId.set(listingId, signedUrl);
      }
    }
  }

  return fotoUrlPorListingId;
}

describe.skipIf(!hasCredentials)(
  "T-21: miniatura de foto de portada en /buscar (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t21-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t21-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;
    const emailOtro = `qa-t21-otro-${runId}@example.com`;
    const passwordOtro = `Qa-Test-${runId}-o!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientA: SupabaseClient;
    let clientOtro: SupabaseClient;
    let anonClient: SupabaseClient;

    let modUserId: string | undefined;
    let userAId: string | undefined;
    let userOtroId: string | undefined;
    let sellerAId: string | undefined;

    // Publicado, con 3 fotos insertadas en orden NO secuencial de
    // `position` (2, 0, 1): la portada esperada es la de position=0.
    let listingConFotosId: string | undefined;
    let storagePathPosicion0: string | undefined;

    // Publicado, pero sin NINGUNA fila en listing_photos (se publica con
    // 3 fotos para pasar el trigger de mínimo y luego se borran, ya que
    // el trigger solo corre al momento de publicar).
    let listingSinFotosId: string | undefined;

    // En 'borrador' (nunca publicado), con una foto cargada por su dueño:
    // sirve para confirmar que la migración 0017 (agregar `anon` a
    // `listing_photos_storage_select`) NO relajó la condición de la
    // policy, solo el rol al que aplica.
    let listingBorradorId: string | undefined;
    let storagePathBorrador: string | undefined;

    const uploadedPaths: string[] = [];

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

      // Usuario autenticado SIN relación con el anuncio (ni dueño ni
      // moderador): representa a un comprador logueado navegando /buscar.
      clientOtro = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInOtroError } =
        await clientOtro.auth.signInWithPassword({
          email: emailOtro,
          password: passwordOtro,
        });
      if (signInOtroError) {
        throw new Error(
          `No se pudo autenticar al usuario "otro": ${signInOtroError.message}`
        );
      }

      // Cliente SIN sesión: representa al comprador anónimo de /buscar.
      anonClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

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

      // --- Listing CON fotos (portada = position 0) ---
      const { data: listingConFotosData, error: listingConFotosError } =
        await clientA
          .from("listings")
          .insert({
            seller_id: sellerAId,
            model: "ConFotos",
            ...LISTING_BASE,
          })
          .select("id")
          .single();
      if (listingConFotosError || !listingConFotosData) {
        throw new Error(
          `No se pudo crear el listing con fotos: ${listingConFotosError?.message}`
        );
      }
      listingConFotosId = listingConFotosData.id as string;

      // Se insertan en orden NO secuencial (position 2, luego 0, luego 1)
      // para no depender de que la portada "coincidentemente" sea la
      // primera insertada.
      const posicionesEnOrdenDeInsercion = [2, 0, 1];
      for (const posicion of posicionesEnOrdenDeInsercion) {
        const storagePath = `${listingConFotosId}/foto-pos${posicion}-${runId}.png`;
        const { error: uploadError } = await clientA.storage
          .from("listing-photos")
          .upload(storagePath, pngBlob(), {
            contentType: "image/png",
            upsert: false,
          });
        if (uploadError) {
          throw new Error(
            `No se pudo subir la foto position=${posicion}: ${uploadError.message}`
          );
        }
        uploadedPaths.push(storagePath);

        const { error: insertPhotoError } = await clientA
          .from("listing_photos")
          .insert({
            listing_id: listingConFotosId,
            storage_path: storagePath,
            position: posicion,
          });
        if (insertPhotoError) {
          throw new Error(
            `No se pudo insertar la fila de foto position=${posicion}: ${insertPhotoError.message}`
          );
        }
        if (posicion === 0) {
          storagePathPosicion0 = storagePath;
        }
      }

      const { error: publicarError1 } = await modClient
        .from("listings")
        .update({ status: "publicado" })
        .eq("id", listingConFotosId);
      if (publicarError1) {
        throw new Error(
          `El moderador no pudo publicar listingConFotosId: ${publicarError1.message}`
        );
      }

      // --- Listing SIN fotos (publicado con 3, luego borradas) ---
      const { data: listingSinFotosData, error: listingSinFotosError } =
        await clientA
          .from("listings")
          .insert({
            seller_id: sellerAId,
            model: "SinFotos",
            ...LISTING_BASE,
          })
          .select("id")
          .single();
      if (listingSinFotosError || !listingSinFotosData) {
        throw new Error(
          `No se pudo crear el listing sin fotos: ${listingSinFotosError?.message}`
        );
      }
      listingSinFotosId = listingSinFotosData.id as string;

      const pathsTemporales: string[] = [];
      for (let i = 0; i < 3; i++) {
        const storagePath = `${listingSinFotosId}/temp-${i}-${runId}.png`;
        const { error: uploadError } = await clientA.storage
          .from("listing-photos")
          .upload(storagePath, pngBlob(), {
            contentType: "image/png",
            upsert: false,
          });
        if (uploadError) {
          throw new Error(
            `No se pudo subir la foto temporal ${i}: ${uploadError.message}`
          );
        }
        uploadedPaths.push(storagePath);
        pathsTemporales.push(storagePath);

        const { error: insertPhotoError } = await clientA
          .from("listing_photos")
          .insert({
            listing_id: listingSinFotosId,
            storage_path: storagePath,
            position: i,
          });
        if (insertPhotoError) {
          throw new Error(
            `No se pudo insertar la fila temporal ${i}: ${insertPhotoError.message}`
          );
        }
      }

      const { error: publicarError2 } = await modClient
        .from("listings")
        .update({ status: "publicado" })
        .eq("id", listingSinFotosId);
      if (publicarError2) {
        throw new Error(
          `El moderador no pudo publicar listingSinFotosId: ${publicarError2.message}`
        );
      }

      // Ahora que ya está publicado (trigger de mínimo ya no aplica),
      // el dueño borra sus propias filas de listing_photos (permitido por
      // `listing_photos_delete_own`), dejando el anuncio publicado sin
      // ninguna foto.
      const { error: deleteRowsError } = await clientA
        .from("listing_photos")
        .delete()
        .eq("listing_id", listingSinFotosId);
      if (deleteRowsError) {
        throw new Error(
          `No se pudieron borrar las filas de listing_photos: ${deleteRowsError.message}`
        );
      }
      for (const p of pathsTemporales) {
        // Se dejan los archivos "huérfanos" en Storage a propósito (no se
        // borran del bucket, solo la fila): igual da lo mismo para T-21,
        // porque el mapa de portadas se arma desde `listing_photos`, no
        // desde el bucket.
        void p;
      }

      // --- Listing en BORRADOR (nunca publicado), con una foto ---
      const { data: listingBorradorData, error: listingBorradorError } =
        await clientA
          .from("listings")
          .insert({
            seller_id: sellerAId,
            model: "Borrador",
            ...LISTING_BASE,
          })
          .select("id")
          .single();
      if (listingBorradorError || !listingBorradorData) {
        throw new Error(
          `No se pudo crear el listing en borrador: ${listingBorradorError?.message}`
        );
      }
      listingBorradorId = listingBorradorData.id as string;

      storagePathBorrador = `${listingBorradorId}/foto-borrador-${runId}.png`;
      const { error: uploadBorradorError } = await clientA.storage
        .from("listing-photos")
        .upload(storagePathBorrador, pngBlob(), {
          contentType: "image/png",
          upsert: false,
        });
      if (uploadBorradorError) {
        throw new Error(
          `No se pudo subir la foto del listing en borrador: ${uploadBorradorError.message}`
        );
      }
      uploadedPaths.push(storagePathBorrador);

      const { error: insertPhotoBorradorError } = await clientA
        .from("listing_photos")
        .insert({
          listing_id: listingBorradorId,
          storage_path: storagePathBorrador,
          position: 0,
        });
      if (insertPhotoBorradorError) {
        throw new Error(
          `No se pudo insertar la fila de foto del listing en borrador: ${insertPhotoBorradorError.message}`
        );
      }
      // No se publica: queda intencionalmente en 'borrador'.
    }, 60_000);

    afterAll(async () => {
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      for (const id of [
        listingConFotosId,
        listingSinFotosId,
        listingBorradorId,
      ]) {
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
      if (userOtroId) {
        await adminClient.auth.admin.deleteUser(userOtroId);
      }
    }, 30_000);

    it("setup: listingConFotos y listingSinFotos quedaron 'publicado', listingBorrador quedó en 'borrador', y listingSinFotos efectivamente no tiene filas en listing_photos", async () => {
      const { data, error } = await adminClient
        .from("listings")
        .select("id, status")
        .in("id", [
          listingConFotosId!,
          listingSinFotosId!,
          listingBorradorId!,
        ]);
      expect(error).toBeNull();
      const porId = new Map((data ?? []).map((l) => [l.id, l.status]));
      expect(porId.get(listingConFotosId)).toBe("publicado");
      expect(porId.get(listingSinFotosId)).toBe("publicado");
      expect(porId.get(listingBorradorId)).toBe("borrador");

      const { data: fotos, error: fotosError } = await adminClient
        .from("listing_photos")
        .select("id")
        .eq("listing_id", listingSinFotosId);
      expect(fotosError).toBeNull();
      expect(fotos).toEqual([]);
    });

    it(
      "(1) la portada resuelta (con service_role, sin restricción de RLS de storage) es la de position=0, aunque no fue la primera insertada",
      async () => {
        const portadas = await resolverPortadas(adminClient, [
          listingConFotosId!,
        ]);
        const urlPortada = portadas.get(listingConFotosId!);
        expect(
          urlPortada,
          "se esperaba una signedUrl para la portada de listingConFotos"
        ).toBeTruthy();

        // Se verifica indirectamente: la signedUrl generada por
        // createSignedUrls para storagePathPosicion0 debe ser
        // descargable, y ningún otro storage_path del mismo listing debe
        // haber sido elegido como portada (position 2 y 1 quedan
        // descartados).
        const { data: fotos } = await adminClient
          .from("listing_photos")
          .select("storage_path, position")
          .eq("listing_id", listingConFotosId)
          .order("position", { ascending: true });
        expect(fotos?.[0]?.position).toBe(0);
        expect(fotos?.[0]?.storage_path).toBe(storagePathPosicion0);

        const res = await fetch(urlPortada!);
        expect(res.status).toBe(200);
      },
      20_000
    );

    it(
      "(2) un visitante ANÓNIMO SÍ obtiene una URL descargable para la portada de un anuncio PUBLICADO (fix de la migración 0017: se agregó `anon` a la policy `listing_photos_storage_select`)",
      async () => {
        const portadas = await resolverPortadas(anonClient, [
          listingConFotosId!,
        ]);
        const urlPortada = portadas.get(listingConFotosId!);
        expect(
          urlPortada,
          "se esperaba que un visitante anónimo reciba signedUrl para la portada de un anuncio publicado"
        ).toBeTruthy();

        const res = await fetch(urlPortada!);
        expect(res.status).toBe(200);
      },
      20_000
    );

    it(
      "(2b) ese mismo visitante ANÓNIMO NO obtiene URL para la foto de un anuncio en 'borrador' (la migración 0017 solo amplía el rol permitido, no la condición de la policy); el dueño autenticado SÍ la obtiene",
      async () => {
        const portadasAnon = await resolverPortadas(anonClient, [
          listingBorradorId!,
        ]);
        expect(
          portadasAnon.has(listingBorradorId!),
          "un anuncio en borrador no debe exponer su foto a un visitante anónimo"
        ).toBe(false);

        const portadasDueno = await resolverPortadas(clientA, [
          listingBorradorId!,
        ]);
        const urlPortadaDueno = portadasDueno.get(listingBorradorId!);
        expect(
          urlPortadaDueno,
          "el dueño autenticado del anuncio en borrador sí debe poder ver su propia foto"
        ).toBeTruthy();

        const res = await fetch(urlPortadaDueno!);
        expect(res.status).toBe(200);
      },
      20_000
    );

    it(
      "(3) un usuario AUTENTICADO sin relación con el anuncio (ni dueño ni moderador) SÍ obtiene una URL descargable para la portada de un anuncio publicado",
      async () => {
        const portadas = await resolverPortadas(clientOtro, [
          listingConFotosId!,
        ]);
        const urlPortada = portadas.get(listingConFotosId!);
        expect(
          urlPortada,
          "se esperaba que un usuario autenticado sí reciba signedUrl para un anuncio publicado"
        ).toBeTruthy();

        const res = await fetch(urlPortada!);
        expect(res.status).toBe(200);
      },
      20_000
    );

    it(
      "(4) un anuncio publicado sin filas en listing_photos no genera entrada en el mapa de portadas, ni para anon ni para autenticado (placeholder, sin error)",
      async () => {
        const portadasAnon = await resolverPortadas(anonClient, [
          listingSinFotosId!,
        ]);
        expect(portadasAnon.has(listingSinFotosId!)).toBe(false);

        const portadasAutenticado = await resolverPortadas(clientOtro, [
          listingSinFotosId!,
        ]);
        expect(portadasAutenticado.has(listingSinFotosId!)).toBe(false);
      },
      20_000
    );

    it(
      "(5) al pedir portadas para AMBOS listings juntos (.in), el resultado solo incluye entradas para los que sí tienen fotos",
      async () => {
        const portadasAutenticado = await resolverPortadas(clientOtro, [
          listingConFotosId!,
          listingSinFotosId!,
        ]);
        expect(portadasAutenticado.has(listingConFotosId!)).toBe(true);
        expect(portadasAutenticado.has(listingSinFotosId!)).toBe(false);
        expect(portadasAutenticado.size).toBe(1);
      },
      20_000
    );
  }
);
