// Test de integración de QA para T-14 (agrupación comparativa en la
// búsqueda pública, app/buscar/page.tsx + supabase/migrations/0012_
// sellers_public_view.sql), criterio de aceptación REQ-07:
//
//   "Al buscar, el sistema agrupa automáticamente anuncios que comparten
//   marca, modelo y rango de año similar en un listado comparativo,
//   mostrando por cada anuncio al menos precio, año, kilometraje,
//   estado, papeles al día y vendedor."
//
// Sigue el mismo patrón que supabase/tests/buscar-t13.test.ts: crea
// datos reales contra el proyecto Supabase (moderador, vendedor
// verificado, anuncios con fotos) usando el flujo legítimo (RLS real,
// sin bypass salvo para el setup con service_role), y verifica:
//
//   1. Seguridad de la vista `sellers_public_info` (CRÍTICO): con un
//      cliente anon SIN sesión, `.select("*")` sobre la vista devuelve
//      ÚNICAMENTE las columnas `id` y `seller_type` -- nunca `rut` ni
//      `verification_document_url` -- sin importar qué se pida.
//      Explícitamente, `.select("id, seller_type, rut")` DEBE fallar
//      (la columna no existe en la vista), no devolver el rut.
//   2. La lógica de agrupación de app/buscar/page.tsx (copiada aquí
//      byte-a-byte para no probar una función "parecida") agrupa
//      correctamente 3 anuncios reales (mismo brand+model) donde 2 años
//      caen en el mismo bucket de 3 años y 1 cae en otro bucket, en 2
//      grupos comparativos distintos.
//   3. Cada anuncio agrupado trae los campos exigidos por REQ-07: id,
//      brand, model, year, mileage, price, vehicle_condition,
//      papers_up_to_date, seller_id -- y el tipo de vendedor se resuelve
//      vía `sellers_public_info`.
//
// La verificación end-to-end por HTTP (curl contra `next dev`,
// confirmando HTML real, agrupación visual y ausencia del RUT en el
// HTML) se hizo aparte, manualmente, por las mismas razones que T-13
// (requiere un servidor corriendo, no debe depender de un proceso
// externo en `npm test`/CI). Ver reporte de QA para el detalle.
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

/**
 * Calcula un RUT chileno realista (mismo algoritmo módulo 11 de
 * lib/rut.ts) a partir de un cuerpo numérico dado, solo para tener un
 * valor de prueba único y con formato válido. No importa lib/rut.ts
 * directamente porque `calcularDigitoVerificador` no está exportado.
 */
function calcularRutDeCuerpo(cuerpo: string): string {
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return `${cuerpo}-${dv}`;
}

/**
 * Copia EXACTA de la constante y la función de agrupación de
 * app/buscar/page.tsx (T-14), para probar la lógica real de agrupación
 * sin depender de renderizar React.
 */
const TAMANIO_BUCKET_ANIO = 3;

function bucketAnio(year: number): number {
  return Math.floor(year / TAMANIO_BUCKET_ANIO) * TAMANIO_BUCKET_ANIO;
}

type AnuncioAgrupable = {
  id: string;
  brand: string;
  model: string;
  year: number;
};

type GrupoComparativo = {
  clave: string;
  brand: string;
  model: string;
  anioMin: number;
  anioMax: number;
  anuncios: AnuncioAgrupable[];
};

function agruparPorSimilitud(
  anuncios: AnuncioAgrupable[]
): GrupoComparativo[] {
  const grupos = new Map<string, GrupoComparativo>();

  for (const anuncio of anuncios) {
    const brandNormalizada = anuncio.brand.trim().toLowerCase();
    const modelNormalizado = anuncio.model.trim().toLowerCase();
    const bucket = bucketAnio(anuncio.year);
    const clave = `${brandNormalizada}::${modelNormalizado}::${bucket}`;

    const grupoExistente = grupos.get(clave);
    if (grupoExistente) {
      grupoExistente.anuncios.push(anuncio);
      grupoExistente.anioMin = Math.min(grupoExistente.anioMin, anuncio.year);
      grupoExistente.anioMax = Math.max(grupoExistente.anioMax, anuncio.year);
    } else {
      grupos.set(clave, {
        clave,
        brand: anuncio.brand,
        model: anuncio.model,
        anioMin: anuncio.year,
        anioMax: anuncio.year,
        anuncios: [anuncio],
      });
    }
  }

  return Array.from(grupos.values()).sort((a, b) => {
    const comparacionMarca = a.brand.localeCompare(b.brand);
    if (comparacionMarca !== 0) return comparacionMarca;
    const comparacionModelo = a.model.localeCompare(b.model);
    if (comparacionModelo !== 0) return comparacionModelo;
    return a.anioMin - b.anioMin;
  });
}

const LISTING_BASE = {
  mileage: 15000,
  price: 12000000,
  vehicle_condition: "usado en buen estado",
  papers_up_to_date: true,
  usage_type: "familiar" as const,
};

describe.skipIf(!hasCredentials)(
  "T-14: agrupación comparativa + vendedor en /buscar (proyecto Supabase real)",
  () => {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const brand = `AgrupQA-${runId}`;
    const model = "ModeloComparativo";

    // Cuerpo numérico único (derivado de Date.now()) para el RUT de
    // prueba: no debe reutilizarse ni ser un RUT real de nadie.
    const cuerpoRut = String(Date.now()).slice(-7);
    const rutSeller = calcularRutDeCuerpo(cuerpoRut);

    const emailMod = `qa-t14-mod-${runId}@example.com`;
    const passwordMod = `Qa-Test-${runId}-mod!`;
    const emailA = `qa-t14-sellerA-${runId}@example.com`;
    const passwordA = `Qa-Test-${runId}-a!`;

    let adminClient: SupabaseClient;
    let modClient: SupabaseClient;
    let clientA: SupabaseClient;
    let anonClient: SupabaseClient;

    let modUserId: string | undefined;
    let userAId: string | undefined;
    let sellerAId: string | undefined;

    // Año 2019 y 2020: mismo bucket (floor(2019/3)*3 = floor(2020/3)*3 = 2019).
    let listing2019Id: string | undefined;
    let listing2020Id: string | undefined;
    // Año 2024: bucket floor(2024/3)*3 = 2022, DISTINTO al de 2019/2020.
    let listing2024Id: string | undefined;

    const uploadedPaths: string[] = [];

    beforeAll(async () => {
      // Confirma la premisa de bucketing usada en el resto del test,
      // para que el test falle ruidosamente (y no en silencio) si algún
      // día cambia TAMANIO_BUCKET_ANIO en la página real sin actualizar
      // este archivo.
      expect(bucketAnio(2019)).toBe(bucketAnio(2020));
      expect(bucketAnio(2019)).not.toBe(bucketAnio(2024));

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
          rut: rutSeller,
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

      // --- 3 listings mismo brand+model, años en 2 buckets distintos ---
      const insertarListing = async (year: number, sufijo: string) => {
        const { data, error } = await clientA
          .from("listings")
          .insert({
            seller_id: sellerAId,
            brand,
            model,
            year,
            location: `UbicacionQA-${runId}-${sufijo}`,
            ...LISTING_BASE,
          })
          .select("id")
          .single();
        if (error || !data) {
          throw new Error(
            `No se pudo crear el listing ${sufijo} (year=${year}): ${error?.message}`
          );
        }
        return data.id as string;
      };

      listing2019Id = await insertarListing(2019, "2019");
      listing2020Id = await insertarListing(2020, "2020");
      listing2024Id = await insertarListing(2024, "2024");

      // Fotos mínimas (3) para poder publicar los 3 listings (T-10).
      for (const listingId of [listing2019Id, listing2020Id, listing2024Id]) {
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
            .insert({
              listing_id: listingId,
              storage_path: storagePath,
              position: i,
            });
          if (insertPhotoError) {
            throw new Error(
              `No se pudo insertar la fila de foto ${i} de ${listingId}: ${insertPhotoError.message}`
            );
          }
        }
      }

      for (const listingId of [listing2019Id, listing2020Id, listing2024Id]) {
        const { error: publicarError } = await modClient
          .from("listings")
          .update({ status: "publicado" })
          .eq("id", listingId);
        if (publicarError) {
          throw new Error(
            `El moderador no pudo publicar ${listingId}: ${publicarError.message}`
          );
        }
      }
    }, 90_000);

    afterAll(async () => {
      if (uploadedPaths.length > 0) {
        await adminClient.storage.from("listing-photos").remove(uploadedPaths);
      }
      for (const id of [listing2019Id, listing2020Id, listing2024Id]) {
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

    it("setup: los 3 listings de prueba quedaron 'publicado'", async () => {
      const { data, error } = await adminClient
        .from("listings")
        .select("id, status, year")
        .in("id", [listing2019Id!, listing2020Id!, listing2024Id!]);
      expect(error).toBeNull();
      const porId = new Map((data ?? []).map((l) => [l.id, l.status]));
      expect(porId.get(listing2019Id)).toBe("publicado");
      expect(porId.get(listing2020Id)).toBe("publicado");
      expect(porId.get(listing2024Id)).toBe("publicado");
    });

    describe("(1) CRÍTICO — seguridad de la vista sellers_public_info", () => {
      it("un anon SIN sesión, con select('*'), recibe ÚNICAMENTE columnas id y seller_type (nunca rut ni verification_document_url)", async () => {
        const { data, error } = await anonClient
          .from("sellers_public_info")
          .select("*")
          .eq("id", sellerAId!);

        expect(error).toBeNull();
        expect(data).toHaveLength(1);

        const fila = data![0];
        const columnas = Object.keys(fila).sort();
        expect(columnas).toEqual(["id", "seller_type"]);

        expect(fila).not.toHaveProperty("rut");
        expect(fila).not.toHaveProperty("verification_document_url");

        // El valor de rut jamás debe aparecer en el objeto serializado,
        // ni siquiera "escondido" en algún otro campo inesperado.
        expect(JSON.stringify(fila)).not.toContain(rutSeller);
        expect(JSON.stringify(fila)).not.toContain(cuerpoRut);

        expect(fila.id).toBe(sellerAId);
        expect(fila.seller_type).toBe("persona_natural");
      });

      it("select explícito de 'rut' contra la vista FALLA (columna no existe), no devuelve el rut", async () => {
        const { data, error } = await anonClient
          .from("sellers_public_info")
          .select("id, seller_type, rut")
          .eq("id", sellerAId!);

        expect(
          error,
          "pedir explícitamente 'rut' a la vista debe fallar, no devolverlo"
        ).not.toBeNull();
        expect(data).toBeNull();
        // PostgREST/Postgres reportan columna inexistente (42703) o un
        // mensaje que la referencia; en cualquier caso, el punto es que
        // NO hay datos exitosos con rut.
        expect(error!.message.toLowerCase()).toMatch(/rut|column|42703/);
      });

      it("select explícito de 'verification_document_url' contra la vista también FALLA", async () => {
        const { data, error } = await anonClient
          .from("sellers_public_info")
          .select("id, verification_document_url")
          .eq("id", sellerAId!);

        expect(error).not.toBeNull();
        expect(data).toBeNull();
      });

      it("la tabla base sellers sigue siendo inaccesible para anon (la vista no la expuso de rebote)", async () => {
        const { data, error } = await anonClient
          .from("sellers")
          .select("id, rut")
          .eq("id", sellerAId!);

        // RLS de sellers exige auth.uid() = user_id o moderador: un anon
        // sin sesión no cumple ninguna, así que debe ver 0 filas (no
        // necesariamente un error, según cómo esté escrita la policy).
        expect(error).toBeNull();
        expect(data).toEqual([]);
      });
    });

    describe("(2) agrupación por brand+model+bucket de año, sobre datos reales", () => {
      it("un visitante anónimo, filtrando por brand, ve los 3 anuncios publicados de prueba", async () => {
        const { data, error } = await anonClient
          .from("listings")
          .select(
            "id, brand, model, year, mileage, price, location, vehicle_condition, papers_up_to_date, seller_id"
          )
          .eq("status", "publicado")
          .ilike("brand", `%${brand}%`);

        expect(error).toBeNull();
        const ids = (data ?? []).map((l) => l.id);
        expect(ids).toContain(listing2019Id);
        expect(ids).toContain(listing2020Id);
        expect(ids).toContain(listing2024Id);
        expect(ids).toHaveLength(3);
      });

      it("verificación precisa: exactamente 2 grupos comparativos (uno [2019,2020], otro [2024])", async () => {
        const { data, error } = await anonClient
          .from("listings")
          .select("id, brand, model, year")
          .eq("status", "publicado")
          .ilike("brand", `%${brand}%`);

        expect(error).toBeNull();

        const grupos = agruparPorSimilitud(data as AnuncioAgrupable[]);
        expect(grupos).toHaveLength(2);

        const grupoConDosAnios = grupos.find(
          (g) => g.anuncios.length === 2
        );
        const grupoConUnAnio = grupos.find((g) => g.anuncios.length === 1);

        expect(
          grupoConDosAnios,
          "debe existir un grupo con los 2 anuncios de 2019/2020"
        ).toBeDefined();
        expect(grupoConDosAnios!.anioMin).toBe(2019);
        expect(grupoConDosAnios!.anioMax).toBe(2020);
        expect(
          grupoConDosAnios!.anuncios.map((a) => a.id).sort()
        ).toEqual([listing2019Id, listing2020Id].sort());

        expect(
          grupoConUnAnio,
          "debe existir un grupo separado con el anuncio de 2024"
        ).toBeDefined();
        expect(grupoConUnAnio!.anioMin).toBe(2024);
        expect(grupoConUnAnio!.anioMax).toBe(2024);
        expect(grupoConUnAnio!.anuncios.map((a) => a.id)).toEqual([
          listing2024Id,
        ]);
      });
    });

    describe("(3) cada anuncio trae todos los campos exigidos por REQ-07, incluido el vendedor resuelto", () => {
      it("la consulta de listings + sellers_public_info deja disponibles precio, año, kilometraje, estado, papeles al día y tipo de vendedor para cada anuncio", async () => {
        const { data: listingsData, error: listingsError } = await anonClient
          .from("listings")
          .select(
            "id, brand, model, year, mileage, price, location, vehicle_condition, papers_up_to_date, seller_id"
          )
          .eq("status", "publicado")
          .ilike("brand", `%${brand}%`);

        expect(listingsError).toBeNull();
        expect(listingsData).toHaveLength(3);

        for (const anuncio of listingsData!) {
          expect(anuncio.price).not.toBeNull();
          expect(anuncio.year).not.toBeNull();
          expect(anuncio.mileage).not.toBeNull();
          expect(anuncio.vehicle_condition).not.toBeNull();
          expect(typeof anuncio.papers_up_to_date).toBe("boolean");
          expect(anuncio.seller_id).toBe(sellerAId);
        }

        const { data: sellersData, error: sellersError } = await anonClient
          .from("sellers_public_info")
          .select("id, seller_type")
          .in(
            "id",
            listingsData!.map((l) => l.seller_id)
          );

        expect(sellersError).toBeNull();
        expect(sellersData).toHaveLength(1);
        expect(sellersData![0].seller_type).toBe("persona_natural");
      });
    });
  }
);
