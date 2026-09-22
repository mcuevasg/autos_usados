# Autos Usados — Marketplace

Marketplace de autos usados en Chile, donde vendedores (personas naturales y
concesionarios) verificados por RUT publican anuncios comparables entre sí,
para que los compradores puedan filtrar y comparar ofertas según precio,
año, kilometraje, estado y uso del vehículo.

La aplicación está desplegada en producción en
[autos-usados-one.vercel.app](https://autos-usados-one.vercel.app).

Ver `.project/vision.md`, `.project/requeriments.md` y
`.project/architecture.md` para el detalle de producto y arquitectura.

Este proyecto está construido con [Next.js](https://nextjs.org), bootstrapeado
con [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app),
y usa [Supabase](https://supabase.com) como backend (Postgres, Auth, Storage).

## Navegación

Todas las páginas del sitio comparten un header persistente con el logo
"Autos Usados Chile" (enlaza a la home) y un enlace a "Buscar". Sin sesión
iniciada, muestra accesos directos a "Ingresar" y "Vender / Registrarme"; con
sesión iniciada, muestra "Mi cuenta" y "Cerrar sesión". En pantallas
pequeñas, la navegación colapsa a un menú hamburguesa, con una breve
animación de entrada al abrirse.

## Página de inicio

La home (`/`) es una landing page pensada para captar y orientar a nuevos
visitantes: un hero con el mensaje "Tu próximo auto usado, sin sorpresas" y
un badge de confianza, un buscador rápido (marca, modelo y ubicación) que
lleva directo a `/buscar` con esos filtros ya aplicados, una franja con
cifras reales del marketplace (autos publicados, porcentaje de vendedores
verificados y ciudades con anuncios), una grilla de marcas destacadas
—calculada a partir de los anuncios realmente publicados, cada una
enlazando a la búsqueda filtrada por esa marca—, una sección con los tres
pilares de confianza de la plataforma (verificación de RUT, mínimo de fotos
por anuncio y agrupación comparativa de ofertas similares) y un llamado a
la acción final para quienes quieran vender.

## Variables de entorno

El proyecto requiere credenciales de Supabase para funcionar. Copia
`.env.local.example` a `.env.local` y completa los valores con los datos de
tu proyecto Supabase (Project Settings > API):

```bash
cp .env.local.example .env.local
```

Variables requeridas:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `RESEND_API_KEY`: clave de [Resend](https://resend.com), usada para enviar
  las notificaciones por email. Mientras la cuenta Resend no tenga un
  dominio propio verificado, los correos de prueba solo se entregan a la
  casilla del dueño de la cuenta (limitación del proveedor en modo sandbox).
- `NVIDIA_API_KEY`, `NVIDIA_API_ENDPOINT` y `NVIDIA_MODEL_ID`: credenciales
  del modelo LLM de [NVIDIA NIM](https://build.nvidia.com) usado por el
  Asistente de Compra con IA (`/asistente`).

`.env.local` no se versiona.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Cuentas de usuario

Los usuarios pueden registrarse y crear una cuenta en `/registro` e iniciar
sesión en `/login`, usando Supabase Auth. Cada cuenta tiene un rol (comprador,
vendedor o moderador), asignado automáticamente al registrarse. En `/cuenta`
el usuario ve su email y su rol, puede cerrar sesión, y ve un link a sus
notificaciones con un contador de las que aún no ha leído.

Desde `/cuenta`, los usuarios con rol comprador pueden registrarse como
vendedor en `/vendedor/registro`, indicando si son persona natural o
concesionario, su RUT (validado localmente) y un documento de respaldo. El
registro queda pendiente de revisión y la cuenta pasa a tener rol vendedor.

## Panel de moderador

Los usuarios con rol moderador acceden en `/moderador/vendedores` a un panel
que lista los vendedores en estado "pendiente" junto con su documentación de
respaldo, y permite marcarlos como "Verificado" o "Rechazado". Solo un
vendedor verificado puede publicar anuncios.

Desde `/moderador/anuncios`, el moderador ve todos los anuncios de la
plataforma y puede cambiar su estado entre "Borrador", "Publicado",
"Pausado", "Vendido" y "Rechazado". Solo un cambio de estado realizado por
un moderador queda permitido: un vendedor no puede publicar (ni cambiar de
ningún otro modo el estado de) su propio anuncio directamente.

## Publicar un anuncio

Un vendedor con estado "Verificado" puede crear un anuncio en
`/vendedor/anuncios/nuevo`, indicando marca, modelo, año, kilometraje,
precio, estado del vehículo, tipo de uso, si los papeles están al día (sí/no)
y ubicación. El campo "papeles al día" no tiene opción preseleccionada: el
vendedor debe elegirla explícitamente para poder enviar el formulario. El
anuncio queda guardado en estado "borrador" y su resumen puede consultarse
desde la página de confirmación tras crearlo.

Desde el resumen del anuncio, el vendedor puede subir y gestionar sus fotos
en `/vendedor/anuncios/[id]/fotos`, donde se muestra un contador de fotos
cargadas. Un anuncio necesita al menos 3 fotos para poder publicarse, y su
publicación (paso a estado "Publicado") la realiza un moderador desde
`/moderador/anuncios`. Solo los anuncios en estado "Publicado" aparecen en
las búsquedas públicas.

## Buscar autos

Cualquier visitante, sin necesidad de iniciar sesión, puede buscar autos
publicados en `/buscar`, con filtros combinables por marca, modelo, año y
ubicación. Los resultados solo muestran anuncios en estado "Publicado"; si
ningún anuncio coincide con los filtros aplicados, se muestra un mensaje
indicando que no hay resultados.

Los resultados se agrupan automáticamente por marca, modelo y rango de año
similar, mostrando por cada grupo un grid de tarjetas visuales (1 columna en
mobile, hasta 3 en desktop) para facilitar la comparación entre ofertas
similares. Cada tarjeta muestra la foto de portada como imagen dominante,
el precio en tipografía destacada, y specs con iconografía (año,
kilometraje, estado del vehículo, papeles al día), además del tipo de
vendedor (persona natural / concesionario) y la ubicación. Si un anuncio no
tiene fotos, o la imagen no puede cargarse, se muestra un placeholder "Sin
foto" en su lugar.

Los anuncios con plan "Destacado" vigente se muestran con la etiqueta
"⭐ Destacado" y aparecen primero: tanto dentro de cada grupo comparativo
como entre los grupos, un grupo con al menos un anuncio destacado se
muestra antes que uno sin destacados. Un anuncio deja de mostrarse como
destacado automáticamente en cuanto su plan expira.

Cada tarjeta enlaza a la página de detalle completo del anuncio
(`/anuncio/[id]`, ver siguiente sección).

Al navegar hacia `/buscar` (o al recargarla con filtros nuevos) se muestra de
inmediato un estado de carga tipo skeleton con la misma silueta de la
página real (formulario de filtros y grid de tarjetas), mientras se
resuelven los datos en el servidor.

## Detalle de un anuncio

Al hacer click en cualquier tarjeta de `/buscar`, se abre `/anuncio/[id]`
con toda la información del anuncio: una galería con TODAS sus fotos
(imagen principal + miniaturas clickeables debajo, o el placeholder "Sin
foto" si no tiene ninguna), precio destacado en tipografía grande, y una
ficha con todas sus specs (marca, modelo, año, kilometraje, estado del
vehículo, papeles al día, tipo de uso y ubicación), además del tipo de
vendedor (persona natural / concesionario) y el mismo badge
"⭐ Destacado" de la búsqueda cuando corresponde. Incluye un botón
"Contactar vendedor" (por ahora un placeholder: el proyecto todavía no
tiene mensajería comprador/vendedor).

Al igual que en `/buscar`, esta página es pública y solo muestra anuncios
en estado "Publicado": un `id` que no existe, o que corresponde a un
anuncio en borrador/pausado/vendido/rechazado, responde con un 404, sin
importar si alguien adivina el UUID directamente en la URL.

Al navegar hacia `/anuncio/[id]` se muestra igual que en `/buscar` un
estado de carga tipo skeleton (galería + ficha de specs) mientras se
resuelven los datos del anuncio en el servidor.

## Solicitar una venta

Desde el resumen de un anuncio propio en estado "Publicado", el vendedor
puede solicitar registrar una venta concretada en
`/vendedor/anuncios/[id]/venta`, indicando el precio final acordado. El
anuncio permanece "Publicado" mientras la solicitud está pendiente de
aprobación, y no es posible enviar una nueva solicitud si ya existe una
pendiente para ese anuncio.

## Aprobar una venta

Los moderadores acceden en `/moderador/ventas` a un panel que lista las
solicitudes de venta pendientes de aprobación. Al aprobar una solicitud, se
calcula automáticamente la comisión (5% del precio final acordado), se
registra en la venta, y el anuncio correspondiente pasa a estado "Vendido".

## Plan Destacado

Desde el resumen de un anuncio propio en estado "Publicado", un vendedor
concesionario puede activar el plan "Destacado" para ese anuncio. El plan
dura 30 días desde la activación, y su fecha de expiración se muestra en el
mismo resumen mientras esté vigente. Esta opción no está disponible para
vendedores persona natural. Mientras el plan está vigente, el anuncio recibe
la etiqueta y la prioridad de posición descritas en la sección "Buscar
autos"; al expirar, las pierde automáticamente, sin intervención manual.

## Notificaciones

Cualquier usuario con sesión iniciada ve sus notificaciones en
`/notificaciones`, ordenadas de más reciente a más antigua, con indicación
visual de las no leídas y la opción de marcarlas como leídas. Se genera una
notificación automáticamente cuando: un moderador verifica o rechaza un
vendedor, un moderador cambia el estado de un anuncio, o un moderador
aprueba una venta (indicando el monto de la comisión). La página `/cuenta`
enlaza a `/notificaciones` mostrando un contador de las que aún no se han
leído.

Además de la notificación dentro de la app, cuando un moderador cambia el
estado de un anuncio o aprueba una venta, el usuario afectado también recibe
un correo electrónico con el mismo aviso (vía [Resend](https://resend.com)).
La verificación de vendedor solo genera notificación dentro de la app, sin
email. Un email que falle en enviarse nunca bloquea ni revierte la acción
del moderador.

## Asistente de Compra con IA

Cualquier visitante, sin necesidad de iniciar sesión, puede conversar con un
asistente de compra en `/asistente` para ir definiendo en lenguaje natural
qué auto busca o qué requerimientos de compra tiene. El asistente responde
recomendando únicamente autos que realmente están publicados en el
marketplace (nunca inventa anuncios que no existen), y avisa cuando no
encuentra coincidencias.

> **Nota:** al cierre de esta funcionalidad, la cuenta de NVIDIA configurada
> responde `403 Authorization failed` al llamar al modelo (problema de
> permisos/créditos de la cuenta, no del código); mientras eso no se
> resuelva, el asistente muestra un mensaje de error claro en vez de una
> respuesta del modelo.

## Tests

Este proyecto usa [Vitest](https://vitest.dev) para las pruebas unitarias.
Para ejecutarlas:

```bash
npm run test
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
