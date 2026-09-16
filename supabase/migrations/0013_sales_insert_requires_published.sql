-- T-15 (fix de seguridad post-revisión): la política `sales_insert_own`
-- (0003_fix_sales_insert_policy.sql, replicada como referencia en
-- 0002_rls_policies.sql) exige `status = 'pendiente_aprobacion'`,
-- `commission is null` y que el listing pertenezca a un seller del
-- usuario autenticado, pero NUNCA exigió `listings.status = 'publicado'`.
--
-- El criterio de aceptación de T-15 (REQ-08) exige explícitamente que la
-- solicitud de venta concretada se haga "desde un anuncio en estado
-- Publicado". Hoy esa regla solo se valida en servidor dentro de la
-- Server Action `solicitarVenta`
-- (app/vendedor/anuncios/[id]/venta/actions.ts), pero un vendedor
-- autenticado podría saltarse esa Server Action y llamar directamente a
-- la API REST de Supabase (PostgREST) para insertar una fila en `sales`
-- apuntando a un anuncio propio en 'borrador', 'pausado', 'vendido' o
-- 'rechazado'. Esto es exactamente el mismo tipo de gap de integridad de
-- datos que motivó 0003 originalmente (una regla de negocio validada solo
-- en la Server Action, no en RLS), así que se trata como bloqueante.
--
-- a. Se reemplaza `sales_insert_own` agregando `and l.status =
--    'publicado'` dentro del `exists`, con el mismo patrón drop + create
--    ya usado en 0003.
-- b. Se agrega, además, un índice único parcial que impide que existan
--    dos filas de `sales` con `status = 'pendiente_aprobacion'` para el
--    mismo `listing_id` (mejora de bajo costo sugerida en la revisión):
--    aunque la Server Action ya revisa esto con un `select` previo antes
--    de insertar, esa verificación no es atómica (dos solicitudes
--    concurrentes podrían pasar ambas el `select` antes de que cualquiera
--    haga el `insert`). El índice único la hace una garantía real a nivel
--    de base de datos. NOTA: esto significa que un `insert` que viole la
--    unicidad ahora falla con un error de constraint de Postgres
--    (`duplicate key value violates unique constraint
--    "sales_one_pending_per_listing"`) en el mismo caso donde antes solo
--    fallaba el `select` previo de la Server Action; ver el manejo de ese
--    código de error en `solicitarVenta`
--    (app/vendedor/anuncios/[id]/venta/actions.ts) para traducirlo al
--    mismo mensaje amigable que ya existía.

-- =========================================================================
-- a. sales: el insert solo procede si el listing referenciado está
-- 'publicado' (además de pertenecer a un seller del usuario autenticado).
-- =========================================================================
drop policy if exists "sales_insert_own" on public.sales;

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
        and l.status = 'publicado'
    )
  );

-- =========================================================================
-- b. sales: a lo sumo una solicitud 'pendiente_aprobacion' por listing,
-- garantizado a nivel de base de datos (no solo por el `select` previo de
-- la Server Action, que no es atómico frente a solicitudes concurrentes).
-- =========================================================================
create unique index sales_one_pending_per_listing
  on public.sales (listing_id)
  where status = 'pendiente_aprobacion';
