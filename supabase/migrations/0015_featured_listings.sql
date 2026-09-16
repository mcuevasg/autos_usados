-- T-17: Activación de plan destacado por concesionario.
--
-- Objetivo (criterio de aceptación de T-17, REQ-09): un concesionario
-- puede activar el plan "Destacado" sobre un anuncio propio en estado
-- "Publicado", quedando registrada una fecha de expiración. Decisión de
-- negocio: el plan destacado dura 30 días desde la activación.
--
-- Columnas ya existentes desde T-04 (0001_initial_schema.sql):
-- `listings.featured_active` (boolean, default false) y
-- `listings.featured_expires_at` (timestamptz, nullable). Nunca se habían
-- usado hasta ahora.
--
-- Gap de seguridad que esta migración cierra: `listings_update_own`
-- (0002_rls_policies.sql) permite que el dueño de un anuncio actualice
-- CUALQUIER columna de su propia fila, sin restricción, incluyendo
-- `featured_active` y `featured_expires_at`. Sin esta migración, CUALQUIER
-- vendedor (incluida una persona_natural, para quien el plan destacado no
-- es un beneficio disponible) podría, llamando directamente a la API REST
-- de Supabase, poner `featured_active = true` sobre un anuncio propio en
-- cualquier estado (incluido 'borrador' o 'pausado') y con cualquier fecha
-- de expiración arbitraria — mismo patrón de gap ya visto y corregido en
-- T-08 (0007/0008, `sellers.verification_status`) y T-12 (0010,
-- `listings.status`).
--
-- Esta migración agrega:
--   a. Función `prevent_unauthorized_featured_activation()`: se dispara
--      solo cuando se está ACTIVANDO el plan destacado en este UPDATE
--      (`new.featured_active = true` y
--      `old.featured_active is distinct from new.featured_active`), no en
--      cada UPDATE de la fila. Verifica que:
--        1. El seller dueño del listing (`s.id = new.seller_id`) tenga
--           `seller_type = 'concesionario'` — si no, `raise exception`
--           (una persona_natural nunca puede activar el plan destacado).
--        2. `new.status = 'publicado'` (se usa `new.status`, el valor que
--           tendría la fila tras el UPDATE, no `old.status`, por si en
--           algún caso se activaran ambos cambios en el mismo UPDATE,
--           aunque en la práctica la Server Action de T-17 no cambia
--           `status` al mismo tiempo) — si no, `raise exception`.
--      Y, en vez de solo validar `new.featured_expires_at`, la función lo
--      SOBREESCRIBE siempre a `now() + interval '30 days'`
--      (`new.featured_expires_at := now() + interval '30 days';`). Se
--      prefiere sobreescribir en vez de solo rechazar un valor incorrecto
--      porque así la columna queda SIEMPRE correcta sin importar qué envíe
--      el cliente (la Server Action ya calcula este mismo valor solo para
--      mostrarlo de forma informativa antes de que la fuente de verdad —
--      este trigger — lo confirme), análogo a cómo
--      `listings_require_min_photos_to_publish` (T-10, 0009) y otros
--      triggers del proyecto fuerzan/normalizan columnas específicas en
--      vez de limitarse a validar y rechazar.
--   b. Trigger `listings_protect_featured_activation` (BEFORE UPDATE) en
--      `public.listings`. Coexiste con `listings_set_updated_at` (T-04),
--      `listings_require_min_photos_to_publish` (T-10, 0009) y
--      `listings_protect_status_update` (T-12, 0010): los cuatro son
--      independientes (cada uno chequea/toca algo distinto) y deben pasar
--      todos para que el UPDATE tenga éxito.
--
-- Decisiones explícitas que se documentan:
--
--   - No hay excepción para moderador (a diferencia de
--     `prevent_unauthorized_listing_status_change`, T-12, que sí permite
--     que un moderador cambie `status` libremente). El plan destacado es
--     una función exclusiva del concesionario dueño del anuncio: no existe
--     caso de uso en el que un moderador deba poder activarlo en nombre de
--     un vendedor. Si en el futuro surge ese caso de uso, se puede agregar
--     la excepción de la misma forma que en los triggers de `status`.
--
--   - La DESACTIVACIÓN (`new.featured_active = false`) NO pasa por
--     ninguna de estas validaciones: la condición del trigger exige
--     explícitamente `new.featured_active = true`, así que apagar el plan
--     destacado (manual o, en el futuro, por expiración automática vía
--     job/cron) sigue permitido para el propio dueño sin restricciones
--     adicionales, tal como ya lo permite `listings_update_own`.
--
--   - No se agrega ninguna policy RLS nueva: la única política de UPDATE
--     relevante para el dueño ya existe (`listings_update_own`,
--     0002_rls_policies.sql) y sigue siendo necesaria para que el propio
--     concesionario pueda hacer este UPDATE; el trigger es la pieza que
--     falta para restringir CUÁNDO y CON QUÉ VALORES se puede activar el
--     plan destacado dentro de esa política ya amplia, mismo patrón que
--     T-07/T-08/T-12.

create or replace function public.prevent_unauthorized_featured_activation()
returns trigger
language plpgsql
as $$
begin
  -- Solo interesa el momento en que el plan destacado se está ACTIVANDO
  -- en este UPDATE, no cada UPDATE de la fila (por ejemplo, editar el
  -- precio de un anuncio que ya tiene featured_active = true no debe
  -- pasar por estas validaciones).
  if new.featured_active = true
     and old.featured_active is distinct from new.featured_active then

    if not exists (
      select 1
      from public.sellers s
      where s.id = new.seller_id
        and s.seller_type = 'concesionario'
    ) then
      raise exception
        'Solo un vendedor concesionario puede activar el plan destacado.';
    end if;

    if new.status <> 'publicado' then
      raise exception
        'El plan destacado solo puede activarse sobre un anuncio en estado publicado.';
    end if;

    -- Fuente de verdad de la fecha de expiración: se fuerza aquí, sin
    -- importar qué valor haya enviado el cliente en el UPDATE.
    new.featured_expires_at := now() + interval '30 days';
  end if;

  return new;
end;
$$;

create trigger listings_protect_featured_activation
  before update on public.listings
  for each row
  execute function public.prevent_unauthorized_featured_activation();
