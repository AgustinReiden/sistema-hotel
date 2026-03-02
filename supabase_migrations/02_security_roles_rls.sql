-- Fase de seguridad: roles y politicas RLS por perfil.

begin;

-- Backfill de perfiles para usuarios existentes.
insert into public.profiles (id, role, full_name)
select
  u.id,
  'client'::public.user_role,
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1), 'User')
from auth.users as u
left join public.profiles as p on p.id = u.id
where p.id is null;

create or replace function public.app_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'receptionist')
  );
$$;

create or replace function public.app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.app_is_staff() from public;
revoke all on function public.app_is_admin() from public;
grant execute on function public.app_is_staff() to authenticated;
grant execute on function public.app_is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.hotel_settings enable row level security;
alter table public.rooms enable row level security;
alter table public.reservations enable row level security;
alter table public.extra_charges enable row level security;

-- Limpieza de politicas anteriores.
drop policy if exists "Auth read profiles" on public.profiles;
drop policy if exists "Auth read hotel_settings" on public.hotel_settings;
drop policy if exists "Auth read rooms" on public.rooms;
drop policy if exists "Auth read reservations" on public.reservations;
drop policy if exists "Auth read extra_charges" on public.extra_charges;
drop policy if exists "Auth insert reservations" on public.reservations;
drop policy if exists "Auth update reservations" on public.reservations;
drop policy if exists "Auth update rooms" on public.rooms;
drop policy if exists "Auth insert extra_charges" on public.extra_charges;

drop policy if exists "Users can read own profile or staff can read all" on public.profiles;
drop policy if exists "Staff can read hotel settings" on public.hotel_settings;
drop policy if exists "Admin can update hotel settings" on public.hotel_settings;
drop policy if exists "Staff can read rooms" on public.rooms;
drop policy if exists "Staff can update rooms" on public.rooms;
drop policy if exists "Staff can read reservations" on public.reservations;
drop policy if exists "Staff can insert reservations" on public.reservations;
drop policy if exists "Staff can update reservations" on public.reservations;
drop policy if exists "Staff can read extra charges" on public.extra_charges;
drop policy if exists "Staff can insert extra charges" on public.extra_charges;

create policy "Users can read own profile or staff can read all"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.app_is_staff());

create policy "Staff can read hotel settings"
on public.hotel_settings
for select
to authenticated
using (public.app_is_staff());

create policy "Admin can update hotel settings"
on public.hotel_settings
for update
to authenticated
using (public.app_is_admin())
with check (public.app_is_admin());

create policy "Staff can read rooms"
on public.rooms
for select
to authenticated
using (public.app_is_staff());

create policy "Staff can update rooms"
on public.rooms
for update
to authenticated
using (public.app_is_staff())
with check (public.app_is_staff());

create policy "Staff can read reservations"
on public.reservations
for select
to authenticated
using (public.app_is_staff());

create policy "Staff can insert reservations"
on public.reservations
for insert
to authenticated
with check (public.app_is_staff());

create policy "Staff can update reservations"
on public.reservations
for update
to authenticated
using (public.app_is_staff())
with check (public.app_is_staff());

create policy "Staff can read extra charges"
on public.extra_charges
for select
to authenticated
using (public.app_is_staff());

create policy "Staff can insert extra charges"
on public.extra_charges
for insert
to authenticated
with check (public.app_is_staff());

commit;
