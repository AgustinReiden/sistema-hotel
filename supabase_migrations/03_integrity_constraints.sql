-- Fase de integridad: constraints de dominio y anti-colision en reservas.

begin;

create extension if not exists btree_gist;

-- Eliminamos duplicados de medio dia para permitir el indice unico idempotente.
with ranked as (
  select
    id,
    row_number() over (
      partition by reservation_id, charge_type
      order by created_at asc, id asc
    ) as rn
  from public.extra_charges
  where charge_type = 'half_day'
)
delete from public.extra_charges as ec
using ranked
where ec.id = ranked.id
  and ranked.rn > 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_check_out_after_check_in'
  ) then
    alter table public.reservations
      add constraint reservations_check_out_after_check_in
      check (check_out_target > check_in_target);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_base_price_non_negative'
  ) then
    alter table public.rooms
      add constraint rooms_base_price_non_negative
      check (base_price_per_night >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_half_day_price_non_negative'
  ) then
    alter table public.rooms
      add constraint rooms_half_day_price_non_negative
      check (half_day_price >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_total_price_non_negative'
  ) then
    alter table public.reservations
      add constraint reservations_total_price_non_negative
      check (total_price >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_amount_paid_non_negative'
  ) then
    alter table public.reservations
      add constraint reservations_amount_paid_non_negative
      check (amount_paid >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'extra_charges_amount_non_negative'
  ) then
    alter table public.extra_charges
      add constraint extra_charges_amount_non_negative
      check (amount >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_no_active_overlap'
  ) then
    alter table public.reservations
      add constraint reservations_no_active_overlap
      exclude using gist (
        room_id with =,
        tstzrange(check_in_target, check_out_target, '[)') with &&
      )
      where (status in ('pending', 'confirmed', 'checked_in'));
  end if;
end $$;

create unique index if not exists extra_charges_one_half_day_per_reservation
  on public.extra_charges (reservation_id, charge_type)
  where charge_type = 'half_day';

commit;
