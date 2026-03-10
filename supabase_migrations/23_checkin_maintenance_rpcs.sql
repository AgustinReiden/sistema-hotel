-- Migration 23: Staff check-in RPC and maintenance room status action

begin;

-- Allow staff to perform a formal check-in for a confirmed reservation
create or replace function public.rpc_staff_checkin_reservation(
  p_reservation_id uuid
)
returns void
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

  if v_status not in ('pending', 'confirmed') then
    raise exception 'Solo se puede hacer check-in de reservas pendientes o confirmadas.'
      using errcode = '22023';
  end if;

  update public.reservations
  set status = 'checked_in',
      actual_check_in = v_now,
      updated_at = v_now
  where id = p_reservation_id;

  update public.rooms
  set status = 'occupied'
  where id = v_room_id;
end;
$$;

-- Allow staff to set a room to maintenance status
create or replace function public.rpc_set_room_maintenance(
  p_room_id int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rooms
  set status = 'maintenance'
  where id = p_room_id;
end;
$$;

revoke all on function public.rpc_staff_checkin_reservation(uuid) from public;
revoke all on function public.rpc_set_room_maintenance(int) from public;

grant execute on function public.rpc_staff_checkin_reservation(uuid) to authenticated;
grant execute on function public.rpc_set_room_maintenance(int) to authenticated;

commit;
