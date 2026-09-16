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
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-03):** solo un vendedor en estado
  "Verificado" puede crear un anuncio; el formulario exige marca, modelo,
  año, kilometraje y precio, y no permite guardar si falta alguno.

### T-10: Carga de fotos del anuncio (mínimo 3)

- **Depende de:** T-09, T-02
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-03):** el vendedor puede subir fotos a
  Supabase Storage desde el formulario de anuncio; el anuncio no puede
  enviarse a publicación con menos de 3 fotos cargadas.

### T-11: Campos obligatorios adicionales del anuncio

- **Depende de:** T-09
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-04):** el formulario exige además estado
  del vehículo, indicación de papeles al día (sí/no) y tipo de uso
  (familiar, trabajo, carga, todo terreno, seleccionado de una lista);
  no se puede guardar el anuncio si falta alguno de estos campos.

### T-12: Ciclo de vida del anuncio y panel de moderador

- **Depende de:** T-09, T-08
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-05):** un anuncio nuevo se crea en estado
  "Borrador"; solo un moderador puede cambiar su estado entre Borrador,
  Publicado, Pausado, Vendido y Rechazado; solo los anuncios en estado
  "Publicado" aparecen en búsquedas públicas; los anuncios en estado
  "Vendido" o "Rechazado" no permiten nuevos contactos de compradores.

## 3. Búsqueda y Comparación (REQ-06, REQ-07)

### T-13: Filtros de búsqueda de anuncios

- **Depende de:** T-12
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-06):** el comprador puede filtrar
  anuncios publicados combinando marca, modelo, año y ubicación; los
  resultados solo incluyen anuncios en estado "Publicado" que cumplen
  todos los filtros; si no hay resultados, se muestra un listado vacío
  con mensaje, no un error.

### T-14: Agrupación automática por similitud

- **Depende de:** T-13
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-07):** al buscar, el sistema agrupa
  automáticamente anuncios que comparten marca, modelo y rango de año
  similar en un listado comparativo, mostrando por cada anuncio al menos
  precio, año, kilometraje, estado, papeles al día y vendedor.

## 4. Ventas y Comisión (REQ-08)

### T-15: Solicitud de venta concretada por el vendedor

- **Depende de:** T-12
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-08):** desde un anuncio en estado
  "Publicado", el vendedor puede enviar una solicitud de venta
  concretada indicando el precio final; el anuncio permanece
  "Publicado" mientras la solicitud está pendiente de aprobación.

### T-16: Aprobación de venta y cálculo de comisión

- **Depende de:** T-15
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-08):** un moderador puede aprobar la
  solicitud de venta; al aprobarla, el anuncio pasa a estado "Vendido" y
  el sistema calcula y registra la comisión sobre el precio final
  indicado.

## 5. Planes Destacados (REQ-09)

### T-17: Activación de plan destacado por concesionario

- **Depende de:** T-12
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-09):** un concesionario puede activar el
  plan "Destacado" sobre un anuncio propio en estado "Publicado",
  quedando registrada una fecha de expiración.

### T-18: Prioridad y etiqueta visual de anuncios destacados

- **Depende de:** T-17, T-14
- **Estado:** Pendiente
- **Criterio de aceptación (REQ-09):** los anuncios con plan destacado
  activo muestran una etiqueta visual distintiva y aparecen con
  prioridad de posición en resultados de búsqueda y en los grupos
  comparativos; al expirar el plan, el anuncio vuelve al orden estándar.

## 6. Notificaciones

### T-19: Notificaciones dentro de la app

- **Depende de:** T-08, T-12, T-16
- **Estado:** Pendiente
- **Criterio de aceptación:** al cambiar el estado de un anuncio, de una
  verificación de vendedor o de una venta, se crea un registro en
  `notifications` para el usuario afectado, visible en la app.

### T-20: Notificaciones por email

- **Depende de:** T-19
- **Estado:** Pendiente
- **Criterio de aceptación:** los mismos eventos de T-19 (cambio de
  estado de anuncio, aprobación de venta) disparan un correo al usuario
  afectado vía un proveedor de email con tier gratuito (ej. Resend).
