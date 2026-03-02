-- Fase de performance: indices para consultas operativas.

begin;

create index if not exists idx_reservations_room_status_checkin_checkout
  on public.reservations (room_id, status, check_in_target, check_out_target);

create index if not exists idx_reservations_status_checkin_checkout
  on public.reservations (status, check_in_target, check_out_target);

create index if not exists idx_extra_charges_charge_type_created_at
  on public.extra_charges (charge_type, created_at desc);

commit;
