-- T-04: Esquema inicial de base de datos
-- Tablas: sellers, listings, listing_photos, sales, notifications
-- Ver .project/architecture.md, sección "Modelo de datos".

-- Extensión necesaria para gen_random_uuid().
create extension if not exists pgcrypto;

-- Función utilitaria para mantener updated_at al día en cada UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- sellers: vendedores (persona natural o concesionario), vinculados 1:1
-- a un usuario de Supabase Auth (auth.users) para poder aplicar RLS por
-- dueño (auth.uid()).
-- =========================================================================
create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  seller_type text not null check (seller_type in ('persona_natural', 'concesionario')),
  rut text not null,
  verification_status text not null default 'pendiente'
    check (verification_status in ('pendiente', 'verificado', 'rechazado')),
  verification_document_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sellers is 'Vendedores (persona natural o concesionario) vinculados a auth.users.';
comment on column public.sellers.rut is 'RUT chileno (personal o de empresa según seller_type), validado en la app (T-06).';
comment on column public.sellers.verification_document_url is 'Referencia al documento de respaldo cargado (ej. path en Supabase Storage).';

create trigger sellers_set_updated_at
  before update on public.sellers
  for each row
  execute function public.set_updated_at();

-- =========================================================================
-- listings: anuncios de autos usados.
-- =========================================================================
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  brand text not null,
  model text not null,
  year integer not null check (year >= 1900),
  mileage integer not null check (mileage >= 0),
  price numeric(12, 2) not null check (price >= 0),
  vehicle_condition text not null,
  papers_up_to_date boolean not null default false,
  usage_type text not null
    check (usage_type in ('familiar', 'trabajo', 'carga', 'todo_terreno')),
  location text not null,
  status text not null default 'borrador'
    check (status in ('borrador', 'publicado', 'pausado', 'vendido', 'rechazado')),
  featured_active boolean not null default false,
  featured_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.listings is 'Anuncios de vehículos publicados por un seller.';
comment on column public.listings.vehicle_condition is 'Estado del vehículo (texto libre por ahora; catálogo exacto se define en T-11).';
comment on column public.listings.usage_type is 'Tipo de uso: familiar, trabajo, carga o todo terreno (REQ-04).';
comment on column public.listings.status is 'Ciclo de vida del anuncio (REQ-05): borrador, publicado, pausado, vendido, rechazado.';
comment on column public.listings.featured_active is 'Plan destacado activo (REQ-09).';
comment on column public.listings.featured_expires_at is 'Fecha de expiración del plan destacado, cuando featured_active = true.';

create index if not exists listings_seller_id_idx on public.listings (seller_id);
create index if not exists listings_status_idx on public.listings (status);
create index if not exists listings_brand_model_year_idx on public.listings (brand, model, year);

create trigger listings_set_updated_at
  before update on public.listings
  for each row
  execute function public.set_updated_at();

-- =========================================================================
-- listing_photos: fotos de un anuncio (referencias a Supabase Storage).
-- La validación de mínimo 3 fotos por anuncio se implementa en la
-- aplicación (T-10), no como constraint de base de datos.
-- =========================================================================
create table if not exists public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.listing_photos is 'Fotos de un anuncio, referenciando archivos en Supabase Storage.';
comment on column public.listing_photos.storage_path is 'Ruta/objeto dentro del bucket de Supabase Storage.';

create index if not exists listing_photos_listing_id_idx on public.listing_photos (listing_id);

-- =========================================================================
-- sales: ventas concretadas sobre un anuncio.
-- =========================================================================
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete restrict,
  final_price numeric(12, 2) not null check (final_price >= 0),
  status text not null default 'pendiente_aprobacion'
    check (status in ('pendiente_aprobacion', 'aprobada')),
  commission numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sales is 'Solicitudes/registros de venta concretada de un anuncio (REQ-08).';
comment on column public.sales.commission is 'Comisión calculada sobre final_price al aprobar la venta.';

create index if not exists sales_listing_id_idx on public.sales (listing_id);

create trigger sales_set_updated_at
  before update on public.sales
  for each row
  execute function public.set_updated_at();

-- =========================================================================
-- notifications: notificaciones dentro de la app para un usuario.
-- =========================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  message text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.notifications is 'Notificaciones in-app para un usuario (auth.users), ej. cambios de estado de anuncio o venta.';
comment on column public.notifications.event_type is 'Tipo de evento que generó la notificación (ej. listing_status_changed, sale_approved).';

create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists notifications_user_id_unread_idx on public.notifications (user_id) where not is_read;
