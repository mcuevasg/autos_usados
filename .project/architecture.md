# Arquitectura: Marketplace de Autos Usados

Basado en `vision.md` y `requeriments.md`.

## Restricciones y Contexto Técnico

### Escala esperada (primeros 6-12 meses)

- Usuarios registrados: ~10.000
- Anuncios activos simultáneos: ~5.000
- Tráfico: ~100 usuarios diarios

Esto corresponde a una escala pequeña/inicial: no se requiere
infraestructura de alta concurrencia desde el día uno, pero el diseño debe
permitir crecer sin una reescritura mayor.

### Presupuesto

Presupuesto de hosting cercano a **cero** mientras no haya usuarios reales
(fase pre-lanzamiento/validación). Esto orienta a usar tiers gratuitos o de
muy bajo costo (free tier de hosting, base de datos gestionada gratuita,
etc.) hasta validar tracción real.

### Stack Tecnológico (aprobado)

- **Frontend + Backend**: Next.js (React + TypeScript), full-stack en un
  solo framework
- **Hosting**: Vercel (tier gratuito)
- **Base de datos**: PostgreSQL gestionado vía Supabase (tier gratuito)
- **Almacenamiento de fotos**: Supabase Storage (tier gratuito), para las
  fotos de anuncios (mín. 3, REQ-03)
- **Autenticación**: Supabase Auth, base para el flujo de verificación de
  vendedores (REQ-01/REQ-02)

Elegido por ajustarse al presupuesto cercano a cero y mantenerse dentro de
los límites gratuitos de ambos servicios a la escala esperada (5.000
anuncios activos, 100 usuarios diarios).

### Equipo

Un solo desarrollador (el usuario), apoyado por Claude Code. No hay equipo
adicional. Esto refuerza la elección de un stack "todo en uno"
(Next.js + Supabase) para minimizar la cantidad de servicios distintos a
mantener y coordinar.

### Integraciones Externas (aprobado)

- **Validación de RUT**: algoritmo de dígito verificador chileno (módulo
  11) implementado localmente en el código, sin servicio externo. Valida
  formato/dígito verificador; la "existencia real" del RUT queda cubierta
  por la revisión manual (REQ-01), no por consulta a un registro oficial
  (evita costos de un servicio pago).
- **Notificaciones**: notificaciones dentro de la app (tabla en Supabase)
  + correo electrónico vía un proveedor con tier gratuito (ej. Resend,
  ~100 emails/día gratis) para eventos clave (cambio de estado de
  anuncio, aprobación de venta concretada). Sin SMS, por tener costo por
  mensaje.

### Despliegue

Cubierto por el stack aprobado: Vercel (hosting) + Supabase (base de
datos, storage, auth), ambos con despliegue gestionado en la nube, sin
infraestructura on-premise ni self-hosted.

## Preguntas pendientes de la entrevista

Ninguna. Con esta información hay suficiente base para proponer la
arquitectura completa.

## Arquitectura Propuesta (pendiente de aprobación)

### Visión general de componentes

Una única aplicación Next.js (App Router, TypeScript) desplegada en
Vercel, que concentra frontend, API y lógica de negocio, sobre Supabase
como backend de datos/auth/storage. No hay microservicios ni backend
separado: se ajusta al equipo de un solo desarrollador y al presupuesto
cercano a cero.

```
[ Navegador ]
      |
      v
[ Next.js en Vercel ]  --- Server Actions / API Routes ---> [ Supabase ]
      |                                                        |- Postgres (datos)
      |                                                        |- Auth (roles)
      |                                                        |- Storage (fotos)
      |
      +--> [ Resend ] (emails de notificación)
```

### Roles de usuario (Supabase Auth)

- **Comprador**: busca, filtra y compara anuncios (REQ-06, REQ-07)
- **Vendedor** (persona natural o concesionario): se registra, sube
  documentación de respaldo, gestiona sus anuncios (REQ-01 a REQ-05,
  REQ-08, REQ-09)
- **Moderador**: revisa documentación, aprueba/rechaza verificación de
  vendedores, cambia estados de anuncios, aprueba ventas concretadas

### Modelo de datos (entidades principales en Postgres)

- `sellers`: tipo (persona natural/concesionario), rut, estado de
  verificación (pendiente/verificado/rechazado), referencia a
  documento de respaldo
- `listings` (anuncios): marca, modelo, año, kilometraje, precio,
  estado del vehículo, papeles al día, tipo de uso, ubicación, estado
  del anuncio (borrador/publicado/pausado/vendido/rechazado), plan
  destacado (activo + fecha de expiración), referencia a `sellers`
- `listing_photos`: referencias a archivos en Supabase Storage
  (mínimo 3 por anuncio)
- `sales` (ventas): referencia a `listings`, precio final, estado
  (pendiente de aprobación/aprobada), comisión calculada
- `notifications`: usuario destinatario, tipo de evento, leído/no leído

La **agrupación por similitud** (REQ-07) y los **filtros de búsqueda**
(REQ-06) se resuelven con consultas SQL sobre `listings` (agrupando por
marca + modelo + rango de año), sin necesidad de una tabla ni proceso
adicional.

### Seguridad de acceso a datos

Row Level Security (RLS) de Supabase para que:
- un vendedor solo pueda editar sus propios anuncios
- solo moderadores puedan cambiar estados de anuncio, aprobar
  verificaciones de vendedor y aprobar ventas

### Flujos clave

- **Verificación de vendedor** (REQ-01/02): registro → validación local
  de RUT (dígito verificador) → estado "pendiente" → moderador revisa
  documento de respaldo → estado "verificado" o "rechazado"
- **Publicación de anuncio** (REQ-03/04/05): vendedor completa
  formulario con campos obligatorios y sube fotos a Supabase Storage →
  queda en "borrador" → moderador publica/pausa/rechaza
- **Venta concretada** (REQ-08): vendedor solicita marcar como vendido
  con precio final → moderador aprueba → sistema calcula comisión →
  notificación por email/in-app
- **Plan destacado** (REQ-09): concesionario activa el plan sobre un
  anuncio → anuncio se marca con prioridad y etiqueta visual hasta la
  fecha de expiración

### Despliegue

- Next.js desplegado en Vercel (tier gratuito), conectado a git para
  despliegue continuo
- Supabase (tier gratuito) como base de datos, auth y storage
- Resend (tier gratuito) para envío de emails de notificación

**Estado:** Aprobado por el usuario.
