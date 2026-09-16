# Changelog

Todos los cambios relevantes de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [Unreleased]

### Agregado

- **T-01: Inicialización del proyecto Next.js + TypeScript.** Se creó la
  aplicación base del marketplace de autos usados con `create-next-app`
  (Next.js, App Router, TypeScript, Tailwind CSS v4, ESLint), en la raíz del
  repositorio. El proyecto compila correctamente (`npm run build`) y sirve
  en desarrollo local (`npm run dev`) en `http://localhost:3000`.
- **T-02: Proyecto Supabase conectado.** Se creó el proyecto Supabase
  (Postgres, Auth, Storage, tier gratuito) y se agregó `lib/supabase/client.ts`,
  un cliente reutilizable que falla rápido con un error claro si faltan las
  variables de entorno requeridas. Se agregó el endpoint de salud
  `app/api/health/supabase/route.ts`, que verifica conectividad real con
  Supabase. Las credenciales se configuran en `.env.local` (no versionado),
  documentado en `.env.local.example` con las variables
  `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **T-06: Validador local de RUT (dígito verificador).** Se agregó
  `validarRut(rut: string): boolean` en `lib/rut.ts`, que implementa el
  algoritmo de módulo 11 para validar el dígito verificador de un RUT
  chileno, aceptando entradas con o sin puntos, con guión, y con 'k'/'K'.
  Se incluye una suite de pruebas con Vitest (`lib/rut.test.ts`) y el script
  `npm run test` para ejecutarlas.
- **T-04: Esquema de base de datos y RLS.** Se definieron en Supabase
  (Postgres) las tablas `sellers`, `listings`, `listing_photos`, `sales` y
  `notifications`, con sus constraints, índices y triggers de `updated_at`
  (`supabase/migrations/0001_initial_schema.sql`). Se habilitó Row Level
  Security en las cinco tablas con políticas por dueño: cada vendedor solo
  puede leer/editar sus propios `sellers`, `listings`, `listing_photos` y
  `sales`, mientras que los `listings` en estado "publicado" son de lectura
  pública (`supabase/migrations/0002_rls_policies.sql`). Se agregó un test
  de integración contra Supabase real
  (`supabase/tests/rls-sales-insert-policy.test.ts`) que valida el
  comportamiento de las políticas de `sales`.

### Corregido

- **T-04: Hallazgo de seguridad en la política de inserción de `sales`.**
  La política `sales_insert_own` permitía originalmente que un vendedor
  insertara una venta ya en estado "aprobado" con una comisión arbitraria,
  es decir, auto-aprobarse una venta. Se corrigió exigiendo que toda venta
  insertada por el vendedor quede en estado `pendiente_aprobacion` y sin
  comisión asignada (`commission is null`)
  (`supabase/migrations/0003_fix_sales_insert_policy.sql`).
