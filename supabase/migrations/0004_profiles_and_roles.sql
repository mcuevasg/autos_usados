-- T-05: Registro de usuarios con roles.
--
-- Objetivo (criterio de aceptación de T-05): un usuario puede registrarse
-- e iniciar sesión vía Supabase Auth, y queda asociado a uno de los
-- roles: comprador, vendedor, moderador.
--
-- Decisión de diseño: el rol se guarda en `public.profiles` (no solo en
-- el lado del cliente), y se crea automáticamente vía trigger en
-- `auth.users` con role='comprador' por defecto. El cambio a
-- 'vendedor' se hará en T-07 mediante lógica de servidor (service_role);
-- el cambio a 'moderador' es manual/administrativo (vía SQL Editor o
-- service_role), no hay política de update para 'authenticated' sobre
-- esta tabla.

-- =========================================================================
-- profiles: perfil mínimo de cada usuario de auth.users, con su rol.
-- =========================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'comprador'
    check (role in ('comprador', 'vendedor', 'moderador')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Perfil de cada usuario (auth.users) con su rol: comprador, vendedor o moderador.';
comment on column public.profiles.role is 'Rol del usuario. Por defecto ''comprador'' al registrarse (trigger handle_new_user). El paso a ''vendedor'' se hace en T-07 (lógica de servidor) y a ''moderador'' es manual, ambos vía service_role: no hay política de update para authenticated.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- =========================================================================
-- Trigger en auth.users: crea automáticamente la fila en public.profiles
-- al registrarse un nuevo usuario (patrón estándar de Supabase). Usa
-- security definer porque auth.users no es accesible directamente para
-- el rol que ejecuta el insert en un contexto normal.
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'comprador')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- =========================================================================
-- RLS: cada usuario puede leer únicamente su propia fila. Sin política de
-- insert/update/delete para 'authenticated': la fila se crea solo vía el
-- trigger (security definer) y el rol se cambia solo vía service_role
-- (T-07 para 'vendedor', manual para 'moderador').
-- =========================================================================
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);
