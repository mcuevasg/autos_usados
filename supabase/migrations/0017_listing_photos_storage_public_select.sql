-- T-21: Mostrar fotos de los anuncios en la búsqueda.
--
-- Problema detectado durante T-21: `/buscar` es pública y no requiere
-- sesión (T-13), pero `listing_photos_storage_select` (0009) solo
-- otorgaba `select` sobre `storage.objects` del bucket 'listing-photos'
-- `to authenticated`. Un visitante anónimo nunca podía generar una URL
-- firmada válida para la portada de un anuncio, cayendo siempre al
-- placeholder "Sin foto" aunque el anuncio estuviera publicado.
--
-- Esta migración agrega `anon` a esa misma política, sin cambiar su
-- condición: sigue exigiendo que el anuncio esté publicado, o que
-- pertenezca al vendedor autenticado (esta segunda rama nunca aplica
-- para `anon`, ya que `auth.uid()` es NULL en ese contexto). Mismo
-- criterio que ya usa `listing_photos_select` (tabla, 0002_rls_policies.sql)
-- para lectura pública de anuncios publicados.
drop policy if exists "listing_photos_storage_select" on storage.objects;

create policy "listing_photos_storage_select"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1
      from public.listings l
      where l.id = (storage.foldername(name))[1]::uuid
        and (
          l.status = 'publicado'
          or l.seller_id in (select id from public.sellers where user_id = auth.uid())
        )
    )
  );
