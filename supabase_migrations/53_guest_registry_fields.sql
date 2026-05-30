-- Migration 53: Campos del registro de huespedes (libro de pasajeros) en reservations
--
-- El "Registro de Huespedes" del hotel toma datos del pasajero que el sistema no
-- guardaba. Se agregan columnas OPCIONALES (nullable) a reservations para poder
-- registrarlos al crear la reserva/walk-in y para importar el libro historico.
-- No rompen nada existente (todas nullable, sin default obligatorio).

BEGIN;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS guest_profession  text,
  ADD COLUMN IF NOT EXISTS guest_address     text,
  ADD COLUMN IF NOT EXISTS guest_locality    text,
  ADD COLUMN IF NOT EXISTS guest_nationality text,
  ADD COLUMN IF NOT EXISTS guest_doc_type    text,
  ADD COLUMN IF NOT EXISTS guest_birth_date  date,
  ADD COLUMN IF NOT EXISTS guest_vehicle     text;

COMMIT;
