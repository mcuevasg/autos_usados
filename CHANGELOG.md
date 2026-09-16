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
- **T-03: Despliegue en Vercel.** El repositorio se publicó en GitHub
  (`mcuevasg/autos_usados`) y se conectó a Vercel para despliegue continuo:
  cada push a `main` se despliega automáticamente. La aplicación está
  disponible públicamente en <https://autos-usados-one.vercel.app>. Se
  verificó que la URL pública sirve la misma página que el entorno local,
  sin errores y sin secretos expuestos en el historial de git publicado.
- **T-05: Registro de usuarios con roles.** Se agregó registro y login de
  usuarios con Supabase Auth, con sesión manejada vía cookies en Server
  Components y Server Actions (`lib/supabase/server.ts`, actualización de
  `lib/supabase/client.ts`, y `proxy.ts`, que refresca la sesión en cada
  request). Se creó la tabla `profiles`
  (`supabase/migrations/0004_profiles_and_roles.sql`) con un rol por usuario
  (comprador, vendedor o moderador, por defecto comprador), asignado
  automáticamente al registrarse mediante un trigger; las políticas RLS solo
  permiten a cada usuario leer su propio perfil, y ningún usuario puede
  auto-promoverse de rol vía API. Se agregaron las páginas de registro
  (`app/registro`), inicio de sesión (`app/login`) y cuenta (`app/cuenta`,
  que muestra el email y el rol del usuario, con cierre de sesión). Se
  incluyó un test de integración contra Supabase real
  (`supabase/tests/profiles-auth-roles.test.ts`) que verifica la creación
  automática de perfil, el login, la lectura del propio perfil, el bloqueo
  de auto-promoción de rol y el aislamiento entre usuarios.
- **T-07: Formulario de registro de vendedor (persona natural /
  concesionario).** Se agregó la página `app/vendedor/registro`, con un
  formulario que permite elegir el tipo de vendedor (persona natural o
  concesionario), valida el RUT ingresado con el validador de T-06 y exige
  subir un documento de respaldo. Al enviarse, el documento se guarda en un
  bucket privado de Supabase Storage (`seller-documents`), aislado por
  usuario mediante políticas RLS por carpeta
  (`supabase/migrations/0005_seller_documents_storage.sql`); se crea el
  registro correspondiente en `sellers`, que queda en estado "pendiente"
  (pendiente de revisión); y el rol de la cuenta se promueve a vendedor.
  La página `app/cuenta` ahora muestra un link a este registro para las
  cuentas con rol comprador. Se incluyó un test de integración contra
  Supabase real (`supabase/tests/vendedor-registro-t07.test.ts`) que
  verifica el aislamiento de documentos por usuario, la validación de RUT
  y el flujo completo de registro.
- **T-08: Panel de moderador para aprobar/rechazar vendedores.** Se agregó
  la página `app/moderador/vendedores`, que lista los vendedores en estado
  "pendiente" junto con su documentación de respaldo (mediante una URL
  firmada temporal al bucket privado), permitiendo a un moderador marcarlos
  como "Verificado" o "Rechazado". Se agregaron las políticas RLS
  correspondientes (`supabase/migrations/0006_moderator_seller_review.sql`)
  para que un usuario con rol moderador pueda leer y actualizar cualquier
  registro de `sellers` y leer cualquier documento del bucket
  `seller-documents`, y se corrigió la política `listings_insert_own` para
  exigir que el vendedor esté verificado antes de publicar un anuncio. Se
  incluyó un test de integración contra Supabase real
  (`supabase/tests/moderador-vendedores-t08.test.ts`) que cubre el flujo
  legítimo de moderación.

### Corregido

- **T-04: Hallazgo de seguridad en la política de inserción de `sales`.**
  La política `sales_insert_own` permitía originalmente que un vendedor
  insertara una venta ya en estado "aprobado" con una comisión arbitraria,
  es decir, auto-aprobarse una venta. Se corrigió exigiendo que toda venta
  insertada por el vendedor quede en estado `pendiente_aprobacion` y sin
  comisión asignada (`commission is null`)
  (`supabase/migrations/0003_fix_sales_insert_policy.sql`).
- **T-08: Hallazgos de seguridad en la verificación de vendedores.** Se
  detectó que un vendedor podía auto-verificarse (cambiar su propio estado
  a "verificado") mediante un UPDATE directo a `sellers`, y también
  insertando su registro con un estado distinto de "pendiente" mediante un
  INSERT directo. Ambos vectores se corrigieron con un trigger que fuerza
  el estado de verificación a "pendiente" salvo cuando la operación la
  realiza un moderador
  (`supabase/migrations/0007_protect_verification_status.sql` y
  `supabase/migrations/0008_protect_verification_status_insert.sql`),
  verificados con tests de integración reales contra Supabase.
