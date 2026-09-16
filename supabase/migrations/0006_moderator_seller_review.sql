-- T-08: Panel de moderador para aprobar/rechazar vendedores.
--
-- Objetivo (criterio de aceptación de T-08, REQ-01): un usuario con rol
-- moderador ve la lista de vendedores en estado "Pendiente de revisión"
-- con su documentación, y puede cambiar el estado a "Verificado" o
-- "Rechazado". Un vendedor no verificado no puede publicar anuncios.
--
-- Esta migración agrega:
--   a. Política de lectura de TODAS las filas de `sellers` para un
--      moderador (además de la lectura de la propia fila, ya existente).
--   b. Política de actualización de TODAS las filas de `sellers` para un
--      moderador (para poder cambiar verification_status).
--   c. Política de lectura de storage.objects del bucket
--      'seller-documents' para un moderador, sobre CUALQUIER carpeta (no
--      solo la propia), necesaria para poder revisar la documentación.
--   d. Corrección de `listings_insert_own` (0002_rls_policies.sql) para
--      exigir además que el seller esté verificado: implementa a nivel de
--      base de datos que "un vendedor no verificado no puede publicar
--      anuncios" (adelanta parte de T-09, que aún no tiene UI).
--
-- El rol 'moderador' se determina consultando `public.profiles.role`
-- (0004_profiles_and_roles.sql). Promover a un usuario a moderador sigue
-- siendo manual (vía SQL Editor o service_role), tal como ya documentaba
-- 0004_profiles_and_roles.sql.

-- =========================================================================
-- sellers: lectura y actualización por parte de un moderador.
-- =========================================================================

-- Se combina por OR con `sellers_select_own` (0002_rls_policies.sql): un
-- vendedor sigue viendo solo su propia fila, y además un moderador ve
-- todas las filas (necesario para listar los vendedores "pendiente").
create policy "sellers_select_moderator"
  on public.sellers
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

-- Permite que un moderador actualice cualquier fila de `sellers` (para
-- cambiar verification_status a 'verificado' o 'rechazado').
--
-- NOTA: esta política no restringe qué columnas puede modificar el
-- moderador (RLS aplica a nivel de fila, no de columna); es una
-- limitación conocida. La UI (app/moderador/vendedores/actions.ts) solo
-- debe enviar cambios a `verification_status`, y las Server Actions
-- vuelven a verificar en servidor que quien ejecuta la acción es
-- moderador antes de aplicar el cambio.
create policy "sellers_update_moderator"
  on public.sellers
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'moderador'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'moderador'
    )
  );

-- =========================================================================
-- storage.objects (bucket 'seller-documents'): lectura por un moderador
-- de CUALQUIER documento de vendedor (no solo el propio), necesaria para
-- revisar la documentación antes de aprobar/rechazar.
-- =========================================================================
create policy "seller_documents_select_moderator"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'seller-documents'
    and exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'moderador'
    )
  );

-- =========================================================================
-- listings: un vendedor no verificado no puede publicar anuncios.
--
-- Se reemplaza `listings_insert_own` (0002_rls_policies.sql) por una
-- versión idéntica que además exige que el seller esté 'verificado'.
-- =========================================================================
drop policy if exists "listings_insert_own" on public.listings;

create policy "listings_insert_own"
  on public.listings
  for insert
  to authenticated
  with check (
    seller_id in (
      select id
      from public.sellers s
      where s.user_id = auth.uid()
        and s.verification_status = 'verificado'
    )
  );
