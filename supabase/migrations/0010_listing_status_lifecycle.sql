-- T-12: Ciclo de vida del anuncio y panel de moderador.
--
-- Objetivo (criterio de aceptación de T-12, REQ-05): un anuncio nuevo se
-- crea en estado "Borrador"; solo un moderador puede cambiar su estado
-- entre Borrador, Publicado, Pausado, Vendido y Rechazado; solo los
-- anuncios en estado "Publicado" aparecen en búsquedas públicas (ya
-- garantizado desde T-04 por `listings_select_published`,
-- 0002_rls_policies.sql, sin cambios en esta migración).
--
-- Gap de seguridad que esta migración cierra: `listings_update_own`
-- (0002_rls_policies.sql) permite que el dueño de un anuncio actualice
-- CUALQUIER columna de su propia fila, sin restricción, incluyendo
-- `status`. Hoy un vendedor podría cambiar su propio anuncio a
-- 'publicado' (si ya tiene 3+ fotos) sin pasar por un moderador. Se
-- corrige con el mismo patrón ya usado para `sellers.verification_status`
-- en 0007/0008: un trigger que bloquea el cambio de `status` salvo que
-- quien ejecuta el INSERT/UPDATE sea un moderador.
--
-- Esta migración agrega:
--   a. Política `listings_select_moderator`: un moderador puede leer
--      TODOS los anuncios (cualquier estado, de cualquier vendedor).
--   b. Política `listings_update_moderator`: un moderador puede
--      actualizar cualquier fila de `listings` (necesaria porque
--      `listings_update_own` solo cubre las propias).
--   c. Función `prevent_unauthorized_listing_status_change()` (mismo
--      patrón TG_OP de 0007/0008): en INSERT, exige que `status` sea
--      'borrador' salvo que quien inserta sea moderador; en UPDATE,
--      bloquea el cambio de `status` salvo que quien actualiza sea
--      moderador.
--   d. Triggers `listings_protect_status_insert` (BEFORE INSERT) y
--      `listings_protect_status_update` (BEFORE UPDATE) sobre
--      `public.listings`. El trigger BEFORE UPDATE coexiste con
--      `listings_set_updated_at` (T-04) y
--      `listings_require_min_photos_to_publish` (T-10, 0009): los tres
--      son independientes (cada uno chequea/toca algo distinto) y deben
--      pasar todos para que el UPDATE tenga éxito.

-- =========================================================================
-- a. listings: lectura de TODOS los anuncios por parte de un moderador.
--
-- Se combina por OR con `listings_select_own` y `listings_select_published`
-- (0002_rls_policies.sql): un vendedor sigue viendo sus propios anuncios
-- en cualquier estado, cualquiera ve los publicados, y además un
-- moderador ve todos los anuncios sin importar su estado o dueño.
-- =========================================================================
create policy "listings_select_moderator"
  on public.listings
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
-- b. listings: actualización de CUALQUIER fila por parte de un moderador.
--
-- NOTA: esta política no restringe qué columnas puede modificar el
-- moderador (RLS aplica a nivel de fila, no de columna); es una
-- limitación conocida, igual que `sellers_update_moderator` (0006). La UI
-- (app/moderador/anuncios/actions.ts) solo debe enviar cambios a
-- `status`, y la Server Action vuelve a verificar en servidor que quien
-- ejecuta la acción es moderador antes de aplicar el cambio.
-- =========================================================================
create policy "listings_update_moderator"
  on public.listings
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
-- c. + d. Trigger: solo un moderador puede cambiar `listings.status`.
--
-- Reutiliza el patrón de `prevent_unauthorized_verification_status_change`
-- (0007/0008_protect_verification_status*.sql), con TG_OP branching:
--   - INSERT: si `new.status <> 'borrador'` y quien inserta NO es
--     moderador, se rechaza. Esto asegura que un anuncio nuevo SIEMPRE se
--     crea en "Borrador" (T-09 nunca envía `status` explícito, así que
--     usa el default de la tabla), salvo que sea un moderador quien
--     inserte (caso raro, pero deja flexibilidad futura, igual que 0008
--     con `sellers.verification_status`).
--   - UPDATE: si `new.status is distinct from old.status` y quien
--     actualiza NO es moderador, se rechaza.
-- =========================================================================
create or replace function public.prevent_unauthorized_listing_status_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'borrador' and not exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'moderador'
    ) then
      raise exception 'Un anuncio nuevo solo puede crearse en estado borrador.';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if not exists (
        select 1
        from public.profiles
        where id = auth.uid()
          and role = 'moderador'
      ) then
        raise exception 'Solo un moderador puede cambiar el estado del anuncio.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger listings_protect_status_insert
  before insert on public.listings
  for each row
  execute function public.prevent_unauthorized_listing_status_change();

create trigger listings_protect_status_update
  before update on public.listings
  for each row
  execute function public.prevent_unauthorized_listing_status_change();
