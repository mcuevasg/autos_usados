-- T-04 (fix de seguridad post-revisión): la política `sales_insert_own`
-- original solo validaba que el listing perteneciera al vendedor, pero no
-- restringía `status` ni `commission` en el insert. Esto permitía que un
-- vendedor insertara una fila con `status = 'aprobada'` y una `commission`
-- arbitraria, auto-aprobándose la venta y evitando el flujo de moderador
-- (T-16).
--
-- Este archivo corrige la política ya aplicada manualmente (vía SQL
-- Editor) en el proyecto Supabase real. La definición corregida también
-- se actualizó en 0002_rls_policies.sql para que quede correcta en
-- futuros entornos/reinstalaciones desde cero.

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
    )
  );
