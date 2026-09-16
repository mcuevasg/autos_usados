// Test de integración (no unitario) de QA para T-17 (REQ-09): activación
// del plan "Destacado" por un concesionario.
//
//   "Un concesionario puede activar el plan 'Destacado' sobre un anuncio
//   propio en estado 'Publicado', quedando registrada una fecha de
//   expiración (30 días desde la activación)."
//
// Archivos bajo prueba: app/vendedor/anuncios/[id]/destacar/actions.ts
// (activarDestacado), app/vendedor/anuncios/[id]/destacar/destacar-form.tsx,
// app/vendedor/anuncios/[id]/page.tsx (sección "Plan Destacado"), y el
// trigger `listings_protect_featured_activation`
// (supabase/migrations/0015_featured_listings.sql).
//
// Esta suite ejerce el trigger directamente vía `update` sobre `listings`
// (igual que las Server Actions terminan haciendo bajo RLS), sin pasar por
// Next.js, contra el proyecto Supabase REAL (no un mock/local):
//
//   1. Setup: un vendedor CONCESIONARIO verificado (flujo real de
//      moderador, igual que T-08/T-12) con un anuncio 'publicado' con 3+
//      fotos (flujo real de T-10/T-12), y un segundo anuncio del mismo
//      concesionario que se queda en 'borrador'. Un segundo vendedor
//      PERSONA_NATURAL verificado con un anuncio 'publicado' con 3+ fotos.
//   2. El concesionario activa `featured_active: true` sobre su anuncio
//      publicado enviando un `featured_expires_at` arbitrario (deliberada-
//      mente incorrecto): el UPDATE tiene éxito y `featured_expires_at`
//      queda sobreescrito por el trigger a ~30 días desde ahora,
//      ignorando el valor enviado.
//   3. La persona_natural intenta el mismo UPDATE sobre su propio anuncio
//      publicado: es RECHAZADO con el mensaje del trigger sobre
//      "concesionario".
//   4. El mismo concesionario intenta activar destacado sobre su segundo
//      anuncio, en 'borrador' (no publicado): es RECHAZADO con el mensaje
//      del trigger sobre "publicado".
//   5. La DESACTIVACIÓN (`featured_active: false`) funciona sin las
//      validaciones del trigger para cualquier vendedor sobre su propio
//      anuncio, en cualquier estado: se prueba la transición real
//      true -> false del concesionario (tras haberlo destacado y tras
//      haber sido pausado por el moderador, es decir con
//      `status <> 'publicado'`), y la transición trivial false -> false
//      de la persona_natural y del anuncio en 'borrador' del concesionario.
//   6. Tras destacar el anuncio del concesionario, el moderador lo pausa
//      (`status = 'pausado'`) sin tocar `featured_active`; luego el propio
//      concesionario actualiza SOLO `price` (con `featured_active` ya en
//      `true` y sin cambiarlo) y el UPDATE tiene éxito, aunque el anuncio
//      ya no está 'publicado': confirma que el trigger solo se activa en
//      la transición false -> true de `featured_active`, no en cualquier
//      UPDATE de la fila.
//
// Sigue el mismo patrón que supabase/tests/listing-status-lifecycle-t12.test.ts
// y supabase/tests/venta-t15.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/verificar/limpiar datos de
//     prueba sin pasar por RLS/triggers de negocio donde no corresponde.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba y ejercer RLS/triggers
//     reales.
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

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts), no reutilizados
// en otras suites (sellers.rut no tiene constraint de unicidad, pero se
// evita colisión de todos modos).
const RUT_MODERADOR = "12.345.678-5";
const RUT_CONCESIONARIO = "9.000.022-5";
const RUT_PERSONA_NATURAL = "18.000.021-6";

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

async function subirNFotos(
  client: SupabaseClient,
  listingId: string,
  n: number,
  runId: string,
  uploadedPaths: string[]
): Promise<void> {
  for (let i = 0; i < n; i++) {
    const storagePath = `${listingId}/foto-${i}-${runId}.png`;
    const { error: uploadError } = await client.storage
      .from("listing-photos")
      .upload(storagePath, pngBlob(), {
        contentType: "image/png",
        upsert: false,
      });
    expect(
      uploadError,
      `subida de foto ${i} para ${listingId} falló: ${uploadError?.message}`
    ).toBeNull();
    uploadedPaths.push(storagePath);

    const { error: insertError } = await client
      .from("listing_photos")
      .insert({ listing_id: listingId, storage_path: storagePath, position: i });
    expect(
      insertError,
      `insert de fila listing_photos ${i} para ${listingId} falló: ${insertError?.message}`
    ).toBeNull();
  }
}

describe.skipIf(!hasCredentials)(
  "T-17: activación del plan destacado por un concesionario (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t17-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailConce = `qa-t17-conce-${runId}@example.com`;
    const passwordConce = `Qa-Test-${runId}-c!`;
    const emailPersona = `qa-t17-persona-${runId}@example.com`;
    const passwordPersona = `Qa-Test-${runId}-p!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientConce: SupabaseClient;
    let clientPersona: SupabaseClient;

    let modUserId: string | undefined;
    let userConceId: string | undefined;
    let userPersonaId: string | undefined;
    let sellerConceId: string | undefined;
    let sellerPersonaId: string | undefined;

    // Anuncio publicado del concesionario: el que efectivamente se destaca.
    let listingConcePublicadoId: string | undefined;
    // Segundo anuncio del concesionario, se queda en 'borrador'.
    let listingConceBorradorId: string | undefined;
    // Anuncio publicado de la persona_natural.
    let listingPersonaPublicadoId: string | undefined;

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
        throw new Error(`No se pudo crear el moderador: ${modError?.message}`);
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

      // Vendedor concesionario.
      const { data: conceData, error: conceError } =
        await adminClient.auth.admin.createUser({
          email: emailConce,
          password: passwordConce,
          email_confirm: true,
        });
      if (conceError || !conceData.user) {
        throw new Error(
          `No se pudo crear el vendedor concesionario: ${conceError?.message}`
        );
      }
      userConceId = conceData.user.id;

      // Vendedor persona_natural.
      const { data: personaData, error: personaError } =
        await adminClient.auth.admin.createUser({
          email: emailPersona,
          password: passwordPersona,
          email_confirm: true,
        });
      if (personaError || !personaData.user) {
        throw new Error(
          `No se pudo crear el vendedor persona_natural: ${personaError?.message}`
        );
      }
      userPersonaId = personaData.user.id;

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

      clientConce = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInConceError } =
        await clientConce.auth.signInWithPassword({
          email: emailConce,
          password: passwordConce,
        });
      if (signInConceError) {
        throw new Error(
          `No se pudo autenticar al concesionario: ${signInConceError.message}`
        );
      }

      clientPersona = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInPersonaError } =
        await clientPersona.auth.signInWithPassword({
          email: emailPersona,
          password: passwordPersona,
        });
      if (signInPersonaError) {
        throw new Error(
          `No se pudo autenticar a la persona_natural: ${signInPersonaError.message}`
        );
      }

      // Seller concesionario: 'pendiente' vía service_role, verificado por
      // el moderador autenticado (flujo real de T-08).
      const { data: sellerConceData, error: sellerConceError } =
        await adminClient
          .from("sellers")
          .insert({
            user_id: userConceId,
            seller_type: "concesionario",
            rut: RUT_CONCESIONARIO,
            verification_status: "pendiente",
          })
          .select("id")
          .single();
      if (sellerConceError || !sellerConceData) {
        throw new Error(
          `No se pudo crear el seller concesionario: ${sellerConceError?.message}`
        );
      }
      sellerConceId = sellerConceData.id as string;

      const { error: verifyConceError } = await modClient
        .from("sellers")
        .update({ verification_status: "verificado" })
        .eq("id", sellerConceId);
      if (verifyConceError) {
        throw new Error(
          `El moderador no pudo verificar al seller concesionario: ${verifyConceError.message}`
        );
      }

      // Seller persona_natural: mismo flujo.
      const { data: sellerPersonaData, error: sellerPersonaError } =
        await adminClient
          .from("sellers")
          .insert({
            user_id: userPersonaId,
            seller_type: "persona_natural",
            rut: RUT_PERSONA_NATURAL,
            verification_status: "pendiente",
          })
          .select("id")
          .single();
      if (sellerPersonaError || !sellerPersonaData) {
        throw new Error(
          `No se pudo crear el seller persona_natural: ${sellerPersonaError?.message}`
        );
      }
      sellerPersonaId = sellerPersonaData.id as string;

      const { error: verifyPersonaError } = await modClient
        .from("sellers")
        .update({ verification_status: "verificado" })
        .eq("id", sellerPersonaId);
      if (verifyPersonaError) {
        throw new Error(
          `El moderador no pudo verificar al seller persona_natural: ${verifyPersonaError.message}`
        );
      }

      // Anuncio publicado del concesionario (flujo real T-09/T-10/T-12).
      const { data: listingConceData, error: listingConceError } =
        await clientConce
          .from("listings")
          .insert({ seller_id: sellerConceId, brand: "Toyota", ...LISTING_BASE })
          .select("id, status")
          .single();
      if (listingConceError || !listingConceData) {
        throw new Error(
          `No se pudo crear el listing del concesionario: ${listingConceError?.message}`
        );
      }
      listingConcePublicadoId = listingConceData.id as string;
      expect(listingConceData.status).toBe("borrador");

      await subirNFotos(
        clientConce,
        listingConcePublicadoId,
        3,
        runId,
        uploadedPaths
      );

      const { data: listingPublicadoData, error: listingPublicadoError } =
        await modClient
          .from("listings")
          .update({ status: "publicado" })
          .eq("id", listingConcePublicadoId)
          .select("id, status")
          .single();
      if (listingPublicadoError || !listingPublicadoData) {
        throw new Error(
          `El moderador no pudo publicar el listing del concesionario: ${listingPublicadoError?.message}`
        );
      }
      expect(listingPublicadoData.status).toBe("publicado");

      // Segundo anuncio del concesionario: se queda en 'borrador'.
      const { data: listingBorradorData, error: listingBorradorError } =
        await clientConce
          .from("listings")
          .insert({ seller_id: sellerConceId, brand: "Nissan", ...LISTING_BASE })
          .select("id, status")
          .single();
      if (listingBorradorError || !listingBorradorData) {
        throw new Error(
          `No se pudo crear el segundo listing del concesionario: ${listingBorradorError?.message}`
        );
      }
      listingConceBorradorId = listingBorradorData.id as string;
      expect(listingBorradorData.status).toBe("borrador");

      // Anuncio publicado de la persona_natural.
      const { data: listingPersonaData, error: listingPersonaError } =
        await clientPersona
          .from("listings")
          .insert({ seller_id: sellerPersonaId, brand: "Mazda", ...LISTING_BASE })
          .select("id, status")
          .single();
      if (listingPersonaError || !listingPersonaData) {
        throw new Error(
          `No se pudo crear el listing de la persona_natural: ${listingPersonaError?.message}`
        );
      }
      listingPersonaPublicadoId = listingPersonaData.id as string;

      await subirNFotos(
        clientPersona,
        listingPersonaPublicadoId,
        3,
        runId,
        uploadedPaths
      );

      const {
        data: listingPersonaPublicadaData,
        error: listingPersonaPublicadaError,
      } = await modClient
        .from("listings")
        .update({ status: "publicado" })
        .eq("id", listingPersonaPublicadoId)
        .select("id, status")
        .single();
      if (listingPersonaPublicadaError || !listingPersonaPublicadaData) {
        throw new Error(
          `El moderador no pudo publicar el listing de la persona_natural: ${listingPersonaPublicadaError?.message}`
        );
      }
      expect(listingPersonaPublicadaData.status).toBe("publicado");
    }, 90_000);

    afterAll(async () => {
      // Limpieza best-effort vía service_role.
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      for (const id of [
        listingConcePublicadoId,
        listingConceBorradorId,
        listingPersonaPublicadoId,
      ]) {
        if (id) {
          await adminClient.from("listing_photos").delete().eq("listing_id", id);
          await adminClient.from("listings").delete().eq("id", id);
        }
      }
      if (sellerConceId) {
        await adminClient.from("sellers").delete().eq("id", sellerConceId);
      }
      if (sellerPersonaId) {
        await adminClient.from("sellers").delete().eq("id", sellerPersonaId);
      }
      if (modUserId) {
        await adminClient.auth.admin.deleteUser(modUserId);
      }
      if (userConceId) {
        await adminClient.auth.admin.deleteUser(userConceId);
      }
      if (userPersonaId) {
        await adminClient.auth.admin.deleteUser(userPersonaId);
      }
    }, 30_000);

    it("los RUT usados son válidos según validarRut (T-06)", () => {
      expect(validarRut(RUT_MODERADOR)).toBe(true);
      expect(validarRut(RUT_CONCESIONARIO)).toBe(true);
      expect(validarRut(RUT_PERSONA_NATURAL)).toBe(true);
    });

    it(
      "(2) el concesionario activa el plan destacado sobre su anuncio publicado; featured_expires_at queda en ~30 días desde ahora, ignorando el valor enviado",
      async () => {
        // Se envía deliberadamente un featured_expires_at incorrecto (solo
        // 1 día), para confirmar que el trigger lo ignora y lo sobreescribe.
        const valorArbitrarioIncorrecto = new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString();

        const antesDelUpdate = Date.now();

        const { data, error } = await clientConce
          .from("listings")
          .update({
            featured_active: true,
            featured_expires_at: valorArbitrarioIncorrecto,
          })
          .eq("id", listingConcePublicadoId)
          .select("id, featured_active, featured_expires_at")
          .single();

        expect(
          error,
          `se esperaba que el concesionario pudiera activar el plan destacado: ${error?.message}`
        ).toBeNull();
        expect(data?.featured_active).toBe(true);

        const expiresAt = new Date(data!.featured_expires_at as string).getTime();
        const diasDesdeAhora =
          (expiresAt - antesDelUpdate) / (1000 * 60 * 60 * 24);

        // Rango amplio (29 a 31 días) para tolerar el tiempo de ejecución
        // del test, sin exigir un valor exacto.
        expect(diasDesdeAhora).toBeGreaterThan(29);
        expect(diasDesdeAhora).toBeLessThan(31);

        // Y, sobre todo, NO debe coincidir (ni de cerca) con el valor
        // arbitrario de 1 día enviado por el cliente.
        const diasValorEnviado =
          (new Date(valorArbitrarioIncorrecto).getTime() - antesDelUpdate) /
          (1000 * 60 * 60 * 24);
        expect(diasValorEnviado).toBeLessThan(2);
      },
      30_000
    );

    it(
      "(3) una persona_natural NO puede activar el plan destacado sobre su propio anuncio publicado (trigger: mensaje sobre 'concesionario')",
      async () => {
        const { data, error } = await clientPersona
          .from("listings")
          .update({ featured_active: true })
          .eq("id", listingPersonaPublicadoId)
          .select("id, featured_active");

        expect(
          error,
          "se esperaba que el trigger bloqueara la activación por una persona_natural"
        ).not.toBeNull();
        expect(error?.message ?? "").toContain("concesionario");
        expect(data).toBeNull();

        const { data: check, error: checkError } = await adminClient
          .from("listings")
          .select("featured_active, featured_expires_at")
          .eq("id", listingPersonaPublicadoId)
          .single();
        expect(checkError).toBeNull();
        expect(check?.featured_active).toBe(false);
        expect(check?.featured_expires_at).toBeNull();
      },
      20_000
    );

    it(
      "(4) el concesionario NO puede activar el plan destacado sobre un anuncio propio en 'borrador' (trigger: mensaje sobre 'publicado')",
      async () => {
        const { data, error } = await clientConce
          .from("listings")
          .update({ featured_active: true })
          .eq("id", listingConceBorradorId)
          .select("id, featured_active");

        expect(
          error,
          "se esperaba que el trigger bloqueara la activación sobre un anuncio no publicado"
        ).not.toBeNull();
        expect(error?.message ?? "").toContain("publicado");
        expect(data).toBeNull();

        const { data: check, error: checkError } = await adminClient
          .from("listings")
          .select("featured_active, featured_expires_at, status")
          .eq("id", listingConceBorradorId)
          .single();
        expect(checkError).toBeNull();
        expect(check?.status).toBe("borrador");
        expect(check?.featured_active).toBe(false);
        expect(check?.featured_expires_at).toBeNull();
      },
      20_000
    );

    it(
      "(6) actualizar OTRA columna (price) de un listing ya destacado, incluso si el status ya no es 'publicado', tiene éxito: el trigger solo se activa en la transición false -> true de featured_active",
      async () => {
        // El moderador pausa el anuncio ya destacado del concesionario
        // (status pasa a 'pausado'), SIN tocar featured_active.
        const { data: pausado, error: pausadoError } = await modClient
          .from("listings")
          .update({ status: "pausado" })
          .eq("id", listingConcePublicadoId)
          .select("id, status, featured_active")
          .single();
        expect(pausadoError, `el moderador no pudo pausar el anuncio: ${pausadoError?.message}`).toBeNull();
        expect(pausado?.status).toBe("pausado");
        expect(
          pausado?.featured_active,
          "featured_active no debió cambiar al pausar el status"
        ).toBe(true);

        // El dueño actualiza SOLO price (sin tocar featured_active). Si el
        // trigger se disparara en cada UPDATE (no solo en la transición),
        // esto fallaría porque status ya no es 'publicado'.
        const nuevoPrecio = LISTING_BASE.price + 500_000;
        const { data: actualizado, error: actualizadoError } = await clientConce
          .from("listings")
          .update({ price: nuevoPrecio })
          .eq("id", listingConcePublicadoId)
          .select("id, price, featured_active, status")
          .single();

        expect(
          actualizadoError,
          `se esperaba que actualizar price NO disparara las validaciones del trigger: ${actualizadoError?.message}`
        ).toBeNull();
        expect(actualizado?.price).toBe(nuevoPrecio);
        expect(actualizado?.featured_active).toBe(true);
        expect(actualizado?.status).toBe("pausado");
      },
      20_000
    );

    it(
      "(5) la desactivación (featured_active: false) funciona sin restricciones para cualquier vendedor, en cualquier estado",
      async () => {
        // (a) Transición real true -> false del concesionario, con el
        // anuncio actualmente 'pausado' (no 'publicado').
        const { data: desactivadoConce, error: desactivadoConceError } =
          await clientConce
            .from("listings")
            .update({ featured_active: false })
            .eq("id", listingConcePublicadoId)
            .select("id, featured_active, status")
            .single();
        expect(
          desactivadoConceError,
          `se esperaba que el concesionario pudiera desactivar el plan destacado: ${desactivadoConceError?.message}`
        ).toBeNull();
        expect(desactivadoConce?.featured_active).toBe(false);
        expect(desactivadoConce?.status).toBe("pausado");

        // (b) Transición trivial false -> false de la persona_natural
        // sobre su propio anuncio publicado (nunca pudo activarlo, sigue
        // en false).
        const { data: desactivadoPersona, error: desactivadoPersonaError } =
          await clientPersona
            .from("listings")
            .update({ featured_active: false })
            .eq("id", listingPersonaPublicadoId)
            .select("id, featured_active")
            .single();
        expect(
          desactivadoPersonaError,
          `se esperaba que la persona_natural pudiera "desactivar" (ya en false) sin error: ${desactivadoPersonaError?.message}`
        ).toBeNull();
        expect(desactivadoPersona?.featured_active).toBe(false);

        // (c) Transición trivial false -> false del concesionario sobre
        // su anuncio en 'borrador'.
        const { data: desactivadoBorrador, error: desactivadoBorradorError } =
          await clientConce
            .from("listings")
            .update({ featured_active: false })
            .eq("id", listingConceBorradorId)
            .select("id, featured_active, status")
            .single();
        expect(
          desactivadoBorradorError,
          `se esperaba poder "desactivar" (ya en false) sobre un anuncio en borrador sin error: ${desactivadoBorradorError?.message}`
        ).toBeNull();
        expect(desactivadoBorrador?.featured_active).toBe(false);
        expect(desactivadoBorrador?.status).toBe("borrador");
      },
      20_000
    );
  }
);
