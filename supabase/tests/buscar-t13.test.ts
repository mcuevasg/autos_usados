// Test de integración (no unitario) de QA para T-13 (página pública de
// búsqueda de anuncios, app/buscar/page.tsx), criterio de aceptación
// REQ-06:
//
//   "El comprador puede filtrar anuncios publicados combinando marca,
//   modelo, año y ubicación; los resultados solo incluyen anuncios en
//   estado 'Publicado' que cumplen todos los filtros; si no hay
//   resultados, se muestra un listado vacío con mensaje, no un error."
//
// Sigue el mismo patrón que supabase/tests/listing-status-lifecycle-t12.test.ts:
// crea datos reales contra el proyecto Supabase (moderador, vendedor
// verificado, anuncios con fotos) usando el flujo legítimo (RLS real, no
// bypass), y ejerce EXACTAMENTE la misma consulta que construye
// app/buscar/page.tsx (status='publicado' + .ilike/.eq por filtro) con el
// cliente anon (visitante sin sesión), para confirmar a nivel de datos
// que:
//   1. Sin filtros, un anon ve los anuncios publicados (y no otros).
//   2. Filtrando por marca, solo aparecen anuncios 'publicado' con esa
//      marca; un anuncio con la MISMA marca pero 'pausado' no aparece.
//   3. Combinando marca + ubicación (AND), solo aparece el anuncio que
//      cumple AMBOS filtros, no uno que solo cumple uno de los dos.
//   4. Un filtro sin coincidencias no genera error (data vacío, sin
//      excepción) — la página muestra el mensaje de "sin resultados".
//   5. Un valor de año no numérico ('abc') hace que la página (según su
//      lógica de app/buscar/page.tsx) ignore el filtro de año en vez de
//      fallar: se reproduce aquí la misma guarda (`Number.isInteger`).
//
// La verificación de extremo a extremo por HTTP (curl contra `next dev`,
// confirmando HTML real) se hizo aparte, manualmente, porque requiere un
// servidor corriendo y no debe ser parte de `npm run test` (evita
// depender de un proceso externo en CI). Ver reporte de QA para el
// detalle de esa verificación HTTP.
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

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngBlob(): Blob {
  const bytes = Buffer.from(PNG_1X1_BASE64, "base64");
  return new Blob([bytes], { type: "image/png" });
}

const RUT_A = "9.000.020-9";

const LISTING_BASE = {
  year: 2021,
  mileage: 15000,
  price: 12000000,
  vehicle_condition: "usado en buen estado",
  papers_up_to_date: true,
  usage_type: "familiar" as const,
};

/**
 * Reproduce EXACTAMENTE la consulta que construye app/buscar/page.tsx
 * (mismos campos, mismo .eq('status', 'publicado'), mismos .ilike/.eq),
 * para no probar una consulta "parecida" sino la real.
 */
function consultaBuscar(
  client: SupabaseClient,
  filtros: { brand?: string; model?: string; year?: string; location?: string }
) {
  let query = client
    .from("listings")
    .select("id, brand, model, year, mileage, price, location")
    .eq("status", "publicado");

  const brand = filtros.brand?.trim() ?? "";
  const model = filtros.model?.trim() ?? "";
  const year = filtros.year?.trim() ?? "";
  const location = filtros.location?.trim() ?? "";

  if (brand) query = query.ilike("brand", `%${brand}%`);
  if (model) query = query.ilike("model", `%${model}%`);
  if (location) query = query.ilike("location", `%${location}%`);
  if (year) {
    const yearNumero = Number(year);
    if (Number.isInteger(yearNumero)) {
      query = query.eq("year", yearNumero);
    }
  }

  return query.order("created_at", { ascending: false });
}

describe.skipIf(!hasCredentials)(
  "T-13: búsqueda pública de anuncios (app/buscar/page.tsx, proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const brand = `ToyotaQA123-${runId}`;
    const locationSantiago = `SantiagoQA-${runId}`;
    const locationValparaiso = `ValparaisoQA-${runId}`;

    const emailMod = `qa-t13-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t13-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientA: SupabaseClient;
    let anonClient: SupabaseClient;

    let modUserId: string | undefined;
    let userAId: string | undefined;
    let sellerAId: string | undefined;

    // Publicado, marca+ubicación de prueba (coincide con todos los filtros).
    let listingPublicadoId: string | undefined;
    // Misma marca, pero 'pausado' (NO debe aparecer nunca en /buscar).
    let listingPausadoId: string | undefined;
    // Publicado, misma marca pero OTRA ubicación (para probar el AND).
    let listingOtraUbicacionId: string | undefined;

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

      // --- Listing publicado (marca + ubicación de prueba) ---
      const { data: listingPubData, error: listingPubError } = await clientA
        .from("listings")
        .insert({
          seller_id: sellerAId,
          brand,
          model: "YarisPublicado",
          location: locationSantiago,
          ...LISTING_BASE,
        })
        .select("id")
        .single();
      if (listingPubError || !listingPubData) {
        throw new Error(
          `No se pudo crear el listing publicado: ${listingPubError?.message}`
        );
      }
      listingPublicadoId = listingPubData.id as string;

      // --- Listing misma marca, pausado (no debe aparecer nunca) ---
      const { data: listingPauData, error: listingPauError } = await clientA
        .from("listings")
        .insert({
          seller_id: sellerAId,
          brand,
          model: "CorollaPausado",
          location: locationSantiago,
          ...LISTING_BASE,
        })
        .select("id")
        .single();
      if (listingPauError || !listingPauData) {
        throw new Error(
          `No se pudo crear el listing a pausar: ${listingPauError?.message}`
        );
      }
      listingPausadoId = listingPauData.id as string;

      // --- Listing misma marca, otra ubicación, publicado (para el AND) ---
      const { data: listingOtraData, error: listingOtraError } =
        await clientA
          .from("listings")
          .insert({
            seller_id: sellerAId,
            brand,
            model: "RushCombo",
            location: locationValparaiso,
            ...LISTING_BASE,
          })
          .select("id")
          .single();
      if (listingOtraError || !listingOtraData) {
        throw new Error(
          `No se pudo crear el listing de otra ubicación: ${listingOtraError?.message}`
        );
      }
      listingOtraUbicacionId = listingOtraData.id as string;

      // Fotos mínimas (3) para poder publicar listingPublicadoId y
      // listingOtraUbicacionId. listingPausadoId NO necesita fotos: se
      // mueve directo de 'borrador' a 'pausado' (el trigger de mínimo de
      // fotos solo aplica a la transición hacia 'publicado').
      for (const listingId of [listingPublicadoId, listingOtraUbicacionId]) {
        for (let i = 0; i < 3; i++) {
          const storagePath = `${listingId}/foto-${i}-${runId}.png`;
          const { error: uploadError } = await clientA.storage
            .from("listing-photos")
            .upload(storagePath, pngBlob(), {
              contentType: "image/png",
              upsert: false,
            });
          if (uploadError) {
            throw new Error(
              `No se pudo subir la foto ${i} de ${listingId}: ${uploadError.message}`
            );
          }
          uploadedPaths.push(storagePath);

          const { error: insertPhotoError } = await clientA
            .from("listing_photos")
            .insert({ listing_id: listingId, storage_path: storagePath, position: i });
          if (insertPhotoError) {
            throw new Error(
              `No se pudo insertar la fila de foto ${i} de ${listingId}: ${insertPhotoError.message}`
            );
          }
        }
      }

      const { error: publicarError1 } = await modClient
        .from("listings")
        .update({ status: "publicado" })
        .eq("id", listingPublicadoId);
      if (publicarError1) {
        throw new Error(
          `El moderador no pudo publicar listingPublicadoId: ${publicarError1.message}`
        );
      }

      const { error: publicarError2 } = await modClient
        .from("listings")
        .update({ status: "publicado" })
        .eq("id", listingOtraUbicacionId);
      if (publicarError2) {
        throw new Error(
          `El moderador no pudo publicar listingOtraUbicacionId: ${publicarError2.message}`
        );
      }

      // El "pausado" nunca pasa por 'publicado': va directo de 'borrador'
      // a 'pausado' (transición legítima, permitida al moderador).
      const { error: pausarError } = await modClient
        .from("listings")
        .update({ status: "pausado" })
        .eq("id", listingPausadoId);
      if (pausarError) {
        throw new Error(
          `El moderador no pudo pausar listingPausadoId: ${pausarError.message}`
        );
      }
    }, 60_000);

    afterAll(async () => {
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      for (const id of [
        listingPublicadoId,
        listingPausadoId,
        listingOtraUbicacionId,
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
    }, 30_000);

    it("setup: los 3 listings de prueba quedaron en los estados esperados", async () => {
      const { data, error } = await adminClient
        .from("listings")
        .select("id, status")
        .in("id", [
          listingPublicadoId!,
          listingPausadoId!,
          listingOtraUbicacionId!,
        ]);
      expect(error).toBeNull();
      const porId = new Map((data ?? []).map((l) => [l.id, l.status]));
      expect(porId.get(listingPublicadoId)).toBe("publicado");
      expect(porId.get(listingPausadoId)).toBe("pausado");
      expect(porId.get(listingOtraUbicacionId)).toBe("publicado");
    });

    it(
      "(1) sin filtros, un visitante anónimo ve los anuncios publicados de prueba (y ninguno de los no-publicados)",
      async () => {
        const { data, error } = await consultaBuscar(anonClient, {});
        expect(error).toBeNull();
        const ids = (data ?? []).map((l) => l.id);
        expect(ids).toContain(listingPublicadoId);
        expect(ids).toContain(listingOtraUbicacionId);
        expect(ids).not.toContain(listingPausadoId);
      },
      20_000
    );

    it(
      "(2) filtrando solo por brand, aparece el publicado con esa marca pero NO el pausado con la MISMA marca",
      async () => {
        const { data, error } = await consultaBuscar(anonClient, { brand });
        expect(error).toBeNull();
        const ids = (data ?? []).map((l) => l.id);
        expect(ids).toContain(listingPublicadoId);
        expect(ids).toContain(listingOtraUbicacionId);
        expect(
          ids,
          "el listing PAUSADO no debe aparecer aunque coincida la marca"
        ).not.toContain(listingPausadoId);
      },
      20_000
    );

    it(
      "(3) combinando brand + location (AND), solo aparece el que cumple AMBOS filtros",
      async () => {
        const { data, error } = await consultaBuscar(anonClient, {
          brand,
          location: locationSantiago,
        });
        expect(error).toBeNull();
        const ids = (data ?? []).map((l) => l.id);
        expect(ids).toEqual([listingPublicadoId]);
        expect(
          ids,
          "el publicado de OTRA ubicación no debe aparecer aunque la marca coincida"
        ).not.toContain(listingOtraUbicacionId);
        expect(ids).not.toContain(listingPausadoId);
      },
      20_000
    );

    it(
      "(4) un filtro sin coincidencias no genera error: data vacío, sin excepción",
      async () => {
        const { data, error } = await consultaBuscar(anonClient, {
          brand: `NoExisteXYZ123-${runId}`,
        });
        expect(error).toBeNull();
        expect(data).toEqual([]);
      },
      20_000
    );

    it(
      "(5) year='abc' (no numérico) no rompe la consulta: se ignora el filtro de año, igual que hace app/buscar/page.tsx",
      async () => {
        const { data, error } = await consultaBuscar(anonClient, {
          brand,
          year: "abc",
        });
        expect(error).toBeNull();
        const ids = (data ?? []).map((l) => l.id);
        // Con year='abc' ignorado, se comporta igual que filtrar solo por
        // brand: deben aparecer los 2 publicados con esa marca.
        expect(ids).toContain(listingPublicadoId);
        expect(ids).toContain(listingOtraUbicacionId);
      },
      20_000
    );

    it(
      "(6) year exacto (2021) sí filtra correctamente cuando es un entero válido",
      async () => {
        const { data, error } = await consultaBuscar(anonClient, {
          brand,
          year: "2021",
        });
        expect(error).toBeNull();
        const ids = (data ?? []).map((l) => l.id);
        expect(ids).toContain(listingPublicadoId);

        const { data: dataOtroAnio, error: errorOtroAnio } =
          await consultaBuscar(anonClient, { brand, year: "1999" });
        expect(errorOtroAnio).toBeNull();
        expect(dataOtroAnio).toEqual([]);
      },
      20_000
    );
  }
);
