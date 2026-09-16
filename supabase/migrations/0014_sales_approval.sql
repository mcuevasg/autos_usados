-- T-16: Aprobación de venta y cálculo de comisión.
--
-- Objetivo (criterio de aceptación de T-16, REQ-08): un moderador puede
-- aprobar la solicitud de venta; al aprobarla, el anuncio pasa a estado
-- "Vendido" y el sistema calcula y registra la comisión sobre el precio
-- final indicado.
--
-- Estado previo: `sales_select_own` (0002_rls_policies.sql) solo permite
-- que el dueño del listing vea SUS PROPIAS solicitudes de venta, y no
-- existe ninguna política de UPDATE sobre `sales` para `authenticated`.
-- Un moderador necesita, para poder aprobar solicitudes: (a) listar TODAS
-- las solicitudes pendientes, sin importar el vendedor, y (b) poder
-- actualizar la fila (`status` -> 'aprobada', `commission` calculada).
--
-- Esta migración agrega:
--   a. Política `sales_select_moderator`: un moderador puede leer TODAS
--      las filas de `sales` (necesario para listar pendientes en el panel
--      de moderador, `app/moderador/ventas/page.tsx`).
--   b. Política `sales_update_moderator`: un moderador puede actualizar
--      cualquier fila de `sales` (necesaria para aprobar una solicitud).
--
-- Sobre un trigger análogo a `prevent_unauthorized_listing_status_change`
-- (T-12, 0010) o `prevent_unauthorized_verification_status_change`
-- (T-07/T-08, 0007/0008): SE EVALUÓ Y NO SE AGREGA, por lo siguiente.
-- Esos triggers existen porque, en sus respectivas tablas, YA HABÍA una
-- política de UPDATE amplia para el propio dueño de la fila
-- (`listings_update_own`, `sellers_update_own`) que permitía tocar
-- cualquier columna, incluida la de estado protegido; el trigger era la
-- única forma de restringir esa columna específica sin romper el resto de
-- esa política de UPDATE. En `sales`, en cambio, NO existe ninguna
-- política de UPDATE para el vendedor dueño del listing (solo existe
-- `sales_select_own` para lectura e `sales_insert_own` para creación,
-- 0002/0003/0013): con RLS, la ausencia de una política de UPDATE que
-- aplique a un rol implica que ese rol simplemente no puede ejecutar
-- ningún UPDATE sobre la tabla (deny-by-default de Postgres RLS), sin
-- importar qué columnas intente cambiar. Es decir, un vendedor normal
-- (no moderador) ya no puede cambiar `sales.status` de
-- 'pendiente_aprobacion' a 'aprobada' vía la API por la simple ausencia de
-- una política que se lo permita; la única política de UPDATE que se
-- agrega aquí (`sales_update_moderator`) exige explícitamente el rol
-- moderador tanto en `using` como en `with check`. Un trigger adicional
-- sería, por lo tanto, redundante: no hay ningún camino de RLS por el que
-- un no-moderador pueda llegar a un UPDATE sobre `sales` en primer lugar.

-- =========================================================================
-- a. sales: lectura de TODAS las solicitudes/ventas por parte de un
-- moderador (se combina por OR con `sales_select_own`, 0002_rls_policies.sql:
-- el vendedor sigue viendo solo las suyas, el moderador ve todas).
-- =========================================================================
create policy "sales_select_moderator"
  on public.sales
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
-- b. sales: actualización de CUALQUIER fila por parte de un moderador.
--
-- NOTA: esta política no restringe qué columnas puede modificar el
-- moderador ni qué transición de `status` es válida (RLS aplica a nivel
-- de fila, no de columna ni de valor) — es una limitación conocida, igual
-- que `sellers_update_moderator` (0006) y `listings_update_moderator`
-- (0010). La UI/Server Action (`app/moderador/ventas/actions.ts`,
-- función `aprobarVenta`) es la responsable de enviar ÚNICAMENTE
-- `status = 'aprobada'` y `commission` calculada (5% de `final_price`),
-- sin tocar `final_price` ni `listing_id`, y de volver a verificar en
-- servidor que quien invoca es moderador antes de ejecutar el UPDATE.
-- =========================================================================
create policy "sales_update_moderator"
  on public.sales
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
