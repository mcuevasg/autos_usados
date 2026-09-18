# Tareas del MVP: Marketplace de Autos Usados

Basado en `vision.md`, `requeriments.md` y `architecture.md`. Ordenadas por
dependencias. Estado inicial de todas las tareas: **Pendiente**.

## 0. Infraestructura Base

### T-01: Inicializar proyecto Next.js + TypeScript

- **Depende de:** —
- **Estado:** Completed
- **Criterio de aceptación:** existe un repositorio con una app Next.js
  (App Router, TypeScript) que compila y corre localmente (`npm run dev`
  sirve una página en blanco sin errores).

### T-02: Crear proyecto Supabase y conectar credenciales

- **Depende de:** T-01
- **Estado:** Completed
- **Criterio de aceptación:** el proyecto Supabase (Postgres, Auth,
  Storage) está creado en tier gratuito, y la app Next.js puede conectarse
  a él usando variables de entorno (una llamada de prueba a Supabase desde
  la app responde sin error de autenticación).

### T-03: Desplegar en Vercel

- **Depende de:** T-01
- **Estado:** Completed
- **Criterio de aceptación:** la app está desplegada en Vercel (tier
  gratuito) con despliegue automático al hacer push a la rama principal, y
  la URL pública sirve la misma página que en local.

### T-04: Definir esquema de base de datos y RLS

- **Depende de:** T-02
- **Estado:** Completed
- **Criterio de aceptación:** existen en Postgres las tablas `sellers`,
  `listings`, `listing_photos`, `sales`, `notifications` con sus columnas
  principales (ver `architecture.md`), y las políticas de Row Level
  Security impiden que un vendedor lea/edite anuncios de otro vendedor.

## 1. Autenticación y Verificación de Vendedores (REQ-01, REQ-02)

### T-05: Registro de usuarios con roles

- **Depende de:** T-04
- **Estado:** Completed
- **Criterio de aceptación:** un usuario puede registrarse e iniciar
  sesión vía Supabase Auth, y queda asociado a uno de los roles:
  comprador, vendedor, moderador.

### T-06: Validador local de RUT (dígito verificador)

- **Depende de:** T-01
- **Estado:** Completed
- **Criterio de aceptación:** existe una función que, dado un RUT,
  retorna válido/inválido según el algoritmo módulo 11 chileno; probada
  con al menos un RUT válido y uno inválido.

### T-07: Formulario de registro de vendedor (persona natural / concesionario)

- **Depende de:** T-05, T-06
- **Estado:** Completed
- **Criterio de aceptación (REQ-01, REQ-02):** al registrarse como
  vendedor, el usuario elige tipo (persona natural o concesionario);
  el formulario exige el RUT correspondiente (personal o de empresa) y no
  se puede enviar si el RUT no pasa la validación de formato (T-06) o si
  falta el documento de respaldo. Al enviarse, la cuenta queda en estado
  "Pendiente de revisión".

### T-08: Panel de moderador para aprobar/rechazar vendedores

- **Depende de:** T-07
- **Estado:** Completed
- **Criterio de aceptación (REQ-01):** un usuario con rol moderador ve la
  lista de vendedores en estado "Pendiente de revisión" con su
  documentación, y puede cambiar el estado a "Verificado" o "Rechazado".
  Un vendedor no verificado no puede publicar anuncios.

## 2. Publicación de Anuncios (REQ-03, REQ-04, REQ-05)

### T-09: Formulario de creación de anuncio (campos obligatorios básicos)

- **Depende de:** T-08
- **Estado:** Completed
- **Criterio de aceptación (REQ-03):** solo un vendedor en estado
  "Verificado" puede crear un anuncio; el formulario exige marca, modelo,
  año, kilometraje y precio, y no permite guardar si falta alguno.

### T-10: Carga de fotos del anuncio (mínimo 3)

- **Depende de:** T-09, T-02
- **Estado:** Completed
- **Criterio de aceptación (REQ-03):** el vendedor puede subir fotos a
  Supabase Storage desde el formulario de anuncio; el anuncio no puede
  enviarse a publicación con menos de 3 fotos cargadas.

### T-11: Campos obligatorios adicionales del anuncio

- **Depende de:** T-09
- **Estado:** Completed
- **Criterio de aceptación (REQ-04):** el formulario exige además estado
  del vehículo, indicación de papeles al día (sí/no) y tipo de uso
  (familiar, trabajo, carga, todo terreno, seleccionado de una lista);
  no se puede guardar el anuncio si falta alguno de estos campos.

### T-12: Ciclo de vida del anuncio y panel de moderador

- **Depende de:** T-09, T-08
- **Estado:** Completed
- **Criterio de aceptación (REQ-05):** un anuncio nuevo se crea en estado
  "Borrador"; solo un moderador puede cambiar su estado entre Borrador,
  Publicado, Pausado, Vendido y Rechazado; solo los anuncios en estado
  "Publicado" aparecen en búsquedas públicas; los anuncios en estado
  "Vendido" o "Rechazado" no permiten nuevos contactos de compradores.

## 3. Búsqueda y Comparación (REQ-06, REQ-07)

### T-13: Filtros de búsqueda de anuncios

- **Depende de:** T-12
- **Estado:** Completed
- **Criterio de aceptación (REQ-06):** el comprador puede filtrar
  anuncios publicados combinando marca, modelo, año y ubicación; los
  resultados solo incluyen anuncios en estado "Publicado" que cumplen
  todos los filtros; si no hay resultados, se muestra un listado vacío
  con mensaje, no un error.

### T-14: Agrupación automática por similitud

- **Depende de:** T-13
- **Estado:** Completed
- **Criterio de aceptación (REQ-07):** al buscar, el sistema agrupa
  automáticamente anuncios que comparten marca, modelo y rango de año
  similar en un listado comparativo, mostrando por cada anuncio al menos
  precio, año, kilometraje, estado, papeles al día y vendedor.

## 4. Ventas y Comisión (REQ-08)

### T-15: Solicitud de venta concretada por el vendedor

- **Depende de:** T-12
- **Estado:** Completed
- **Criterio de aceptación (REQ-08):** desde un anuncio en estado
  "Publicado", el vendedor puede enviar una solicitud de venta
  concretada indicando el precio final; el anuncio permanece
  "Publicado" mientras la solicitud está pendiente de aprobación.

### T-16: Aprobación de venta y cálculo de comisión

- **Depende de:** T-15
- **Estado:** Completed
- **Criterio de aceptación (REQ-08):** un moderador puede aprobar la
  solicitud de venta; al aprobarla, el anuncio pasa a estado "Vendido" y
  el sistema calcula y registra la comisión sobre el precio final
  indicado.

## 5. Planes Destacados (REQ-09)

### T-17: Activación de plan destacado por concesionario

- **Depende de:** T-12
- **Estado:** Completed
- **Criterio de aceptación (REQ-09):** un concesionario puede activar el
  plan "Destacado" sobre un anuncio propio en estado "Publicado",
  quedando registrada una fecha de expiración.

### T-18: Prioridad y etiqueta visual de anuncios destacados

- **Depende de:** T-17, T-14
- **Estado:** Completed
- **Criterio de aceptación (REQ-09):** los anuncios con plan destacado
  activo muestran una etiqueta visual distintiva y aparecen con
  prioridad de posición en resultados de búsqueda y en los grupos
  comparativos; al expirar el plan, el anuncio vuelve al orden estándar.

## 6. Notificaciones

### T-19: Notificaciones dentro de la app

- **Depende de:** T-08, T-12, T-16
- **Estado:** Completed
- **Criterio de aceptación:** al cambiar el estado de un anuncio, de una
  verificación de vendedor o de una venta, se crea un registro en
  `notifications` para el usuario afectado, visible en la app.

### T-20: Notificaciones por email

- **Depende de:** T-19
- **Estado:** Completed
- **Criterio de aceptación:** los mismos eventos de T-19 (cambio de
  estado de anuncio, aprobación de venta) disparan un correo al usuario
  afectado vía un proveedor de email con tier gratuito (ej. Resend).

## 7. Mejoras de Búsqueda

### T-21: Mostrar fotos de los anuncios en la búsqueda

- **Depende de:** T-10, T-13
- **Estado:** Completed
- **Criterio de aceptación:** en `/buscar` (`app/buscar/page.tsx`), cada
  fila de anuncio en la tabla comparativa muestra una miniatura con la
  primera foto del anuncio (`listing_photos` ordenada por `position`,
  resuelta a URL pública del bucket `listing-photos` de Supabase
  Storage). Si el anuncio no tiene fotos, o el archivo referenciado en
  `storage_path` no existe en el bucket, se muestra un placeholder
  visual (ej. ícono o imagen "sin foto") en vez de romper el layout o
  mostrar un ícono de imagen rota del navegador.

## 8. Rediseño Visual y Experiencia de Usuario

Contexto (investigación de referentes de mercado y tendencias 2026, ver
sesión que originó estas tareas): el sitio actual usa el boilerplate
por defecto de Next.js/Tailwind sin identidad de marca, no tiene
navegación persistente entre páginas, el Home no comunica propuesta de
valor, `/buscar` usa una tabla HTML plana en vez de tarjetas visuales,
y no existe página de detalle de un anuncio individual. Referentes
relevados: Kavak, Cars.com, CarGurus, AutoTrader (tarjetas de resultado
con imagen dominante, badges de confianza/oportunidad, filtros con
iconografía) y tendencias generales de diseño 2026 (hero storytelling
con CTA único, bento grids, dark mode como sistema de tokens,
micro-animaciones con propósito, mobile-first).

### T-22: Sistema de diseño base (tokens, tipografía, metadata)

- **Depende de:** —
- **Estado:** Completed
- **Criterio de aceptación:** existe una paleta de colores de marca
  definida como tokens CSS (`app/globals.css`) con soporte real de
  light/dark mode (no solo blanco/negro del boilerplate), una escala
  tipográfica consistente, y el `<title>`/`<meta description>`/favicon
  del sitio reflejan el proyecto ("Autos usados" o el nombre de marca
  elegido) en vez del boilerplate de `create-next-app`. Los cambios se
  aplican sin romper ninguna página existente.

### T-23: Header/navegación global persistente

- **Depende de:** T-22
- **Estado:** Completed
- **Criterio de aceptación:** todas las páginas del sitio comparten un
  header (vía `app/layout.tsx` o un layout compartido) con logo/nombre
  del sitio, enlace a Buscar, enlace a Vender/Ingresar, y estado de
  sesión (si hay usuario logueado, muestra su acceso a Cuenta/Cerrar
  sesión en vez de Login/Registro). Funciona en mobile (menú
  colapsable) y no rompe ninguna página existente.
- **Nota de seguimiento:** al resolver la sesión del header se detectó
  que, sin `cacheComponents`/PPR habilitado en Next.js, todas las
  rutas del sitio quedan marcadas como dinámicas en el build (antes
  Home/Login/Registro eran estáticas). Se aplicó streaming con
  `<Suspense>` como mitigación (no bloquea logo/Buscar, reduce datos
  enviados al cliente), pero no restaura el prerenderizado estático.
  Ver T-28 para evaluar si vale la pena habilitar PPR más adelante.

### T-24: Landing page (Home) seductora

- **Depende de:** T-22, T-23
- **Estado:** Completed
- **Criterio de aceptación:** el Home (`app/page.tsx`) reemplaza el
  bloque centrado actual por una landing page con: hero con propuesta
  de valor clara y un CTA principal (ir a Buscar), un buscador rápido
  embebido (marca/modelo/ubicación) que redirige a `/buscar` con esos
  filtros, al menos una sección de categorías o marcas destacadas, y al
  menos una sección de confianza (ej. "vendedores verificados",
  cantidad de autos publicados). Responsive mobile-first.
- **Notas de seguimiento (detectadas en revisión, no bloqueantes):**
  (a) la afirmación "100% vendedores verificados" del hero es cierta
  hoy porque publicar un anuncio exige `sellers.verification_status =
  'verificado'` (0006/0010), pero no es un invariante duro: si a
  futuro se permite revocar la verificación de un vendedor sin
  despublicar sus anuncios existentes, la afirmación podría dejar de
  ser exacta — revisar si conviene desactivar esta cifra o agregar esa
  regla de despublicación si se implementa ese flujo. (b) la
  agregación de marcas/ubicaciones para la portada (`lib/landing.ts`,
  `obtenerResumenMarketplace`) trae `brand, location` de TODOS los
  anuncios publicados y agrega en memoria; correcto para el volumen
  actual, pero convendría moverlo a una vista/RPC con `group by` en
  Postgres si el catálogo crece a miles de anuncios.

### T-25: Cards visuales en resultados de búsqueda

- **Depende de:** T-22, T-21
- **Estado:** Completed
- **Criterio de aceptación:** en `/buscar`, cada anuncio dentro de un
  grupo comparativo se muestra como una tarjeta visual (imagen grande,
  precio destacado, badges de destacado/condición, specs con
  iconografía) en vez de una fila de tabla HTML. Se preserva toda la
  funcionalidad existente: filtros, agrupación por similitud (T-14) y
  prioridad de anuncios destacados (T-18). Responsive: al menos 1
  columna en mobile, grid de varias columnas en desktop.

### T-26: Página de detalle de anuncio individual

- **Depende de:** T-25
- **Estado:** Completed
- **Criterio de aceptación:** existe una ruta de detalle
  (`/anuncio/[id]` o similar) accesible desde cada tarjeta de
  `/buscar`, que muestra galería de todas las fotos del anuncio, todas
  sus specs (marca, modelo, año, kilometraje, precio, estado, papeles
  al día, tipo de uso, ubicación), tipo de vendedor, y un CTA de
  contacto. Solo accesible para anuncios en estado "publicado" (mismo
  criterio de visibilidad pública que T-12/T-13).

### T-27: Pulido de micro-interacciones y responsive

- **Depende de:** T-24, T-25, T-26
- **Estado:** Completed
- **Criterio de aceptación:** las páginas principales (Home, Buscar,
  Detalle de anuncio) tienen estados de carga (skeletons o equivalente)
  mientras se resuelven datos del servidor, estados de hover/focus
  visibles y accesibles en elementos interactivos, y se verifican en al
  menos dos anchos de viewport (mobile ~375px, desktop ~1280px) sin
  overflow horizontal ni elementos rotos.

### T-28: Evaluar habilitar Partial Prerendering (PPR / Cache Components)

- **Depende de:** T-23
- **Estado:** Pendiente
- **Contexto:** T-23 detectó que resolver la sesión del usuario en el
  header (necesario en todas las páginas) hace que Next.js marque
  TODAS las rutas del sitio como dinámicas en el build, incluso
  páginas sin ninguna otra dependencia de datos (Home, Login,
  Registro), que antes eran estáticas. Se mitigó con `<Suspense>`
  (streaming: no bloquea el contenido fijo del header ni envía datos
  de sesión innecesarios al cliente), pero el build sigue sin poder
  marcar esas rutas como estáticas. Next.js resuelve esto de raíz con
  `cacheComponents`/Partial Prerendering (PPR): permite pre-generar la
  parte estática de una ruta en build time y solo streamear la parte
  dinámica en runtime.
- **Criterio de aceptación:** se evalúa (spike/investigación, no
  necesariamente implementación completa) si habilitar
  `cacheComponents` en `next.config.ts` es viable para este proyecto
  sin romper ninguna página existente ni introducir comportamiento
  inesperado (requiere runtime Node, es una función que puede seguir
  evolucionando entre versiones de Next.js). Si se decide implementar,
  el build debe volver a marcar Home/Login/Registro como estáticas (o
  con shell estático + partes dinámicas streameadas) sin regresiones
  funcionales en el resto del sitio.
