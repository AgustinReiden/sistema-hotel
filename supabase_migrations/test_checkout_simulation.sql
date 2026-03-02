-- Script to insert a test reservation checking out today
-- You can run this directly in the Supabase SQL editor.

BEGIN;

-- Insert a fake walk-in reservation that checked in yesterday and is SUPPOSED to check out TODAY.
-- We are forcing it into room ID 1. If room 1 doesn't exist, change the room_id.
INSERT INTO public.reservations (
    client_name, 
    check_in_target, 
    check_out_target, 
    room_id, 
    status, 
    actual_check_in, 
    total_price, 
    paid_amount
)
VALUES (
    'Test CheckOut Hoy',
    current_date - interval '1 day',
    current_date,
    1, 
    'checked_in',
    current_date - interval '1 day',
    50000,
    0
);

COMMIT;
