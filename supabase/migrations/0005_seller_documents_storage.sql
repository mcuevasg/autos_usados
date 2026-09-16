-- T-07: Bucket privado de Supabase Storage para documentos de respaldo de
-- vendedores (persona natural / concesionario), subidos al registrarse
-- como vendedor.
--
-- Los archivos se guardan bajo el path `{auth.uid()}/{nombre-archivo}`
-- (ver app/vendedor/registro/actions.ts), y las políticas de abajo
-- restringen el acceso a que cada usuario autenticado solo pueda subir y
-- leer archivos bajo su propio prefijo de carpeta (su `auth.uid()`), igual
-- que el resto de las políticas por dueño del proyecto (sellers, listings,
-- etc. en 0002_rls_policies.sql). Ningún usuario autenticado puede leer
-- documentos de otro usuario. El bucket es privado (`public = false`): no
-- hay política para el rol `anon`.

insert into storage.buckets (id, name, public)
values ('seller-documents', 'seller-documents', false)
on conflict (id) do nothing;

-- storage.objects ya tiene RLS habilitado por defecto en Supabase; solo
-- agregamos las políticas específicas de este bucket.

create policy "seller_documents_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'seller-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "seller_documents_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'seller-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Sin políticas de update/delete: por ahora un vendedor no puede
-- reemplazar ni borrar su documento de respaldo una vez subido vía API
-- pública (solo service_role, que bypassa RLS, podría hacerlo).
