-- T-08 (fix): la política "sellers_insert_own" (T-04, 0002) solo exige
-- auth.uid() = user_id en el WITH CHECK, sin restringir
-- verification_status. El trigger de 0007 es BEFORE UPDATE, no BEFORE
-- INSERT, así que no protege la creación de la fila: cualquier usuario
-- autenticado podría insertar su propia fila de sellers directamente
-- contra la API de Supabase con verification_status = 'verificado',
-- evadiendo al moderador por completo (aunque la app siempre envíe
-- 'pendiente' al insertar).
--
-- Se reescribe la función existente prevent_unauthorized_verification_
-- status_change() para que maneje tanto INSERT como UPDATE según TG_OP,
-- y se agrega un nuevo trigger BEFORE INSERT que la reutiliza. El
-- trigger BEFORE UPDATE de 0007 (sellers_protect_verification_status)
-- sigue funcionando igual, sin necesidad de recrearlo.

create or replace function public.prevent_unauthorized_verification_status_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.verification_status <> 'pendiente' and not exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'moderador'
    ) then
      raise exception 'Un vendedor solo puede registrarse con verification_status = pendiente.';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.verification_status is distinct from old.verification_status then
      if not exists (
        select 1
        from public.profiles
        where id = auth.uid()
          and role = 'moderador'
      ) then
        raise exception 'Solo un moderador puede cambiar verification_status.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger sellers_protect_verification_status_insert
  before insert on public.sellers
  for each row
  execute function public.prevent_unauthorized_verification_status_change();
