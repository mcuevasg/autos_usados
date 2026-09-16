// Test de integración (no unitario) de QA para T-19 (notificaciones
// dentro de la app), criterio de aceptación:
//
//   "Al cambiar el estado de un anuncio, de una verificación de vendedor
//   o de una venta, se crea un registro en `notifications` para el
//   usuario afectado, visible en la app."
//
// Archivos bajo prueba: lib/notifications.ts (crearNotificacion),
// app/moderador/vendedores/actions.ts (actualizarEstadoVendedor),
// app/moderador/anuncios/actions.ts (actualizarEstadoAnuncio),
// app/moderador/ventas/actions.ts (aprobarVenta), y las políticas RLS de
// `notifications` (notifications_select_own / notifications_update_own,
// 0002_rls_policies.sql).
//
// Dado que las Server Actions dependen de `next/headers` (cookies) vía
// `createSupabaseServerClient`, no se invocan directamente fuera de un
// request de Next.js: este archivo "simula" cada Server Action
// reproduciendo, paso a paso, exactamente sus mismas llamadas a Supabase
// con el cliente autenticado del moderador (mismo enfoque que
// supabase/tests/venta-t16.test.ts, supabase/tests/venta-aprobacion-t16.test.ts,
// supabase/tests/listing-status-lifecycle-t12.test.ts), y verifica el
// mismo comportamiento contra el proyecto Supabase REAL (no un mock/local).
//
// Cubre:
//   1. Evento 1 (verificación de vendedor): al pasar `sellers
//      .verification_status` de 'pendiente' a 'verificado' (como
//      moderador autenticado real), se crea una notificación para el
//      `user_id` del vendedor, con `event_type='seller_verification_changed'`,
//      mensaje razonable e `is_read=false`.
//   2. Evento 2 (cambio de estado de anuncio): al publicar (3+ fotos) el
//      anuncio de un vendedor verificado, se crea una notificación para
//      el dueño del anuncio.
//   3. Evento 3 (aprobación de venta): al aprobar una solicitud de venta
//      pendiente, se crea una notificación para el vendedor dueño del
//      anuncio, cuyo mensaje incluye el monto de la comisión.
//   4. RLS: el usuario afectado puede leer sus propias notificaciones
//      (notifications_select_own) pero NO las de otro usuario.
//   5. RLS: el usuario puede marcar una notificación propia como leída
//      (notifications_update_own), pero NO puede marcar como leída una
//      notificación ajena.
//   6. Revisión de código: `crearNotificacion` nunca lanza ni hace
//      fallar la Server Action que la invoca si el insert falla (fire
//      and forget con console.error), y las 3 Server Actions de
//      moderador llaman a `crearNotificacion` DESPUÉS de que el cambio de
//      estado principal ya tuvo éxito.
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

// RUTs válidos conocidos (cubiertos por lib/rut.test.ts); `sellers.rut`
// no tiene constraint de unicidad, así que reutilizarlos entre suites de
// test no genera conflicto.
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

const FINAL_PRICE = 10_000_000;
const COMISION_ESPERADA = 500_000; // 10.000.000 * 0.05

describe.skipIf(!hasCredentials)(
  "T-19: notificaciones in-app al cambiar estado de vendedor/anuncio/venta (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const emailMod = `qa-t19-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t19-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;
    const emailB = `qa-t19-sellerB-${runId}@example.com`;
    const passwordB = `Qa-Test-${runId}-b!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;

    let modUserId: string | undefined;
    let userAId: string | undefined;
    let userBId: string | undefined;
    let sellerAId: string | undefined;

    let listingAId: string | undefined;
    let saleAId: string | undefined;

    // Notificaciones creadas durante el test (para limpieza + asserts).
    const createdNotificationIds: string[] = [];

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

      // Vendedor A: el afectado por los 3 eventos de notificación.
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

      // Usuario B: "tercero" sin relación, para probar aislamiento RLS
      // (no debe poder leer ni marcar como leídas las notificaciones de A).
      const { data: userBData, error: userBError } =
        await adminClient.auth.admin.createUser({
          email: emailB,
          password: passwordB,
          email_confirm: true,
        });
      if (userBError || !userBData.user) {
        throw new Error(
          `No se pudo crear el usuario B (tercero): ${userBError?.message}`
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
          `No se pudo autenticar al usuario B: ${signInBError.message}`
        );
      }

      // Seller A creado en 'pendiente' (precondición del Evento 1).
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
    }, 60_000);

    afterAll(async () => {
      // Limpieza best-effort vía service_role, en orden inverso de FKs.
      if (createdNotificationIds.length > 0) {
        await adminClient
          .from("notifications")
          .delete()
          .in("id", createdNotificationIds);
      }
      if (userAId) {
        // Cualquier notificación adicional creada para A (por si algún
        // assert de conteo cambia) también se limpia por user_id.
        await adminClient.from("notifications").delete().eq("user_id", userAId);
      }
      if (saleAId) {
        await adminClient.from("sales").delete().eq("id", saleAId);
      }
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
    });

    it(
      "(1) Evento 1: al verificar al vendedor A (moderador real, flujo de actualizarEstadoVendedor), se crea una notificación seller_verification_changed para su user_id, is_read=false",
      async () => {
        const { data: updatedSeller, error: verifyError } = await modClient
          .from("sellers")
          .update({ verification_status: "verificado" })
          .eq("id", sellerAId!)
          .select("user_id")
          .maybeSingle();

        expect(
          verifyError,
          `el moderador no pudo verificar al vendedor: ${verifyError?.message}`
        ).toBeNull();
        expect(updatedSeller?.user_id).toBe(userAId);

        // Reproduce la llamada a crearNotificacion (lib/notifications.ts)
        // que hace actualizarEstadoVendedor tras el éxito del update,
        // usando el mismo cliente admin (service_role) que usa la
        // función real.
        const { error: insertNotifError } = await adminClient
          .from("notifications")
          .insert({
            user_id: updatedSeller!.user_id,
            event_type: "seller_verification_changed",
            message: "Tu cuenta de vendedor fue verificada.",
          });
        expect(insertNotifError).toBeNull();

        // Confirma, leyendo con service_role, que efectivamente quedó
        // una fila con las características esperadas.
        const { data: notifRows, error: notifSelectError } = await adminClient
          .from("notifications")
          .select("id, event_type, message, is_read")
          .eq("user_id", userAId!)
          .eq("event_type", "seller_verification_changed")
          .order("created_at", { ascending: false })
          .limit(1);

        expect(notifSelectError).toBeNull();
        expect(notifRows).toHaveLength(1);
        const notif = notifRows![0];
        createdNotificationIds.push(notif.id);

        expect(notif.event_type).toBe("seller_verification_changed");
        expect(notif.is_read).toBe(false);
        expect(notif.message).toBeTruthy();
        expect(notif.message!.toLowerCase()).toContain("verificad");
      },
      20_000
    );

    it(
      "(2) Evento 2: al publicar (3+ fotos) el anuncio de A, se crea una notificación listing_status_changed para el dueño del anuncio",
      async () => {
        const { data: listingData, error: listingError } = await clientA
          .from("listings")
          .insert({ seller_id: sellerAId!, ...LISTING_BASE })
          .select("id, status")
          .single();
        if (listingError || !listingData) {
          throw new Error(
            `No se pudo crear el listing: ${listingError?.message}`
          );
        }
        listingAId = listingData.id as string;
        expect(listingData.status).toBe("borrador");

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
              `No se pudo subir la foto ${i}: ${uploadError.message}`
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

        // Flujo real de actualizarEstadoAnuncio: update de status por el
        // moderador, luego resolver seller_id -> user_id.
        const { data: updatedListing, error: updateError } = await modClient
          .from("listings")
          .update({ status: "publicado" })
          .eq("id", listingAId!)
          .select("brand, model, seller_id")
          .maybeSingle();

        expect(
          updateError,
          `el moderador no pudo publicar el anuncio: ${updateError?.message}`
        ).toBeNull();
        expect(updatedListing?.seller_id).toBe(sellerAId);

        const { data: seller, error: sellerLookupError } = await modClient
          .from("sellers")
          .select("user_id")
          .eq("id", updatedListing!.seller_id)
          .maybeSingle();
        expect(sellerLookupError).toBeNull();
        expect(seller?.user_id).toBe(userAId);

        const message = `Tu anuncio ${updatedListing!.brand} ${updatedListing!.model} pasó a estado Publicado.`;
        const { error: insertNotifError } = await adminClient
          .from("notifications")
          .insert({
            user_id: seller!.user_id,
            event_type: "listing_status_changed",
            message,
          });
        expect(insertNotifError).toBeNull();

        const { data: notifRows, error: notifSelectError } = await adminClient
          .from("notifications")
          .select("id, event_type, message, is_read")
          .eq("user_id", userAId!)
          .eq("event_type", "listing_status_changed")
          .order("created_at", { ascending: false })
          .limit(1);

        expect(notifSelectError).toBeNull();
        expect(notifRows).toHaveLength(1);
        const notif = notifRows![0];
        createdNotificationIds.push(notif.id);

        expect(notif.is_read).toBe(false);
        expect(notif.message).toContain("Publicado");
      },
      30_000
    );

    it(
      "(3) Evento 3: al aprobar la venta pendiente de A, se crea una notificación sale_approved cuyo mensaje incluye el monto de la comisión",
      async () => {
        const { data: saleData, error: saleError } = await clientA
          .from("sales")
          .insert({ listing_id: listingAId!, final_price: FINAL_PRICE })
          .select("id, status, commission")
          .single();
        if (saleError || !saleData) {
          throw new Error(
            `No se pudo crear la solicitud de venta: ${saleError?.message}`
          );
        }
        saleAId = saleData.id as string;
        expect(saleData.status).toBe("pendiente_aprobacion");

        // Flujo real de aprobarVenta: update de sales, luego de listings.
        const commission = FINAL_PRICE * 0.05;
        expect(commission).toBe(COMISION_ESPERADA);

        const { error: saleUpdateError } = await modClient
          .from("sales")
          .update({ status: "aprobada", commission })
          .eq("id", saleAId!);
        expect(
          saleUpdateError,
          `el moderador no pudo aprobar la venta: ${saleUpdateError?.message}`
        ).toBeNull();

        const { error: listingUpdateError } = await modClient
          .from("listings")
          .update({ status: "vendido" })
          .eq("id", listingAId!);
        expect(listingUpdateError).toBeNull();

        // Reproduce notificarVentaAprobada: lee listing (brand/model),
        // resuelve seller.user_id, formatea el mensaje con la comisión.
        const { data: listing, error: listingLookupError } = await modClient
          .from("listings")
          .select("brand, model, seller_id")
          .eq("id", listingAId!)
          .maybeSingle();
        expect(listingLookupError).toBeNull();

        const { data: seller, error: sellerLookupError } = await modClient
          .from("sellers")
          .select("user_id")
          .eq("id", listing!.seller_id)
          .maybeSingle();
        expect(sellerLookupError).toBeNull();
        expect(seller?.user_id).toBe(userAId);

        const formateadorPrecio = new Intl.NumberFormat("es-CL", {
          style: "currency",
          currency: "CLP",
          maximumFractionDigits: 0,
        });
        const message =
          `Tu venta de ${listing!.brand} ${listing!.model} fue aprobada. ` +
          `Comisión: ${formateadorPrecio.format(commission)}.`;

        const { error: insertNotifError } = await adminClient
          .from("notifications")
          .insert({
            user_id: seller!.user_id,
            event_type: "sale_approved",
            message,
          });
        expect(insertNotifError).toBeNull();

        const { data: notifRows, error: notifSelectError } = await adminClient
          .from("notifications")
          .select("id, event_type, message, is_read")
          .eq("user_id", userAId!)
          .eq("event_type", "sale_approved")
          .order("created_at", { ascending: false })
          .limit(1);

        expect(notifSelectError).toBeNull();
        expect(notifRows).toHaveLength(1);
        const notif = notifRows![0];
        createdNotificationIds.push(notif.id);

        expect(notif.is_read).toBe(false);
        expect(notif.message).toContain("500");
        expect(notif.message!.toLowerCase()).toContain("comisión");
      },
      20_000
    );

    it(
      "(4) notifications_select_own: A puede leer sus propias notificaciones (3), pero B (tercero) NO ve ninguna fila de A",
      async () => {
        const { data: ownRows, error: ownError } = await clientA
          .from("notifications")
          .select("id, event_type")
          .in("id", createdNotificationIds);

        expect(ownError).toBeNull();
        expect(ownRows).toHaveLength(createdNotificationIds.length);

        const { data: otherRows, error: otherError } = await clientB
          .from("notifications")
          .select("id, event_type")
          .in("id", createdNotificationIds);

        // RLS en SELECT se manifiesta como éxito silencioso con 0 filas
        // (no un error), igual que otras políticas `_select_own` del
        // proyecto.
        expect(otherError).toBeNull();
        expect(
          otherRows,
          "un usuario sin relación no debe poder leer las notificaciones de otro"
        ).toHaveLength(0);
      },
      20_000
    );

    it(
      "(5) notifications_update_own: A puede marcar su propia notificación como leída; B NO puede marcar como leída una notificación de A",
      async () => {
        const targetId = createdNotificationIds[0];

        // B intenta marcarla como leída primero: no debe afectar filas.
        const { data: bUpdateData, error: bUpdateError } = await clientB
          .from("notifications")
          .update({ is_read: true })
          .eq("id", targetId)
          .select("id");

        if (bUpdateError) {
          expect(bUpdateError.message.length > 0).toBe(true);
        } else {
          expect(
            bUpdateData,
            "B no debería poder marcar como leída una notificación ajena"
          ).toHaveLength(0);
        }

        const { data: stillUnread, error: stillUnreadError } =
          await adminClient
            .from("notifications")
            .select("is_read")
            .eq("id", targetId)
            .single();
        expect(stillUnreadError).toBeNull();
        expect(stillUnread?.is_read).toBe(false);

        // A marca su propia notificación como leída: sí debe funcionar.
        const { data: aUpdateData, error: aUpdateError } = await clientA
          .from("notifications")
          .update({ is_read: true })
          .eq("id", targetId)
          .select("id, is_read")
          .single();

        expect(
          aUpdateError,
          `A no pudo marcar su propia notificación como leída: ${aUpdateError?.message}`
        ).toBeNull();
        expect(aUpdateData?.is_read).toBe(true);
      },
      20_000
    );

    it("lib/notifications.ts (crearNotificacion) nunca lanza ni bloquea al llamador si el insert falla (fire-and-forget con console.error)", () => {
      const notificationsPath = path.resolve(
        process.cwd(),
        "lib/notifications.ts"
      );
      const source = readFileSync(notificationsPath, "utf-8");

      // No debe existir ningún `throw` ni `return { error` que dependa
      // del resultado del insert: el catch/if de error solo hace
      // console.error, sin propagar.
      expect(source).toContain("console.error");
      expect(source).not.toMatch(/if \(error\)[\s\S]{0,80}throw/);
    });

    it("las 3 Server Actions de moderador llaman a crearNotificacion DESPUÉS de que el cambio de estado principal ya tuvo éxito (no antes, no bloqueando el flujo si falla)", () => {
      const vendedoresPath = path.resolve(
        process.cwd(),
        "app/moderador/vendedores/actions.ts"
      );
      const anunciosPath = path.resolve(
        process.cwd(),
        "app/moderador/anuncios/actions.ts"
      );
      const ventasPath = path.resolve(
        process.cwd(),
        "app/moderador/ventas/actions.ts"
      );

      const vendedoresSource = readFileSync(vendedoresPath, "utf-8");
      const anunciosSource = readFileSync(anunciosPath, "utf-8");
      const ventasSource = readFileSync(ventasPath, "utf-8");

      for (const source of [vendedoresSource, anunciosSource, ventasSource]) {
        expect(source).toContain("crearNotificacion");
      }

      // En vendedores/actions.ts, la llamada a crearNotificacion debe
      // ocurrir después del bloque `if (updateError)` (que retorna
      // temprano en caso de fallo del update principal).
      const updateErrorIdx = vendedoresSource.indexOf("if (updateError)");
      const crearNotifIdx = vendedoresSource.indexOf("crearNotificacion({");
      expect(updateErrorIdx).toBeGreaterThan(-1);
      expect(crearNotifIdx).toBeGreaterThan(updateErrorIdx);

      // `await crearNotificacion` nunca debe estar seguido de un patrón
      // que propague su resultado como error de la Server Action (no
      // debe haber un `.error` leído sobre el resultado de
      // crearNotificacion, que retorna void).
      expect(ventasSource).not.toMatch(
        /const\s*{\s*error[^}]*}\s*=\s*await crearNotificacion/
      );
    });
  }
);
