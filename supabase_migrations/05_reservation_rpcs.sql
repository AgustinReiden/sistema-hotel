-- Fase transaccional: RPCs atomicas para reservas.

begin;

create or replace function public.rpc_create_reservation(
  p_room_id int,
  p_client_name text,
  p_check_in timestamptz,
  p_check_out timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_status public.reservation_status := 'pending';
  v_reservation_id uuid;
  v_client_name text;
begin
  v_client_name := nullif(btrim(p_client_name), '');

  if v_client_name is null then
    raise exception 'El nombre del huesped es obligatorio.'
      using errcode = '22023';
  end if;

  if p_check_out <= p_check_in then
    raise exception 'La fecha de salida debe ser posterior a la fecha de entrada.'
      using errcode = '22023';
  end if;

  if p_check_in <= v_now and p_check_out > v_now then
    v_status := 'checked_in';
  end if;

  insert into public.reservations (
    room_id,
    client_name,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    updated_at
  )
  values (
    p_room_id,
    v_client_name,
    v_status,
    p_check_in,
    case when v_status = 'checked_in' then v_now else null end,
    p_check_out,
    v_now
  )
  returning id into v_reservation_id;

  if v_status = 'checked_in' then
    update public.rooms
    set status = 'occupied'
    where id = p_room_id;
  end if;

  return v_reservation_id;
exception
  when exclusion_violation then
    raise exception 'La habitacion no esta disponible para ese rango horario.'
      using errcode = '23P01';
end;
$$;

create or replace function public.rpc_assign_walk_in(
  p_room_id int,
  p_client_name text,
  p_nights int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_checkout_time time := '10:00'::time;
  v_checkout_target timestamptz;
  v_reservation_id uuid;
  v_client_name text;
begin
  v_client_name := nullif(btrim(p_client_name), '');

  if v_client_name is null then
    raise exception 'El nombre del huesped es obligatorio.'
      using errcode = '22023';
  end if;

  if p_nights is null or p_nights < 1 or p_nights > 30 then
    raise exception 'La cantidad de noches debe estar entre 1 y 30.'
      using errcode = '22023';
  end if;

  select standard_check_out_time
  into v_checkout_time
  from public.hotel_settings
  order by id
  limit 1;

  v_checkout_target := ((((v_now at time zone 'UTC')::date + p_nights) + v_checkout_time) at time zone 'UTC');

  insert into public.reservations (
    room_id,
    client_name,
    status,
    check_in_target,
    actual_check_in,
    check_out_target,
    updated_at
  )
  values (
    p_room_id,
    v_client_name,
    'checked_in',
    v_now,
    v_now,
    v_checkout_target,
    v_now
  )
  returning id into v_reservation_id;

  update public.rooms
  set status = 'occupied'
  where id = p_room_id;

  return v_reservation_id;
exception
  when exclusion_violation then
    raise exception 'La habitacion no esta disponible para ese rango horario.'
      using errcode = '23P01';
end;
$$;

create or replace function public.rpc_checkout_reservation(
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_room_id int;
  v_status public.reservation_status;
begin
  select room_id, status
  into v_room_id, v_status
  from public.reservations
  where id = p_reservation_id
  for update;

  if v_room_id is null then
    raise exception 'Reserva no encontrada.'
      using errcode = 'P0002';
  end if;

  if v_status <> 'checked_in' then
    raise exception 'Solo se pueden cerrar reservas en estado checked_in.'
      using errcode = '22023';
  end if;

  update public.reservations
  set status = 'checked_out',
      actual_check_out = v_now,
      updated_at = v_now
  where id = p_reservation_id;

  update public.rooms
  set status = 'cleaning'
  where id = v_room_id;

  return jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'status', 'checked_out',
    'actual_check_out', v_now
  );
end;
$$;

create or replace function public.rpc_apply_late_checkout(
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_room_id int;
  v_status public.reservation_status;
  v_current_checkout timestamptz;
  v_new_checkout timestamptz;
  v_late_time time := '18:00'::time;
  v_half_day_price numeric(10, 2) := 0;
  v_inserted_rows int := 0;
begin
  select r.room_id, r.status, r.check_out_target, coalesce(ro.half_day_price, 0)
  into v_room_id, v_status, v_current_checkout, v_half_day_price
  from public.reservations r
  join public.rooms ro on ro.id = r.room_id
  where r.id = p_reservation_id
  for update;

  if v_room_id is null then
    raise exception 'Reserva no encontrada.'
      using errcode = 'P0002';
  end if;

  if v_status <> 'checked_in' then
    raise exception 'Solo se puede aplicar medio dia sobre reservas checked_in.'
      using errcode = '22023';
  end if;

  select late_check_out_time
  into v_late_time
  from public.hotel_settings
  order by id
  limit 1;

  v_new_checkout := ((((v_current_checkout at time zone 'UTC')::date) + v_late_time) at time zone 'UTC');
  if v_new_checkout < v_current_checkout then
    v_new_checkout := v_current_checkout;
  end if;

  update public.reservations
  set check_out_target = v_new_checkout,
      updated_at = v_now
  where id = p_reservation_id;

  if v_half_day_price > 0 then
    insert into public.extra_charges (
      reservation_id,
      charge_type,
      amount,
      description
    )
    values (
      p_reservation_id,
      'half_day',
      v_half_day_price,
      'Penalizacion por Check-out tardio (Medio Dia)'
    )
    on conflict (reservation_id, charge_type)
    do nothing;

    get diagnostics v_inserted_rows = row_count;
  end if;

  return jsonb_build_object(
    'reservation_id', p_reservation_id,
    'room_id', v_room_id,
    'check_out_target', v_new_checkout,
    'half_day_amount', v_half_day_price,
    'half_day_charged', (v_inserted_rows > 0)
  );
exception
  when exclusion_violation then
    raise exception 'No se puede extender la reserva porque colisiona con otra reserva activa.'
      using errcode = '23P01';
end;
$$;

revoke all on function public.rpc_create_reservation(int, text, timestamptz, timestamptz) from public;
revoke all on function public.rpc_assign_walk_in(int, text, int) from public;
revoke all on function public.rpc_checkout_reservation(uuid) from public;
revoke all on function public.rpc_apply_late_checkout(uuid) from public;

grant execute on function public.rpc_create_reservation(int, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.rpc_assign_walk_in(int, text, int) to authenticated;
grant execute on function public.rpc_checkout_reservation(uuid) to authenticated;
grant execute on function public.rpc_apply_late_checkout(uuid) to authenticated;

commit;
