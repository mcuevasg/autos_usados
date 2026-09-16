-- T-04: Políticas de Row Level Security (RLS).
--
-- Objetivo principal (criterio de aceptación de T-04): un vendedor NO
-- puede leer ni editar los `sellers`/`listings` (ni tablas relacionadas)
-- de otro vendedor.
--
-- Nota sobre roles futuros: aún no existe un rol "moderador" (eso es
-- T-08/T-12/T-16). Las políticas de abajo están escritas para poder
-- extenderse más adelante agregando políticas adicionales para ese rol
-- (ej. usando una tabla/claim de rol), sin necesidad de rediseñar el
-- esquema.

-- =========================================================================
-- sellers
-- =========================================================================
alter table public.sellers enable row level security;

create policy "sellers_select_own"
  on public.sellers
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "sellers_insert_own"
  on public.sellers
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "sellers_update_own"
  on public.sellers
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Sin política de delete: por ahora nadie (salvo service_role, que
-- siempre bypassa RLS) puede borrar un seller vía API pública.

-- =========================================================================
-- listings
-- =========================================================================
alter table public.listings enable row level security;

-- Un vendedor ve sus propios anuncios en cualquier estado.
create policy "listings_select_own"
  on public.listings
  for select
  to authenticated
  using (
    seller_id in (select id from public.sellers where user_id = auth.uid())
  );

-- Cualquiera (incluido anon) puede leer anuncios ya publicados. Esta
-- política es adicional (permisiva) a la anterior: ambas se combinan con
-- OR, así que un vendedor sigue viendo sus propios anuncios en cualquier
-- estado, y además cualquiera ve los publicados. Se deja lista para las
-- búsquedas públicas de T-12/T-13.
create policy "listings_select_published"
  on public.listings
  for select
  to anon, authenticated
  using (status = 'publicado');

create policy "listings_insert_own"
  on public.listings
  for insert
  to authenticated
  with check (
    seller_id in (select id from public.sellers where user_id = auth.uid())
  );

create policy "listings_update_own"
  on public.listings
  for update
  to authenticated
  using (
    seller_id in (select id from public.sellers where user_id = auth.uid())
  )
  with check (
    seller_id in (select id from public.sellers where user_id = auth.uid())
  );

create policy "listings_delete_own"
  on public.listings
  for delete
  to authenticated
  using (
    seller_id in (select id from public.sellers where user_id = auth.uid())
  );

-- =========================================================================
-- listing_photos
-- =========================================================================
alter table public.listing_photos enable row level security;

-- Lectura: dueño del anuncio (cualquier estado) o cualquiera si el
-- anuncio está publicado (coherente con listings_select_published).
create policy "listing_photos_select"
  on public.listing_photos
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.listings l
      where l.id = listing_photos.listing_id
        and (
          l.status = 'publicado'
          or l.seller_id in (select id from public.sellers where user_id = auth.uid())
        )
    )
  );

create policy "listing_photos_insert_own"
  on public.listing_photos
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.listings l
      join public.sellers s on s.id = l.seller_id
      where l.id = listing_photos.listing_id
        and s.user_id = auth.uid()
    )
  );

create policy "listing_photos_update_own"
  on public.listing_photos
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.listings l
      join public.sellers s on s.id = l.seller_id
      where l.id = listing_photos.listing_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.listings l
      join public.sellers s on s.id = l.seller_id
      where l.id = listing_photos.listing_id
        and s.user_id = auth.uid()
    )
  );

create policy "listing_photos_delete_own"
  on public.listing_photos
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.listings l
      join public.sellers s on s.id = l.seller_id
      where l.id = listing_photos.listing_id
        and s.user_id = auth.uid()
    )
  );

-- =========================================================================
-- sales
-- =========================================================================
alter table public.sales enable row level security;

-- El vendedor dueño del anuncio puede ver sus solicitudes/ventas.
create policy "sales_select_own"
  on public.sales
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.listings l
      join public.sellers s on s.id = l.seller_id
      where l.id = sales.listing_id
        and s.user_id = auth.uid()
    )
  );

-- El vendedor dueño del anuncio puede crear una solicitud de venta
-- (T-15) sobre su propio anuncio.
create policy "sales_insert_own"
  on public.sales
  for insert
  to authenticated
  with check (
    status = 'pendiente_aprobacion'
    and commission is null
    and exists (
      select 1
      from public.listings l
      join public.sellers s on s.id = l.seller_id
      where l.id = sales.listing_id
        and s.user_id = auth.uid()
    )
  );

-- Sin política de update/delete todavía: la aprobación de una venta
-- (cambio de estado a "aprobada" y cálculo de comisión) queda reservada
-- para el rol moderador, que se agregará en T-16 mediante una política
-- adicional (no requiere cambios de esquema).

-- =========================================================================
-- notifications
-- =========================================================================
alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = user_id);

-- El usuario destinatario puede marcar sus propias notificaciones como
-- leídas (is_read), pero no reasignarlas a otro usuario.
create policy "notifications_update_own"
  on public.notifications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Sin política de insert para authenticated/anon: las notificaciones se
-- crean desde el servidor (service_role, que bypassa RLS) al ocurrir los
-- eventos correspondientes (T-19).
