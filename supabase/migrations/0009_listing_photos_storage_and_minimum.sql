-- T-10: Carga de fotos del anuncio (mínimo 3).
--
-- Objetivo (criterio de aceptación, REQ-03): el vendedor puede subir
-- fotos a Supabase Storage desde el formulario de anuncio; el anuncio no
-- puede enviarse a publicación con menos de 3 fotos cargadas.
--
-- Esta migración agrega:
--   a. Bucket privado 'listing-photos' en Supabase Storage.
--   b. Políticas de storage.objects para ese bucket, con el path
--      convention `{listing_id}/{uuid}{ext}` (a diferencia de
--      'seller-documents' en 0005, aquí el primer segmento de carpeta es
--      el `listing_id`, no el `auth.uid()` de quien sube: el dueño se
--      determina vía join listings -> sellers).
--   c. Un trigger BEFORE UPDATE en `listings` que impide poner
--      `status = 'publicado'` si el anuncio tiene menos de 3 filas en
--      `listing_photos`. Esto deja la regla garantizada a nivel de base
--      de datos independientemente de quién implemente el cambio de
--      estado (el botón de "publicar" real es T-12, todavía no existe).
--
-- El bucket es privado (`public = false`), igual que 'seller-documents':
-- aunque `listing_photos_select` (tabla, 0002_rls_policies.sql) ya
-- permite lectura pública de las filas de anuncios publicados, para esta
-- primera iteración se mantiene consistencia con el patrón de URLs
-- firmadas ya usado en T-08, y se evita exponer fotos de anuncios en
-- borrador vía un bucket público.

-- =========================================================================
-- a. Bucket 'listing-photos'.
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', false)
on conflict (id) do nothing;

-- =========================================================================
-- b. Políticas de storage.objects para 'listing-photos'.
--
-- Path convention: `{listing_id}/{uuid}{ext}`. `(storage.foldername(name))[1]`
-- es el primer segmento de carpeta (el `listing_id` como texto); se
-- castea a uuid para poder unirlo contra `public.listings.id`.
-- =========================================================================

-- Insert: solo si el listing_id de la carpeta pertenece a un listing cuyo
-- seller es el usuario autenticado (igual criterio que
-- `listing_photos_insert_own`, 0002_rls_policies.sql).
create policy "listing_photos_storage_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'listing-photos'
    and exists (
      select 1
      from public.listings l
      join public.sellers s on s.id = l.seller_id
      where l.id = (storage.foldername(name))[1]::uuid
        and s.user_id = auth.uid()
    )
  );

-- Select: el listing está publicado, o pertenece al vendedor autenticado
-- (igual criterio que `listing_photos_select`, 0002_rls_policies.sql).
create policy "listing_photos_storage_select"
  on storage.objects
  for select
  to authenticated
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

-- Delete: solo la foto propia (mismo criterio que insert), para poder
-- borrar una foto subida por error. Nota: en Postgres las políticas de
-- DELETE solo admiten `using`, no `with check`.
create policy "listing_photos_storage_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1
      from public.listings l
      join public.sellers s on s.id = l.seller_id
      where l.id = (storage.foldername(name))[1]::uuid
        and s.user_id = auth.uid()
    )
  );

-- =========================================================================
-- c. Trigger: no se puede publicar un anuncio con menos de 3 fotos.
--
-- Análogo al patrón de triggers de protección de columna usado en T-08
-- (0007_protect_verification_status.sql / 0008): en vez de confiar solo
-- en la aplicación, la regla queda garantizada a nivel de base de datos,
-- sin importar qué código futuro (T-12) intente hacer el UPDATE.
-- =========================================================================
create or replace function public.prevent_publish_without_min_photos()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'publicado' and old.status is distinct from new.status then
    if (select count(*) from public.listing_photos where listing_id = new.id) < 3 then
      raise exception 'El anuncio necesita al menos 3 fotos para poder publicarse.';
    end if;
  end if;

  return new;
end;
$$;

create trigger listings_require_min_photos_to_publish
  before update on public.listings
  for each row
  execute function public.prevent_publish_without_min_photos();
