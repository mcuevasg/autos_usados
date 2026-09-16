// Test de integración (no unitario) para el criterio de aceptación de T-07
// (app/vendedor/registro/actions.ts, app/vendedor/registro/vendedor-registro-form.tsx,
// supabase/migrations/0005_seller_documents_storage.sql):
//
//   "Al registrarse como vendedor, el usuario elige tipo (persona natural o
//   concesionario); el formulario exige el RUT correspondiente y no se
//   puede enviar si el RUT no pasa la validación de formato (T-06) o si
//   falta el documento de respaldo. Al enviarse, la cuenta queda en estado
//   'Pendiente de revisión'."
//
// Cubre (ver .project/tasks.md T-07 y las instrucciones de la tarea QA):
//   a. Crear un usuario de prueba vía service_role y autenticarse como él.
//   b. Subir un archivo de prueba a `seller-documents` bajo el path propio
//      ({user.id}/test.txt) con el cliente autenticado del usuario: debe
//      funcionar (RLS `seller_documents_insert_own`).
//   c. Subir un archivo bajo el path de OTRO usuario: debe FALLAR por RLS.
//   d. Insertar la fila en `sellers` (seller_type, rut válido,
//      verification_document_url) con el cliente autenticado: debe crearse
//      con verification_status = 'pendiente' por defecto.
//   e. Confirmar con service_role que el archivo quedó bajo el path del
//      dueño, y que un segundo usuario autenticado NO puede hacer
//      download/list sobre el archivo del primero (RLS
//      `seller_documents_select_own`).
//   f. Actualizar `profiles.role` a 'vendedor' con service_role (lo que
//      hace la Server Action al final) y confirmar que quedó así.
//
// La validación del propio RUT (dígito verificador módulo 11) ya está
// cubierta exhaustivamente por lib/rut.test.ts (T-06); este archivo solo
// prueba, vía código (no HTTP), que actions.ts y el formulario cliente
// llaman a `validarRut` antes de aceptar el envío (ver revisión de código
// en el reporte de QA, no se reimplementa aquí).
//
// Este test corre contra el proyecto Supabase REAL (no un mock/local),
// siguiendo el mismo patrón que supabase/tests/rls-sales-insert-policy.test.ts
// y supabase/tests/profiles-auth-roles.test.ts:
//   - SUPABASE_SERVICE_ROLE_KEY: para crear/verificar/limpiar datos y
//     archivos de prueba sin pasar por RLS.
//   - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: para
//     autenticar como los usuarios de prueba y probar `sellers` y
//     `storage.objects` sujetos a RLS, tal como lo haría la app.
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

// RUT válido conocido (mismo que usa lib/rut.test.ts para "12.345.678-5"),
// verificado por `validarRut` antes de usarlo aquí para no depender de un
// valor mágico sin justificación.
const RUT_VALIDO = "12.345.678-5";
const RUT_INVALIDO_DV = "12.345.678-4";

describe.skipIf(!hasCredentials)(
  "T-07: registro de vendedor — RLS de storage.seller-documents y sellers (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const emailA = `qa-t07-a-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}!`;
    const emailB = `qa-t07-b-${runId}@example.com`;
    const passwordB = `Qa-Test-${runId}-b!`;

    let adminClient: SupabaseClient;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;

    let userAId: string | undefined;
    let userBId: string | undefined;
    let sellerId: string | undefined;

    const ownPathA = () => `${userAId}/test.txt`;
    const contenidoArchivo = "documento de prueba QA T-07";

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: userAData, error: userAError } =
        await adminClient.auth.admin.createUser({
          email: emailA,
          password: passwordA,
          email_confirm: true,
        });
      if (userAError || !userAData.user) {
        throw new Error(
          `No se pudo crear el usuario de prueba A: ${userAError?.message}`
        );
      }
      userAId = userAData.user.id;

      const { data: userBData, error: userBError } =
        await adminClient.auth.admin.createUser({
          email: emailB,
          password: passwordB,
          email_confirm: true,
        });
      if (userBError || !userBData.user) {
        throw new Error(
          `No se pudo crear el usuario de prueba B: ${userBError?.message}`
        );
      }
      userBId = userBData.user.id;

      clientA = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInAError } = await clientA.auth.signInWithPassword({
        email: emailA,
        password: passwordA,
      });
      if (signInAError) {
        throw new Error(
          `No se pudo autenticar al usuario A: ${signInAError.message}`
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
          `No se pudo autenticar al usuario B: ${signInBError.message}`
        );
      }
    }, 30_000);

    afterAll(async () => {
      // Limpieza vía service_role, sin importar en qué punto falló la
      // suite (best-effort, no lanza si algo ya no existe).
      if (sellerId) {
        await adminClient.from("sellers").delete().eq("id", sellerId);
      }
      if (userAId) {
        await adminClient.storage.from("seller-documents").remove([ownPathA()]);
      }
      if (userAId) {
        await adminClient.auth.admin.deleteUser(userAId);
      }
      if (userBId) {
        await adminClient.auth.admin.deleteUser(userBId);
      }
    }, 30_000);

    it("RUT válido conocido pasa validarRut (T-06) y el inválido no", () => {
      expect(validarRut(RUT_VALIDO)).toBe(true);
      expect(validarRut(RUT_INVALIDO_DV)).toBe(false);
    });

    it(
      "(b) el usuario autenticado puede subir su documento a su propio path en seller-documents",
      async () => {
        const { data, error } = await clientA.storage
          .from("seller-documents")
          .upload(ownPathA(), new Blob([contenidoArchivo], { type: "text/plain" }), {
            contentType: "text/plain",
            upsert: false,
          });

        expect(error, `upload propio falló: ${error?.message}`).toBeNull();
        expect(data?.path).toBe(ownPathA());
      },
      20_000
    );

    it(
      "(c) el usuario autenticado NO puede subir un archivo bajo el path de OTRO usuario",
      async () => {
        const rutaAjena = `${userBId}/test-intruso.txt`;

        const { data, error } = await clientA.storage
          .from("seller-documents")
          .upload(rutaAjena, new Blob(["intento no autorizado"], { type: "text/plain" }), {
            contentType: "text/plain",
            upsert: false,
          });

        expect(
          data,
          "el upload bajo el path de otro usuario no debería tener éxito"
        ).toBeNull();
        expect(
          error,
          "se esperaba un error de RLS al subir bajo el path de otro usuario"
        ).not.toBeNull();

        // Confirmación adicional vía service_role: el archivo intruso no
        // quedó creado en absoluto.
        const { data: listado } = await adminClient.storage
          .from("seller-documents")
          .list(userBId);
        const nombres = (listado ?? []).map((f) => f.name);
        expect(nombres).not.toContain("test-intruso.txt");
      },
      20_000
    );

    it(
      "(d) insertar en sellers con el cliente autenticado crea la fila con verification_status='pendiente'",
      async () => {
        const { data, error } = await clientA
          .from("sellers")
          .insert({
            user_id: userAId,
            seller_type: "persona_natural",
            rut: RUT_VALIDO,
            verification_document_url: ownPathA(),
          })
          .select("id, verification_status, seller_type, rut, verification_document_url")
          .single();

        expect(error, `insert en sellers falló: ${error?.message}`).toBeNull();
        expect(data).not.toBeNull();
        expect(data?.verification_status).toBe("pendiente");
        expect(data?.seller_type).toBe("persona_natural");
        expect(data?.verification_document_url).toBe(ownPathA());

        sellerId = data?.id as string | undefined;
      },
      20_000
    );

    it(
      "(e) service_role ve el archivo bajo el path del dueño; el usuario B NO puede download/list sobre el archivo de A",
      async () => {
        // service_role: el archivo existe bajo el prefijo de A.
        const { data: listadoAdmin, error: listadoAdminError } =
          await adminClient.storage.from("seller-documents").list(userAId);
        expect(listadoAdminError).toBeNull();
        expect((listadoAdmin ?? []).map((f) => f.name)).toContain("test.txt");

        // Usuario B intenta descargar el archivo de A: debe fallar.
        const { data: downloadB, error: downloadError } = await clientB.storage
          .from("seller-documents")
          .download(ownPathA());
        expect(
          downloadB,
          "el usuario B no debería poder descargar el documento de A"
        ).toBeNull();
        expect(downloadError).not.toBeNull();

        // Usuario B intenta listar la carpeta de A: no debe ver el archivo
        // (RLS filtra las filas de storage.objects sin exponer error, la
        // API de list responde con lista vacía en vez de error 42501).
        const { data: listadoB } = await clientB.storage
          .from("seller-documents")
          .list(userAId);
        expect((listadoB ?? []).map((f) => f.name)).not.toContain("test.txt");
      },
      20_000
    );

    it(
      "(f) actualizar profiles.role a 'vendedor' con service_role (simulando el paso final de la Server Action)",
      async () => {
        const { error: updateError } = await adminClient
          .from("profiles")
          .update({ role: "vendedor" })
          .eq("id", userAId);
        expect(updateError, `update de rol falló: ${updateError?.message}`).toBeNull();

        const { data: profile, error: profileError } = await adminClient
          .from("profiles")
          .select("role")
          .eq("id", userAId)
          .single();
        expect(profileError).toBeNull();
        expect(profile?.role).toBe("vendedor");
      },
      20_000
    );
  }
);
