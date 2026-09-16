// Test de integración (no unitario) de QA para T-12 (panel de moderador de
// anuncios + ciclo de vida del status), criterio de aceptación REQ-05:
//
//   "Un anuncio nuevo se crea en estado 'Borrador'; solo un moderador
//   puede cambiar su estado entre Borrador, Publicado, Pausado, Vendido y
//   Rechazado; solo los anuncios en estado 'Publicado' aparecen en
//   búsquedas públicas."
//
// (El resto del criterio de T-12 —"Vendido"/"Rechazado" no permiten
// nuevos contactos de compradores— está fuera de alcance: no existe
// funcionalidad de contacto en el proyecto todavía.)
//
// Cubre, contra el proyecto Supabase REAL (no un mock/local):
//   1. Un anuncio nuevo se crea en 'borrador' (reconfirmación puntual;
//      cobertura principal en supabase/tests/anuncio-nuevo-t09.test.ts).
//   2. El vendedor dueño (NO moderador) NO puede cambiar el status de su
//      propio anuncio a NINGUNO de los 4 estados no-borrador, ni siquiera
//      con 3+ fotos ya cargadas (trigger listings_protect_status_update,
//      0010_listing_status_lifecycle.sql).
//   3. Con service_role, INSERTAR un listing directamente con
//      status='publicado' (bypaseando el flujo normal) FALLA (trigger
//      listings_protect_status_insert): bajo service_role, auth.uid() es
//      NULL, así que la condición "es moderador" nunca se cumple, mismo
//      patrón que sellers.verification_status (0007/0008).
//   4. El moderador SÍ puede mover un anuncio ajeno (con 3+ fotos) por
//      las 5 transiciones del ciclo de vida: publicado -> pausado ->
//      vendido -> rechazado (confirma que el bug de visibilidad de fotos
//      de 0011_listing_photos_moderator_access.sql quedó resuelto).
//   5. El moderador NO puede publicar un anuncio con menos de 3 fotos
//      (trigger listings_require_min_photos_to_publish, T-10/0009 sigue
//      vigente).
//   6. Un usuario sin relación (ni dueño ni moderador), autenticado o
//      anónimo, consultando `listings` sin filtro explícito (solo RLS),
//      únicamente ve anuncios con status='publicado'; anuncios en otros
//      estados de otros vendedores no aparecen.
//
// Sigue el mismo patrón que supabase/tests/fotos-anuncio-t10.test.ts y
// supabase/tests/anuncio-ajeno-control-acceso.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/verificar/limpiar datos de
//     prueba sin pasar por RLS/triggers de negocio (aunque, para
//     `listings.status`, los triggers SÍ aplican también a service_role,
//     que es justamente parte de lo que se prueba aquí).
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba y ejercer RLS real.
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

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts), uno por
// vendedor/rol usado en este test.
const RUT_MODERADOR = "12.345.678-5";
const RUT_A = "9.000.020-9";
const RUT_OTRO = "18.000.020-8";

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
  "T-12: ciclo de vida del status de un anuncio — panel de moderador (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t12-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t12-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;
    const emailOtro = `qa-t12-otro-${runId}@example.com`;
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

    // Listing "principal" de A: se usa para las pruebas de transición
    // completa del ciclo de vida (con 3+ fotos).
    let listingAId: string | undefined;
    // Segundo listing de A, con menos de 3 fotos, para el intento fallido
    // de publicación por el moderador.
    let listingPocasFotosId: string | undefined;
    // Tercer listing de A: se queda en 'borrador' y sirve para confirmar
    // que solo lo 'publicado' aparece en búsquedas públicas.
    let listingBorradorId: string | undefined;

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

      // Usuario "otro": ni dueño ni moderador (sin fila en sellers),
      // representa un comprador anónimo/autenticado sin relación.
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

      // Cliente sin ninguna sesión (comprador anónimo).
      anonClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

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
    }, 60_000);

    afterAll(async () => {
      // Limpieza best-effort vía service_role.
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      for (const id of [listingAId, listingPocasFotosId, listingBorradorId]) {
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

    it("los RUT usados son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_MODERADOR)).toBe(true);
      expect(validarRut(RUT_A)).toBe(true);
      expect(validarRut(RUT_OTRO)).toBe(true);
    });

    it(
      "(1) un anuncio nuevo se crea en estado 'borrador'",
      async () => {
        const { data, error } = await clientA
          .from("listings")
          .insert({ seller_id: sellerAId, brand: "Toyota", ...LISTING_BASE })
          .select("id, status")
          .single();

        expect(error, `no se pudo crear el listing de A: ${error?.message}`).toBeNull();
        expect(data?.status).toBe("borrador");
        listingAId = data!.id as string;
      },
      20_000
    );

    it(
      "setup: se suben 3 fotos al listing principal de A (mínimo exigido por T-10 para publicar)",
      async () => {
        for (let i = 0; i < 3; i++) {
          const storagePath = `${listingAId}/foto-${i}-${runId}.png`;
          const { error: uploadError } = await clientA.storage
            .from("listing-photos")
            .upload(storagePath, pngBlob(), {
              contentType: "image/png",
              upsert: false,
            });
          expect(uploadError, `subida de foto ${i} falló: ${uploadError?.message}`).toBeNull();
          uploadedPaths.push(storagePath);

          const { error: insertError } = await clientA
            .from("listing_photos")
            .insert({ listing_id: listingAId, storage_path: storagePath, position: i });
          expect(insertError, `insert de fila listing_photos ${i} falló: ${insertError?.message}`).toBeNull();
        }

        const { data: fotos, error: fotosError } = await adminClient
          .from("listing_photos")
          .select("id")
          .eq("listing_id", listingAId);
        expect(fotosError).toBeNull();
        expect(fotos).toHaveLength(3);
      },
      30_000
    );

    it(
      "(2) el vendedor dueño (NO moderador) NO puede cambiar el status de su propio anuncio a ninguno de los 4 estados no-borrador, aunque tenga 3+ fotos",
      async () => {
        const estadosDestino = ["publicado", "pausado", "vendido", "rechazado"];

        for (const estado of estadosDestino) {
          const { data, error } = await clientA
            .from("listings")
            .update({ status: estado })
            .eq("id", listingAId)
            .select("id, status");

          expect(
            error,
            `se esperaba que el trigger listings_protect_status_update bloqueara el cambio del propio dueño a '${estado}'`
          ).not.toBeNull();
          expect(error?.message ?? "").toContain(
            "Solo un moderador puede cambiar el estado del anuncio."
          );
          expect(data).toBeNull();
        }

        const { data: check, error: checkError } = await adminClient
          .from("listings")
          .select("status")
          .eq("id", listingAId)
          .single();
        expect(checkError).toBeNull();
        expect(
          check?.status,
          "el status del listing de A no debió moverse de 'borrador' tras los intentos del propio dueño"
        ).toBe("borrador");
      },
      30_000
    );

    it(
      "(3) con service_role, INSERTAR un listing directamente con status='publicado' FALLA (trigger listings_protect_status_insert; auth.uid() es NULL bajo service_role, igual que un no-moderador)",
      async () => {
        const { data, error } = await adminClient
          .from("listings")
          .insert({
            seller_id: sellerAId,
            brand: "Nissan",
            ...LISTING_BASE,
            status: "publicado",
          })
          .select("id, status");

        expect(
          error,
          "se esperaba que el trigger listings_protect_status_insert bloqueara el insert directo con status='publicado' bajo service_role"
        ).not.toBeNull();
        expect(error?.message ?? "").toContain(
          "Un anuncio nuevo solo puede crearse en estado borrador."
        );
        expect(data).toBeNull();
      },
      20_000
    );

    it(
      "(5) el moderador NO puede publicar un anuncio con menos de 3 fotos (trigger T-10 sigue vigente)",
      async () => {
        const { data: listingData, error: listingError } = await clientA
          .from("listings")
          .insert({ seller_id: sellerAId, brand: "Mazda", ...LISTING_BASE })
          .select("id, status")
          .single();
        expect(listingError, `no se pudo crear el listing de pocas fotos: ${listingError?.message}`).toBeNull();
        expect(listingData?.status).toBe("borrador");
        listingPocasFotosId = listingData!.id as string;

        // Solo 2 fotos, por debajo del mínimo de 3.
        for (let i = 0; i < 2; i++) {
          const storagePath = `${listingPocasFotosId}/foto-${i}-${runId}.png`;
          const { error: uploadError } = await clientA.storage
            .from("listing-photos")
            .upload(storagePath, pngBlob(), {
              contentType: "image/png",
              upsert: false,
            });
          expect(uploadError).toBeNull();
          uploadedPaths.push(storagePath);

          const { error: insertError } = await clientA
            .from("listing_photos")
            .insert({ listing_id: listingPocasFotosId, storage_path: storagePath, position: i });
          expect(insertError).toBeNull();
        }

        const { data, error } = await modClient
          .from("listings")
          .update({ status: "publicado" })
          .eq("id", listingPocasFotosId)
          .select("id, status");

        expect(
          error,
          "se esperaba que el trigger de mínimo 3 fotos (T-10) bloqueara la publicación con solo 2 fotos, incluso para el moderador"
        ).not.toBeNull();
        expect(error?.message ?? "").toContain(
          "El anuncio necesita al menos 3 fotos para poder publicarse."
        );
        expect(data).toBeNull();

        const { data: check, error: checkError } = await adminClient
          .from("listings")
          .select("status")
          .eq("id", listingPocasFotosId)
          .single();
        expect(checkError).toBeNull();
        expect(check?.status).toBe("borrador");
      },
      30_000
    );

    it(
      "(4) el moderador SÍ puede mover el anuncio ajeno de A (con 3+ fotos) por las transiciones publicado -> pausado -> vendido -> rechazado",
      async () => {
        const transiciones: { destino: string }[] = [
          { destino: "publicado" },
          { destino: "pausado" },
          { destino: "vendido" },
          { destino: "rechazado" },
        ];

        for (const { destino } of transiciones) {
          const { data, error } = await modClient
            .from("listings")
            .update({ status: destino })
            .eq("id", listingAId)
            .select("id, status")
            .single();

          expect(
            error,
            `se esperaba que el moderador pudiera mover el listing de A a '${destino}': ${error?.message}`
          ).toBeNull();
          expect(data?.status).toBe(destino);
        }
      },
      30_000
    );

    it(
      "(6) un usuario sin relación (autenticado, ni dueño ni moderador) SOLO ve anuncios 'publicado' al consultar listings sin filtro explícito (RLS)",
      async () => {
        // Preparamos un listing adicional de A que se queda en 'borrador'
        // (nunca lo toca el moderador), para confirmar que NO aparece.
        const { data: listingBorradorData, error: listingBorradorError } =
          await clientA
            .from("listings")
            .insert({ seller_id: sellerAId, brand: "Kia", ...LISTING_BASE })
            .select("id, status")
            .single();
        expect(listingBorradorError).toBeNull();
        expect(listingBorradorData?.status).toBe("borrador");
        listingBorradorId = listingBorradorData!.id as string;

        // Publicamos un listing "de control" cuyo estado final debe SER
        // visible: usamos un nuevo listing de A, distinto del principal
        // (que ya quedó en 'rechazado' por el test anterior).
        const { data: listingVisibleData, error: listingVisibleError } =
          await clientA
            .from("listings")
            .insert({ seller_id: sellerAId, brand: "Subaru", ...LISTING_BASE })
            .select("id, status")
            .single();
        expect(listingVisibleError).toBeNull();
        const listingVisibleId = listingVisibleData!.id as string;

        // Necesita 3+ fotos para poder publicarse (trigger T-10 sigue
        // vigente y también aplica a este listing "de control").
        for (let i = 0; i < 3; i++) {
          const storagePath = `${listingVisibleId}/foto-${i}-${runId}.png`;
          const { error: uploadError } = await clientA.storage
            .from("listing-photos")
            .upload(storagePath, pngBlob(), {
              contentType: "image/png",
              upsert: false,
            });
          expect(uploadError).toBeNull();
          uploadedPaths.push(storagePath);

          const { error: insertError } = await clientA
            .from("listing_photos")
            .insert({ listing_id: listingVisibleId, storage_path: storagePath, position: i });
          expect(insertError).toBeNull();
        }

        const { data: publicado, error: publicarError } = await modClient
          .from("listings")
          .update({ status: "publicado" })
          .eq("id", listingVisibleId)
          .select("id, status")
          .single();
        expect(publicarError).toBeNull();
        expect(publicado?.status).toBe("publicado");

        // Usuario "otro" autenticado, sin relación: consulta SIN filtro
        // explícito de status, dependiendo solo de RLS.
        const idsRelevantes = [
          listingAId!, // ahora 'rechazado'
          listingPocasFotosId!, // 'borrador' (nunca publicado, faltaron fotos)
          listingBorradorId!, // 'borrador'
          listingVisibleId, // 'publicado'
        ];

        const { data: vistosPorOtro, error: vistosPorOtroError } =
          await clientOtro
            .from("listings")
            .select("id, status, seller_id")
            .in("id", idsRelevantes);
        expect(vistosPorOtroError).toBeNull();

        const idsVistos = (vistosPorOtro ?? []).map((l) => l.id as string);
        expect(idsVistos).toContain(listingVisibleId);
        expect(idsVistos).not.toContain(listingAId);
        expect(idsVistos).not.toContain(listingPocasFotosId);
        expect(idsVistos).not.toContain(listingBorradorId);
        for (const listado of vistosPorOtro ?? []) {
          expect(listado.status).toBe("publicado");
        }

        // Mismo chequeo con un cliente sin sesión (anónimo).
        const { data: vistosPorAnon, error: vistosPorAnonError } =
          await anonClient
            .from("listings")
            .select("id, status")
            .in("id", idsRelevantes);
        expect(vistosPorAnonError).toBeNull();
        const idsVistosAnon = (vistosPorAnon ?? []).map((l) => l.id as string);
        expect(idsVistosAnon).toContain(listingVisibleId);
        expect(idsVistosAnon).not.toContain(listingAId);
        expect(idsVistosAnon).not.toContain(listingPocasFotosId);
        expect(idsVistosAnon).not.toContain(listingBorradorId);
        for (const listado of vistosPorAnon ?? []) {
          expect(listado.status).toBe("publicado");
        }

        // Limpieza del listing "visible" creado en este test específico.
        await adminClient.from("listings").delete().eq("id", listingVisibleId);
      },
      30_000
    );
  }
);
