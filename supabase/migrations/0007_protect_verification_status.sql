-- T-08 (fix): un vendedor no debe poder auto-verificarse cambiando
-- verification_status directamente, aunque sellers_update_own (T-04) le
-- permita actualizar su propia fila. RLS no puede restringir columnas
-- específicas dentro de una policy, así que se usa un trigger para
-- bloquear el cambio de verification_status salvo que quien ejecuta el
-- UPDATE sea un moderador (public.profiles.role = 'moderador').

create or replace function public.prevent_unauthorized_verification_status_change()
returns trigger
language plpgsql
as $$
begin
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
  return new;
end;
$$;

create trigger sellers_protect_verification_status
  before update on public.sellers
  for each row
  execute function public.prevent_unauthorized_verification_status_change();
