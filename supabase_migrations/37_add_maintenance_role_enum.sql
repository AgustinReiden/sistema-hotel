-- Migration 37: Agregar el valor 'maintenance' al enum user_role.
--
-- Se separa de la migración 38 porque Postgres no permite usar un valor
-- recién agregado a un enum en la misma transacción.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'maintenance';
