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
- **T-09: Formulario de creación de anuncio (campos obligatorios
  básicos).** Se agregó la página `app/vendedor/anuncios/nuevo`, con un
  formulario para crear un anuncio con marca, modelo, año, kilometraje y
  precio, además de los campos que el esquema exige como obligatorios
  (estado del vehículo, tipo de uso y ubicación). Solo un vendedor con
  estado de verificación "verificado" puede acceder al formulario y crear
  un anuncio; en caso contrario, la página muestra un mensaje según el
  estado (sin registro, pendiente de revisión, o rechazado). Esta
  restricción se aplica en tres capas: en la página, en la Server Action
  que procesa el envío, y mediante la política RLS `listings_insert_own`.
  El anuncio creado queda en estado "borrador", y
  `app/vendedor/anuncios/[id]` muestra un resumen simple con los datos
  guardados. Se incluyó un test de integración contra Supabase real
  (`supabase/tests/anuncio-nuevo-t09.test.ts`) que cubre el bloqueo por RLS
  a vendedores no verificados y la validación de los campos requeridos.
- **T-10: Carga de fotos del anuncio (mínimo 3).** Se agregó la página
  `app/vendedor/anuncios/[id]/fotos`, enlazada desde el resumen del anuncio,
  para que el vendedor suba y gestione las fotos de su anuncio, con un
  contador "X de 3 fotos mínimas". Las fotos se almacenan en un bucket
  privado de Supabase Storage (`listing-photos`), aislado por dueño del
  anuncio mediante políticas RLS
  (`supabase/migrations/0009_listing_photos_storage_and_minimum.sql`). Esta
  misma migración agrega un trigger de base de datos
  (`listings_require_min_photos_to_publish`) que impide publicar un anuncio
  si tiene menos de 3 fotos cargadas. Se incluyó un test de integración
  contra Supabase real (`supabase/tests/fotos-anuncio-t10.test.ts`) que
  cubre la carga de fotos y la exigencia del mínimo para publicar.
- **T-11: Campos obligatorios adicionales del anuncio.** El formulario de
  creación de anuncio (`app/vendedor/anuncios/nuevo`) ahora incluye el
  campo obligatorio "¿Papeles al día?" (sí/no), sin opción preseleccionada:
  el vendedor debe elegir explícitamente una de las dos opciones, validado
  en servidor, que rechaza el envío si no se elige exactamente una. El
  valor elegido se guarda tal cual, sin depender del valor por defecto de
  la columna en base de datos. Los otros dos campos del criterio de
  aceptación (estado del vehículo y tipo de uso de una lista cerrada) ya
  estaban implementados desde T-09. El resumen del anuncio
  (`app/vendedor/anuncios/[id]`) ahora muestra "Papeles al día: Sí/No". Se
  incluyó un test de integración contra Supabase real
  (`supabase/tests/anuncio-nuevo-t11.test.ts`) que cubre la validación de
  este campo.
- **T-12: Ciclo de vida del anuncio y panel de moderador.** Se agregó la
  página `app/moderador/anuncios`, que lista todos los anuncios y permite a
  un moderador cambiar su estado entre "Borrador", "Publicado", "Pausado",
  "Vendido" y "Rechazado". Se agregó `app/moderador/layout.tsx`, con
  navegación entre el panel de vendedores y el de anuncios. Se incluyó un
  test de integración contra Supabase real
  (`supabase/tests/listing-status-lifecycle-t12.test.ts`) que cubre el
  cambio de estado del anuncio por un moderador. La restricción de "solo
  los anuncios en estado Publicado aparecen en búsquedas públicas" ya
  estaba garantizada desde T-04 (política `listings_select_published`), sin
  cambios necesarios. Queda fuera de alcance, y documentado explícitamente
  como tal, impedir nuevos contactos de compradores en anuncios
  vendidos/rechazados, ya que aún no existe ninguna funcionalidad de
  contacto comprador-vendedor en el proyecto.
- **T-13: Filtros de búsqueda de anuncios.** Se agregó la página pública
  `app/buscar` (sin necesidad de sesión), con filtros combinables por marca,
  modelo, año y ubicación. Los resultados se restringen siempre a anuncios
  en estado "Publicado" mediante un filtro explícito en el código, además de
  la política RLS `listings_select_published` ya existente desde T-04. Si
  ningún anuncio coincide con los filtros aplicados, se muestra un mensaje
  de "sin resultados" en lugar de un error. La home (`app/page.tsx`) ahora
  enlaza a `/buscar` y a `/login`, reemplazando el boilerplate de
  `create-next-app`. Se incluyó un test de integración contra Supabase real
  (`supabase/tests/buscar-t13.test.ts`) que cubre los filtros combinados y
  el caso sin resultados.

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
- **T-10: Hallazgo de control de acceso en las páginas de gestión del
  anuncio.** Las páginas de resumen (`app/vendedor/anuncios/[id]`) y de
  fotos (`app/vendedor/anuncios/[id]/fotos`) confiaban únicamente en RLS
  para obtener el anuncio, pero la política de lectura vigente permite a
  cualquier usuario leer anuncios ajenos en estado "publicado"; esto podía
  exponer a un vendedor la gestión (o al menos la vista) de anuncios que no
  le pertenecían. Se corrigió agregando `obtenerAnuncioPropio` en
  `lib/listings.ts`, que ambas páginas usan para filtrar explícitamente por
  dueño (`seller_id`) además de RLS, verificado con el test de integración
  `supabase/tests/anuncio-ajeno-control-acceso.test.ts`.
- **T-12: Hallazgos de seguridad y de visibilidad en el ciclo de vida del
  anuncio.** Se detectó que un vendedor podía cambiar el estado de su
  propio anuncio directamente, incluso publicarlo sin pasar por la revisión
  de un moderador. Se corrigió con un trigger que bloquea cualquier cambio
  de estado que no provenga de un moderador, tanto en creación como en
  actualización (`supabase/migrations/0010_listing_status_lifecycle.sql`).
  Adicionalmente, se detectó en QA que las políticas RLS de
  `listing_photos` impedían a un moderador ver las fotos de anuncios
  ajenos, lo que bloqueaba erróneamente la publicación de anuncios que sí
  cumplían el mínimo de fotos; se corrigió dando al moderador visibilidad
  de las fotos de cualquier anuncio
  (`supabase/migrations/0011_listing_photos_moderator_access.sql`). Se
  ajustaron los tests `anuncio-ajeno-control-acceso`, `fotos-anuncio-t10` y
  `rls-sales-insert-policy` para reflejar que ahora solo un moderador
  autenticado puede publicar un anuncio.
</content>
