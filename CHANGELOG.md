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
- **T-14: Agrupación automática por similitud.** La página `app/buscar`
  ahora agrupa los resultados de la búsqueda por marca + modelo + rango de
  año similar (buckets de 3 años), mostrando por cada grupo un listado
  comparativo con precio, año, kilometraje, estado del vehículo, papeles al
  día, vendedor y ubicación de cada anuncio. Para mostrar el vendedor sin
  exponer datos sensibles, se agregó la vista pública `sellers_public_info`
  (`supabase/migrations/0012_sellers_public_view.sql`), que expone
  únicamente el tipo de vendedor (persona natural / concesionario), sin
  exponer nunca el RUT ni el documento de respaldo del vendedor. Se incluyó
  un test de integración contra Supabase real
  (`supabase/tests/buscar-agrupacion-t14.test.ts`) que cubre la agrupación
  por similitud y verifica que esos datos sensibles nunca se filtran.
- **T-15: Solicitud de venta concretada por el vendedor.** Se agregó la
  página `app/vendedor/anuncios/[id]/venta`, enlazada desde el resumen del
  anuncio, para que el vendedor de un anuncio en estado "Publicado" pueda
  enviar una solicitud de venta indicando el precio final. Mientras la
  solicitud está pendiente de aprobación, el anuncio permanece "Publicado".
  La página evita solicitudes duplicadas verificando, antes de mostrar el
  formulario, si ya existe una solicitud pendiente para ese anuncio. Se
  incluyó un test de integración contra Supabase real
  (`supabase/tests/venta-t15.test.ts`) que cubre este flujo.
- **T-16: Aprobación de venta y cálculo de comisión.** Se agregó la página
  `app/moderador/ventas`, donde un moderador ve las solicitudes de venta
  pendientes de aprobación y puede aprobarlas. Al aprobar, se calcula la
  comisión (5% del precio final) y se registra en la venta, y el anuncio
  correspondiente pasa a estado "Vendido". Se agregaron las políticas RLS
  correspondientes (`supabase/migrations/0014_sales_approval.sql`) para que
  un moderador pueda leer y actualizar cualquier solicitud de venta. Se
  incluyeron tests de integración contra Supabase real
  (`supabase/tests/venta-t16.test.ts` y
  `supabase/tests/venta-aprobacion-t16.test.ts`) que cubren el flujo de
  aprobación.
- **T-17: Activación de plan destacado por concesionario.** Se agregó a
  `app/vendedor/anuncios/[id]` una sección "Plan Destacado", visible solo
  para un vendedor concesionario con ese anuncio en estado "Publicado", que
  permite activar el plan destacado sobre el anuncio. El plan dura 30 días
  desde la activación; la fecha de expiración la calcula y garantiza la
  base de datos, sin importar lo que envíe el cliente
  (`supabase/migrations/0015_featured_listings.sql`), y el trigger
  correspondiente valida además que quien activa el plan sea un vendedor
  concesionario y que el anuncio esté publicado. Se incluyó un test de
  integración contra Supabase real
  (`supabase/tests/destacar-t17.test.ts`) que cubre este flujo.
- **T-18: Prioridad y etiqueta visual de anuncios destacados.** La página
  `app/buscar` ahora muestra una etiqueta "⭐ Destacado" junto a los
  anuncios con plan destacado vigente, y les da prioridad de posición tanto
  dentro de cada grupo comparativo como entre grupos (un grupo con al menos
  un anuncio destacado aparece antes que uno sin destacados). Se agregó
  `esDestacadoVigente(listing)` en `lib/listings.ts`, que exige que el plan
  esté activo Y que su fecha de expiración no haya pasado, en vez de
  confiar solo en el flag `featured_active` de la base de datos, ya que no
  existe ningún proceso automático que lo desactive al vencer (ver T-17);
  al expirar la fecha, el anuncio pierde la etiqueta y la prioridad de
  forma automática, sin intervención manual. Se incluyeron tests unitarios
  (`lib/listings.test.ts`) y se verificó el flujo con una integración real.
- **T-19: Notificaciones dentro de la app.** Se agregó `lib/notifications.ts`
  (`crearNotificacion`), que registra una notificación para el usuario
  afectado cuando ocurre un evento relevante generado por un moderador:
  verificación de un vendedor (aprobado/rechazado), cambio de estado de un
  anuncio, y aprobación de una venta (incluyendo el monto de la comisión).
  Se agregó la página `app/notificaciones`, donde cualquier usuario ve sus
  propias notificaciones ordenadas de más reciente a más antigua, con
  indicación visual de las no leídas y la opción de marcarlas como leídas;
  `app/cuenta` ahora enlaza a esta página mostrando un contador de
  notificaciones sin leer. Se incluyó un test de integración contra
  Supabase real (`supabase/tests/notificaciones-t19.test.ts`) que cubre la
  creación de notificaciones desde los tres flujos de moderador, la
  lectura de las propias y el marcado como leída.
- **T-20: Notificaciones por email.** Se agregó `lib/email.ts`, con
  `enviarEmailEvento` (envía el correo vía [Resend](https://resend.com), con
  un diseño "a prueba de fallos" que nunca bloquea la acción principal del
  moderador si el envío falla) y `obtenerEmailUsuario` (obtiene el email del
  usuario afectado). El envío de email ahora acompaña, además de la
  notificación dentro de la app ya existente desde T-19, a los dos eventos
  que exige el criterio de esta tarea: el cambio de estado de un anuncio y
  la aprobación de una venta; la verificación de vendedor (T-19) sigue sin
  enviar email, tal como especifica el criterio. La clave de Resend se
  configura mediante la nueva variable de entorno `RESEND_API_KEY`,
  documentada en `.env.local.example`. Nota de infraestructura: sin un
  dominio propio verificado en Resend, los correos de prueba solo se
  entregan a la casilla del dueño de la cuenta Resend (limitación del
  proveedor en modo sandbox, no del código); en producción basta con
  verificar un dominio y cambiar el remitente. Se incluyó un test de
  integración contra la API real de Resend
  (`supabase/tests/email-t20.test.ts`), incluyendo un envío real de prueba.

### Corregido

- **🚨 CRÍTICO — Ningún formulario funcionaba en producción (registro,
  login y prácticamente todas las Server Actions del proyecto).** Se
  detectó y corrigió un bug crítico transversal que afectaba a la
  aplicación ya desplegada en Vercel: al enviar cualquier formulario del
  sitio (registro, login, creación de anuncio, subida de fotos,
  solicitud/aprobación de venta, activación de plan destacado, paneles de
  moderador, notificaciones, etc.) la Server Action correspondiente
  devolvía un error 500 real, dejando la aplicación en producción
  completamente inutilizable de punta a punta desde que estas
  funcionalidades se agregaron. **Causa raíz:** desde T-05, cada archivo de
  Server Actions (`"use server"`) del proyecto exportaba, además de sus
  funciones `async`, una constante `initial*State` (el estado inicial
  usado por `useActionState` en el formulario cliente); Next.js exige que
  un archivo `"use server"` solo exporte funciones `async`, y este patrón,
  aunque funcionaba sin problema en desarrollo (`npm run dev`) y no lo
  detectaba `npm run build` (por tratarse de un error de runtime y no de
  compilación), provocaba un crash real al ejecutar la Server Action en
  producción (`npm run start` / Vercel). El problema pasó inadvertido
  durante 16 tareas porque ningún flujo de trabajo previo había probado
  los formularios contra un build de producción real. Se corrigió moviendo
  la constante `initial*State` de cada archivo de servidor a su componente
  cliente correspondiente (que ya la consumía), dejando en el archivo
  `"use server"` únicamente los `export type` (se eliminan en la
  compilación, por lo que no cuentan para la regla) y las funciones
  `export async function`. Se corrigieron los 11 pares de archivos
  afectados: `app/login`, `app/registro`, `app/vendedor/registro`,
  `app/vendedor/anuncios/nuevo`, `app/vendedor/anuncios/[id]/fotos` (dos
  componentes cliente), `app/vendedor/anuncios/[id]/destacar`,
  `app/vendedor/anuncios/[id]/venta`, `app/moderador/vendedores`,
  `app/moderador/anuncios`, `app/moderador/ventas` y
  `app/notificaciones`. Se verificó la corrección con Playwright contra un
  build de producción real (`npm run build && npm run start`), confirmando
  que `/registro` y `/login` (y, por extensión, el resto de las Server
  Actions del proyecto) ya no devuelven error 500.
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
- **T-15: Hallazgo de seguridad en la política de inserción de `sales`.**
  La política `sales_insert_own` exigía que la solicitud de venta quedara
  pendiente de aprobación y sin comisión (T-04), pero nunca exigió que el
  anuncio referenciado estuviera en estado "publicado": esa regla solo se
  validaba en la Server Action `solicitarVenta`, por lo que un vendedor
  podía saltarse la app y llamar directamente a la API de Supabase para
  crear una solicitud de venta sobre un anuncio propio en "borrador",
  "pausado", "vendido" o "rechazado". Se corrigió agregando la condición
  `listings.status = 'publicado'` a la política
  (`supabase/migrations/0013_sales_insert_requires_published.sql`), que de
  paso agrega un índice único que garantiza a nivel de base de datos que
  no exista más de una solicitud pendiente simultánea por anuncio (antes
  solo lo evitaba una verificación previa no atómica en la Server Action),
  verificado con los tests de integración `venta-t15` y
  `rls-sales-insert-policy`.
- **T-16: Hallazgo de estado inconsistente al aprobar una venta.** Si el
  registro de la aprobación de la venta (con la comisión ya calculada)
  tenía éxito pero el cambio de estado del anuncio a "Vendido" fallaba, el
  sistema quedaba en un estado inconsistente sin forma de recuperarse: la
  venta quedaba aprobada con comisión cobrada, pero el anuncio nunca pasaba
  a "Vendido". Se corrigió la lógica de aprobación para detectar ese caso y
  completar solo el paso pendiente (el cambio de estado del anuncio), sin
  volver a cobrar comisión, verificado con el test de integración
  `supabase/tests/venta-aprobacion-t16.test.ts`.
- **T-17: Hallazgo de seguridad en la creación de anuncios con plan
  destacado.** La protección de activación del plan destacado
  (`supabase/migrations/0015_featured_listings.sql`) solo se aplicaba al
  actualizar un anuncio existente, no al crearlo: un vendedor podía insertar
  un anuncio nuevo directamente ya con `featured_active = true` y una fecha
  de expiración arbitraria, bypaseando por completo la validación de T-17.
  Se corrigió neutralizando cualquier intento de crear un anuncio ya
  destacado
  (`supabase/migrations/0016_featured_activation_insert_guard.sql`),
  verificado con el test de integración
  `supabase/tests/destacar-insert-guard-t17.test.ts`.
- **Callback de verificación de email en Supabase.** Se creó la ruta
  `/app/auth/callback/route.ts` para completar el flujo de verificación de
  email en Supabase Auth, que estaba roto. La ruta intercambia un código de
  verificación por una sesión válida y redirige al usuario al dashboard.
  Incluye validación robusta del código: trim de espacios en blanco, límite
  de 128 caracteres y regex que valida únicamente caracteres alfanuméricos y
  guiones. Implementa manejo seguro de errores con redirecciones apropiadas
  según el resultado (éxito, código inválido/expirado, o error del servidor).
  Se incluyó documentación JSDoc completa explicando cada paso del flujo y
  una suite de pruebas (`app/auth/callback/route.test.ts`) con 6 tests que
  cubren el flujo exitoso, códigos inválidos, códigos expirados,
  y errores de servidor, todos pasando y revisados por QA.
