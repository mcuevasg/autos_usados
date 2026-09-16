-- T-17 (fix de reviewer): cierre del gap de INSERT sobre el plan destacado.
--
-- Hallazgo BLOQUEANTE: el trigger `listings_protect_featured_activation`
-- (0015_featured_listings.sql) solo se registró `before update`, nunca
-- `before insert`. La política `listings_insert_own`
-- (0006_moderator_seller_review.sql) no restringe `featured_active` ni
-- `featured_expires_at` en el INSERT, así que CUALQUIER vendedor (incluida
-- una persona_natural) podía, llamando directamente a la API REST de
-- Supabase, insertar un listing nuevo ya con `featured_active: true` y
-- `featured_expires_at` en cualquier fecha arbitraria, bypaseando por
-- completo las validaciones de T-17 (0015): el trigger de 0015 nunca corría
-- en el camino de creación de un anuncio, solo en su actualización. Mismo
-- patrón de gap ya visto y corregido para `status` en T-12 (0010,
-- `listings_protect_status_insert` / `listings_protect_status_update` sobre
-- `prevent_unauthorized_listing_status_change`).
--
-- Fix: hoy no existe ningún flujo legítimo en la app donde un listing nazca
-- ya con el plan destacado activo (T-09, 0009 y siguientes, siempre inserta
-- listings con los defaults de la tabla —`featured_active = false`,
-- `featured_expires_at = null`—, sin enviar estas columnas). Por eso no
-- hace falta replicar en el INSERT las validaciones de seller_type/status
-- que sí aplican en el UPDATE: basta con neutralizar cualquier intento de
-- nacer ya destacado, sin importar qué envíe el cliente, en vez de solo
-- rechazar el insert con una excepción.
--
-- Esta migración:
--   a. Reescribe (`create or replace function`) la función
--      `prevent_unauthorized_featured_activation()` (0015) para manejar
--      ambos TG_OP:
--        - INSERT: fuerza siempre `new.featured_active := false` y
--          `new.featured_expires_at := null`, cualquiera sea el valor
--          enviado por el cliente.
--        - UPDATE: sin cambios de comportamiento respecto a 0015 (mismas
--          validaciones de seller_type = 'concesionario', status =
--          'publicado', y la misma sobreescritura de
--          `featured_expires_at` a `now() + interval '30 days'`).
--   b. Crea el trigger nuevo `listings_protect_featured_activation_insert`
--      (BEFORE INSERT) sobre `public.listings`, ejecutando la misma
--      función. El trigger BEFORE UPDATE existente
--      (`listings_protect_featured_activation`, de 0015) sigue funcionando
--      igual porque apunta a la misma función, ya actualizada por este
--      `create or replace`.
--
-- Corrección de documentación (hallazgo no bloqueante sobre 0015): el
-- comentario de 0015 decía "no hay excepción para moderador ... no existe
-- caso de uso [de que un moderador active el destacado]". Ese comentario es
-- engañoso: el trigger de T-17 nunca verificó QUIÉN ejecuta el UPDATE (solo
-- el estado final de la fila vía `new`/`old`), y la política
-- `listings_update_moderator` (0010) ya permite que un moderador actualice
-- CUALQUIER columna de CUALQUIER listing. Por lo tanto, un moderador SÍ
-- puede activar el plan destacado en nombre de un concesionario (sobre un
-- anuncio publicado) sin que este trigger se lo impida — no es que falte
-- una excepción explícita para moderador, es que no hay ninguna
-- restricción en este trigger que distinga moderador de dueño. Esto se
-- considera ACEPTABLE (el moderador es un rol de confianza con acceso de
-- actualización amplio ya aceptado desde T-12, 0010) y no un gap a cerrar
-- en esta migración; no se corrige retroactivamente el comentario de 0015,
-- se deja esta aclaración aquí.
create or replace function public.prevent_unauthorized_featured_activation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Ningún listing puede nacer ya con el plan destacado activo: no hay
    -- flujo legítimo de creación que lo requiera (T-09 siempre inserta con
    -- los defaults de la tabla). Se neutraliza sin importar qué envíe el
    -- cliente, en vez de solo rechazar el insert.
    new.featured_active := false;
    new.featured_expires_at := null;
  elsif tg_op = 'UPDATE' then
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

      new.featured_expires_at := now() + interval '30 days';
    end if;
  end if;

  return new;
end;
$$;

create trigger listings_protect_featured_activation_insert
  before insert on public.listings
  for each row
  execute function public.prevent_unauthorized_featured_activation();
