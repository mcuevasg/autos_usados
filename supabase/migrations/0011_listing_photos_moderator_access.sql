-- T-12 (fix post-revisión): un moderador no podía publicar anuncios con
-- fotos suficientes.
--
-- Causa: el trigger `listings_require_min_photos_to_publish` (T-10,
-- 0009_listing_photos_storage_and_minimum.sql) hace, dentro de un BEFORE
-- UPDATE en `listings`:
--
--   if (select count(*) from public.listing_photos where listing_id = new.id) < 3 then
--     raise exception ...
--
-- Esta función NO es `security definer`, así que la subconsulta corre
-- con los privilegios/RLS del rol que ejecuta el UPDATE (el moderador
-- autenticado, vía `listings_update_moderator` de
-- 0010_listing_status_lifecycle.sql). La política `listing_photos_select`
-- (0002_rls_policies.sql) solo permite ver fotos si `listings.status =
-- 'publicado'` O si el `seller_id` pertenece al `auth.uid()` actual. En
-- el momento en que corre el trigger BEFORE UPDATE, la fila en disco aún
-- tiene el status VIEJO (ej. 'borrador'), y el moderador no es el dueño
-- — así que RLS le oculta las fotos al moderador, el COUNT da 0, y el
-- trigger rechaza la publicación aunque el anuncio sí tenga 3+ fotos.
--
-- Mismo problema existe para `storage.objects` del bucket
-- 'listing-photos' (0009): un moderador tampoco podría generar signed
-- URLs para ver las fotos de un anuncio ajeno antes de aprobarlo.
--
-- Esta migración agrega, siguiendo el mismo patrón ya usado para
-- `sellers` / 'seller-documents' en T-08 (0006_moderator_seller_review.sql):
--   a. Política `listing_photos_select_moderator` en la tabla
--      `public.listing_photos`: un moderador puede ver TODAS las filas,
--      sin importar el estado del anuncio o quién es el dueño. Se
--      combina por OR con `listing_photos_select` (0002) ya existente.
--   b. Política `listing_photos_storage_select_moderator` en
--      `storage.objects` para el bucket 'listing-photos': permite que un
--      moderador genere signed URLs para ver las fotos de cualquier
--      anuncio. Se combina por OR con `listing_photos_storage_select`
--      (0009) ya existente.

-- =========================================================================
-- a. listing_photos: lectura de TODAS las filas por parte de un moderador.
-- =========================================================================
create policy "listing_photos_select_moderator"
  on public.listing_photos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'moderador'
    )
  );

-- =========================================================================
-- b. storage.objects (bucket 'listing-photos'): lectura por un moderador
-- de CUALQUIER foto de anuncio (no solo la del propio vendedor o de un
-- anuncio publicado), necesaria para poder revisar las fotos antes de
-- aprobar la publicación.
-- =========================================================================
create policy "listing_photos_storage_select_moderator"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'moderador'
    )
  );
