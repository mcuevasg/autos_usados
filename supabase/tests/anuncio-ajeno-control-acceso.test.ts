// Test de integración (no unitario) para el fix de control de acceso de
// T-10 en `lib/listings.ts` (`obtenerAnuncioPropio`), consumido por
// `app/vendedor/anuncios/[id]/page.tsx` y
// `app/vendedor/anuncios/[id]/fotos/page.tsx`.
//
// Hallazgo original: esas dos páginas hacían
// `supabase.from("listings").select(...).eq("id", id)` confiando en que
// RLS filtraba el resultado. Pero la policy `listings` de
// 0002_rls_policies.sql es un OR de `listings_select_own` y
// `listings_select_published`: CUALQUIER usuario autenticado puede leer
// un listing ajeno en estado "publicado" vía RLS. Eso permitía que un
// vendedor B viera el resumen/fotos de un anuncio publicado de otro
// vendedor A a través de una URL que en teoría debía ser "propia".
//
// El fix (`obtenerAnuncioPropio`) agrega, en el servidor, un filtro
// EXPLÍCITO `seller_id = <seller del usuario autenticado>` además del
// `id = <listingId>`, de modo que solo devuelve datos si el listing
// pertenece realmente al dueño autenticado.
//
// Este test reproduce esa MISMA lógica (y también llama directamente a
// `obtenerAnuncioPropio`) contra el proyecto Supabase real, para
// confirmar end-to-end:
//   1. Un vendedor A verificado con un listing 'publicado' (con 3+ fotos,
//      como exige el trigger de T-10), usando el flujo legítimo de
//      moderador para verificar al vendedor.
//   2. Autenticado como un vendedor B (NO relacionado, con su propio
//      seller distinto): RLS por sí sola SÍ permite leer el listing
//      publicado de A (confirma que el fix no depende de RLS).
//   3. El mismo B, con el filtro explícito seller_id = seller de B,
//      obtiene 0 filas para el listing de A. `obtenerAnuncioPropio`
//      llamado directamente con las credenciales de B devuelve
//      `{ data: null, error: null }`.
//   4. Un usuario C SIN ninguna fila en `sellers`: `obtenerAnuncioPropio`
//      también devuelve `{ data: null, error: null }` (rama "no tiene
//      seller propio", ni siquiera llega a consultar `listings`).
//   5. Autenticado como A (dueño real): la misma lógica SÍ devuelve el
//      listing, tanto la reproducción manual como `obtenerAnuncioPropio`.
//
// Sigue el mismo patrón que supabase/tests/fotos-anuncio-t10.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/verificar/limpiar datos de
//     prueba sin pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba y ejercer RLS real.
//
// Si las variables de entorno no están disponibles, el test se salta en
// vez de fallar, para no romper `npm test` en checkouts sin secretos.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { obtenerAnuncioPropio } from "../../lib/listings";
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
// no depender de fixtures externas. Solo se necesita para pasar el
// trigger de mínimo 3 fotos del listing de A (T-10), no es objeto de
// este test.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngBlob(): Blob {
  const bytes = Buffer.from(PNG_1X1_BASE64, "base64");
  return new Blob([bytes], { type: "image/png" });
}

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts), uno por
// vendedor.
const RUT_MODERADOR = "12.345.678-5";
const RUT_A = "11.000.010-3";
const RUT_B = "19.000.010-9";

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
  "Control de acceso — obtenerAnuncioPropio (lib/listings.ts) NO se apoya solo en RLS (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-acl-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-acl-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;
    const emailB = `qa-acl-sellerB-${runId}@example.com`;
    const passwordB = `Qa-Test-${runId}-b!`;
    const emailC = `qa-acl-sinseller-${runId}@example.com`;
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
    let listingAId: string | undefined;

    const uploadedPaths: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Moderador (flujo idéntico a T-08/T-10: se promueve vía
      // service_role, algo que solo el propio backend puede hacer).
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

      // Vendedor A (dueño real del listing bajo prueba).
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

      // Vendedor B: verificado, con SU PROPIO seller, pero sin ninguna
      // relación con el listing de A. Representa el caso "con una fila
      // distinta" del hallazgo.
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

      // Usuario C: autenticado, pero SIN ninguna fila en `sellers`.
      // Representa el caso "sin fila propia en sellers".
      const { data: userCData, error: userCError } =
        await adminClient.auth.admin.createUser({
          email: emailC,
          password: passwordC,
          email_confirm: true,
        });
      if (userCError || !userCData.user) {
        throw new Error(
          `No se pudo crear el usuario C (sin seller): ${userCError?.message}`
        );
      }
      userCId = userCData.user.id;

      // Clientes autenticados.
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

      clientC = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInCError } = await clientC.auth.signInWithPassword({
        email: emailC,
        password: passwordC,
      });
      if (signInCError) {
        throw new Error(
          `No se pudo autenticar al usuario C: ${signInCError.message}`
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

      // Listing de A, creado por A (flujo legítimo, listings_insert_own).
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

      // 3 fotos (mínimo exigido por el trigger de T-10 para publicar),
      // subidas por A a su propio listing.
      for (let i = 0; i < 3; i++) {
        const storagePath = `${listingAId}/foto-${i}-${runId}.png`;

        const { error: uploadError } = await clientA.storage
          .from("listing-photos")
          .upload(storagePath, pngBlob(), {
            contentType: "image/png",
            upsert: false,
          });
        if (uploadError) {
          throw new Error(
            `No se pudo subir la foto ${i} del listing de A: ${uploadError.message}`
          );
        }
        uploadedPaths.push(storagePath);

        const { error: insertPhotoError } = await clientA
          .from("listing_photos")
          .insert({
            listing_id: listingAId,
            storage_path: storagePath,
            position: i,
          });
        if (insertPhotoError) {
          throw new Error(
            `No se pudo insertar la fila listing_photos ${i}: ${insertPhotoError.message}`
          );
        }
      }

      // Publicar el listing de A. La acción real de "publicar" (T-12) aún
      // no existe en la app, así que —igual que
      // supabase/tests/fotos-anuncio-t10.test.ts— se hace vía
      // service_role (que bypassa RLS pero NO el trigger de mínimo de
      // fotos, ya satisfecho arriba).
      const { data: publishedData, error: publishError } = await adminClient
        .from("listings")
        .update({ status: "publicado" })
        .eq("id", listingAId)
        .select("id, status")
        .single();
      if (publishError || !publishedData) {
        throw new Error(
          `No se pudo publicar el listing de A: ${publishError?.message}`
        );
      }
      expect(publishedData.status).toBe("publicado");
    }, 60_000);

    afterAll(async () => {
      // Limpieza best-effort vía service_role (bypassa RLS).
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      if (listingAId) {
        await adminClient
          .from("listing_photos")
          .delete()
          .eq("listing_id", listingAId);
        await adminClient.from("listings").delete().eq("id", listingAId);
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
      if (userCId) {
        await adminClient.auth.admin.deleteUser(userCId);
      }
    }, 30_000);

    it("los RUT usados son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_MODERADOR)).toBe(true);
      expect(validarRut(RUT_A)).toBe(true);
      expect(validarRut(RUT_B)).toBe(true);
    });

    it(
      "setup: el listing de A quedó 'publicado' con 3 fotos",
      async () => {
        const { data: listing, error } = await adminClient
          .from("listings")
          .select("status")
          .eq("id", listingAId)
          .single();
        expect(error).toBeNull();
        expect(listing?.status).toBe("publicado");

        const { data: fotos, error: fotosError } = await adminClient
          .from("listing_photos")
          .select("id")
          .eq("listing_id", listingAId);
        expect(fotosError).toBeNull();
        expect(fotos).toHaveLength(3);
      },
      20_000
    );

    it(
      "(2) RLS por sí sola SÍ permite a B leer el listing publicado de A (sin filtro por seller_id)",
      async () => {
        // Exactamente lo que hacía el código ANTES del fix: confiar solo
        // en RLS (listings_select_published, 0002_rls_policies.sql).
        const { data, error } = await clientB
          .from("listings")
          .select("id, status, seller_id")
          .eq("id", listingAId)
          .maybeSingle();

        expect(error).toBeNull();
        expect(
          data,
          "RLS (listings_select_published) debería exponer un listing publicado a cualquier autenticado"
        ).not.toBeNull();
        expect(data?.id).toBe(listingAId);
        expect(data?.status).toBe("publicado");
        expect(data?.seller_id).toBe(sellerAId);
      },
      20_000
    );

    it(
      "(3) autenticado como B, la lógica de obtenerAnuncioPropio (seller propio + filtro seller_id) excluye el listing publicado de A",
      async () => {
        // Paso 1 manual: B busca SU propio seller.
        const { data: ownSeller, error: ownSellerError } = await clientB
          .from("sellers")
          .select("id")
          .eq("user_id", userBId)
          .maybeSingle();
        expect(ownSellerError).toBeNull();
        expect(ownSeller?.id).toBe(sellerBId);
        expect(
          ownSeller?.id,
          "el seller propio de B debe ser distinto del seller dueño del listing de A"
        ).not.toBe(sellerAId);

        // Paso 2 manual: listings filtrado por id Y seller_id = seller de
        // B → debe devolver 0 filas, aunque RLS por sí sola permitiría
        // leer el listing (test anterior).
        const { data: filtrado, error: filtradoError } = await clientB
          .from("listings")
          .select("id, status")
          .eq("id", listingAId)
          .eq("seller_id", ownSeller!.id)
          .maybeSingle();
        expect(filtradoError).toBeNull();
        expect(
          filtrado,
          "el filtro explícito por seller_id de B debe excluir el listing publicado de A"
        ).toBeNull();

        // Llamada directa a la función real usada por las páginas.
        const resultado = await obtenerAnuncioPropio(
          clientB as unknown as Parameters<typeof obtenerAnuncioPropio>[0],
          { listingId: listingAId!, userId: userBId!, select: "id, status" }
        );
        expect(resultado.error).toBeNull();
        expect(
          resultado.data,
          "obtenerAnuncioPropio no debe devolver el listing publicado ajeno de A cuando lo pide B"
        ).toBeNull();
      },
      20_000
    );

    it(
      "(4) autenticado como C (sin ninguna fila propia en sellers), obtenerAnuncioPropio también devuelve null sin llegar a exponer el listing de A",
      async () => {
        const { data: ownSeller, error: ownSellerError } = await clientC
          .from("sellers")
          .select("id")
          .eq("user_id", userCId)
          .maybeSingle();
        expect(ownSellerError).toBeNull();
        expect(
          ownSeller,
          "C no debería tener ninguna fila propia en sellers"
        ).toBeNull();

        const resultado = await obtenerAnuncioPropio(
          clientC as unknown as Parameters<typeof obtenerAnuncioPropio>[0],
          { listingId: listingAId!, userId: userCId!, select: "id, status" }
        );
        expect(resultado.error).toBeNull();
        expect(resultado.data).toBeNull();
      },
      20_000
    );

    it(
      "(5) autenticado como A (dueño real), la misma lógica SÍ devuelve el listing",
      async () => {
        const { data: ownSeller, error: ownSellerError } = await clientA
          .from("sellers")
          .select("id")
          .eq("user_id", userAId)
          .maybeSingle();
        expect(ownSellerError).toBeNull();
        expect(ownSeller?.id).toBe(sellerAId);

        const { data: propio, error: propioError } = await clientA
          .from("listings")
          .select("id, status")
          .eq("id", listingAId)
          .eq("seller_id", ownSeller!.id)
          .maybeSingle();
        expect(propioError).toBeNull();
        expect(propio?.id).toBe(listingAId);
        expect(propio?.status).toBe("publicado");

        const resultado = await obtenerAnuncioPropio(
          clientA as unknown as Parameters<typeof obtenerAnuncioPropio>[0],
          { listingId: listingAId!, userId: userAId!, select: "id, status" }
        );
        expect(resultado.error).toBeNull();
        expect(
          (resultado.data as { id: string } | null)?.id,
          "el dueño real (A) sí debe poder leer su propio listing vía obtenerAnuncioPropio"
        ).toBe(listingAId);
      },
      20_000
    );
  }
);
