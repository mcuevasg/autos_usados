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
el usuario ve su email y su rol, y puede cerrar sesión.

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
indicando que no hay resultados. La página de inicio enlaza directamente a
`/buscar` y a `/login`.

Los resultados se agrupan automáticamente por marca, modelo y rango de año
similar, mostrando por cada grupo un listado comparativo con precio, año,
kilometraje, estado del vehículo, papeles al día, tipo de vendedor (persona
natural / concesionario) y ubicación de cada anuncio, para facilitar la
comparación entre ofertas similares.

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
vendedores persona natural.

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
</content>
