-- Migration 91: registro de migraciones aplicadas
--
-- El problema: `supabase_migrations.schema_migrations` (la tabla del CLI de Supabase)
-- quedo congelada en la migracion 42. De la 43 en adelante todo se aplica a mano con
-- `select public.exec_ddl('...')` y no queda registro. No hay forma de saber, desde la
-- base, que migraciones estan vivas. Hoy funciona porque lo lleva una sola persona;
-- el dia que haya que reconstruir la base o entre alguien mas, no hay de donde agarrarse.
--
-- Y no es teorico: armando este registro aparecieron tres funciones creadas directo
-- contra PROD que no estan en ningun commit (ver migracion 90), una de las cuales
-- dejaba /admin/fiscal/consolidada rota en produccion.
--
-- Esta migracion crea el registro y lo rellena con el estado REAL, verificado el
-- 2026-09-08 cruzando cada archivo contra el catalogo de la base (pg_proc, pg_class,
-- pg_constraint, pg_policies, information_schema): de 402 objetos declarados por las
-- 90 migraciones, 394 estan presentes y los 8 ausentes se explican por renombres y
-- reemplazos posteriores (anotados fila por fila en `notes`).
--
-- Convencion de aca en mas: TODA migracion nueva termina con
--
--     SELECT public.record_migration('NN_nombre.sql');
--
-- Ver supabase_migrations/README.md.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) El registro
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.applied_migrations (
  -- Nombre exacto del archivo en supabase_migrations/. Es la clave porque la
  -- numeracion sola no alcanza: hay dos archivos que empiezan con "59_".
  filename    text PRIMARY KEY,
  -- Cuando se aplico de verdad. NULL = no se sabe (filas del backfill inicial).
  applied_at  timestamptz,
  -- Cuando se anoto en el registro. Nunca NULL: siempre sabemos esto.
  recorded_at timestamptz NOT NULL DEFAULT now(),
  applied_by  text NOT NULL DEFAULT current_user,
  source      text NOT NULL CHECK (source IN ('migracion', 'backfill')),
  notes       text
);

COMMENT ON TABLE public.applied_migrations IS
  'Que migraciones de supabase_migrations/ estan aplicadas en esta base. Se llena con public.record_migration().';
COMMENT ON COLUMN public.applied_migrations.applied_at IS
  'Fecha real de aplicacion. NULL en las filas del backfill inicial: se verifico que estan aplicadas, pero no cuando.';
COMMENT ON COLUMN public.applied_migrations.source IS
  'migracion = se anoto al aplicarla. backfill = se dedujo del estado de la base el 2026-09-08.';

ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY;

-- Solo lectura, y solo para el admin: es metadata de infraestructura. Las escrituras
-- van unicamente por record_migration() (SECURITY DEFINER), nunca directo.
DROP POLICY IF EXISTS "Admin can read applied migrations" ON public.applied_migrations;
CREATE POLICY "Admin can read applied migrations" ON public.applied_migrations
  FOR SELECT TO authenticated USING (public.app_is_admin());

REVOKE ALL ON TABLE public.applied_migrations FROM PUBLIC;
GRANT SELECT ON TABLE public.applied_migrations TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Como se anota una migracion
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_migration(
  p_filename text,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_file text := NULLIF(BTRIM(p_filename), '');
BEGIN
  IF v_file IS NULL THEN
    RAISE EXCEPTION 'Indica el nombre del archivo de migracion.' USING errcode = '22023';
  END IF;

  -- Idempotente: re-aplicar una migracion no duplica ni pisa la fecha original.
  INSERT INTO public.applied_migrations (filename, applied_at, source, notes)
  VALUES (v_file, now(), 'migracion', NULLIF(BTRIM(p_notes), ''))
  ON CONFLICT (filename) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_migration(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_migration(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Backfill del estado verificado el 2026-09-08
-- ---------------------------------------------------------------------------
INSERT INTO public.applied_migrations (filename, applied_at, source, notes) VALUES
  ('01_financial_rpc.sql', NULL, 'backfill', NULL),
  ('02_security_roles_rls.sql', NULL, 'backfill', NULL),
  ('03_integrity_constraints.sql', NULL, 'backfill',
   'Parcialmente vigente: rooms_base_price_non_negative y reservations_amount_paid_non_negative cayeron con el renombre de sus columnas (base_price_per_night -> base_price, amount_paid -> paid_amount). El resto de sus constraints esta vivo.'),
  ('04_indexes.sql', NULL, 'backfill', NULL),
  ('05_reservation_rpcs.sql', NULL, 'backfill',
   'Superada: sus 4 RPCs se renombraron a rpc_staff_* en migraciones posteriores.'),
  ('06_financial_rpc_hardening.sql', NULL, 'backfill', NULL),
  ('07_enrich_rooms_table.sql', NULL, 'backfill', NULL),
  ('08_enrich_hotel_settings.sql', NULL, 'backfill', NULL),
  ('09_finance_module.sql', NULL, 'backfill', NULL),
  ('10_payment_methods.sql', NULL, 'backfill', NULL),
  ('11_security_lockdown.sql', NULL, 'backfill', NULL),
  ('12_financial_fixes.sql', NULL, 'backfill', NULL),
  ('13_schema_unification.sql', NULL, 'backfill',
   'Sin objetos nuevos; verificada porque reservations.amount_paid ya no existe.'),
  ('14_dynamic_images.sql', NULL, 'backfill', NULL),
  ('15_services_image.sql', NULL, 'backfill', NULL),
  ('16_fix_reservation_price.sql', NULL, 'backfill', NULL),
  ('17_room_management_rls.sql', NULL, 'backfill', NULL),
  ('18_settings_instagram_logo.sql', NULL, 'backfill', NULL),
  ('19_auto_create_profiles.sql', NULL, 'backfill', NULL),
  ('20_fix_profile_rls.sql', NULL, 'backfill', NULL),
  ('21_timezone_fix.sql', NULL, 'backfill', NULL),
  ('22_reservation_requests.sql', NULL, 'backfill', NULL),
  ('23_checkin_maintenance_rpcs.sql', NULL, 'backfill', NULL),
  ('24_calendar_checkout_cancellation.sql', NULL, 'backfill', NULL),
  ('25_associated_clients.sql', NULL, 'backfill', NULL),
  ('26_room_categories.sql', NULL, 'backfill', NULL),
  ('27_cash_shifts.sql', NULL, 'backfill',
   'Superada en parte: el indice cash_shifts_one_open_per_user lo reemplazo cash_shifts_one_open_hotel (mig 59).'),
  ('28_extras_and_change_room.sql', NULL, 'backfill', NULL),
  ('29_edit_reservation.sql', NULL, 'backfill', NULL),
  ('30_fix_timezone_extra_income.sql', NULL, 'backfill', NULL),
  ('31_timezone_hardening.sql', NULL, 'backfill', NULL),
  ('32_cash_shifts_rbac.sql', NULL, 'backfill', NULL),
  ('33_allow_cancel_checked_out.sql', NULL, 'backfill', NULL),
  ('34_reservation_guest_count.sql', NULL, 'backfill', NULL),
  ('35_profile_admin_update.sql', NULL, 'backfill', NULL),
  ('36_public_create_reservation_guest_count.sql', NULL, 'backfill', NULL),
  ('37_add_maintenance_role_enum.sql', NULL, 'backfill', NULL),
  ('38_maintenance_cleaning_infra.sql', NULL, 'backfill', NULL),
  ('39_checkin_room_status_guard.sql', NULL, 'backfill', NULL),
  ('40_close_public_read_leaks.sql', NULL, 'backfill', NULL),
  ('41_reservation_fixes_and_alerts.sql', NULL, 'backfill', NULL),
  ('42_payment_id_in_rpc_returns.sql', NULL, 'backfill', NULL),
  ('43_cash_shift_numbering.sql', NULL, 'backfill', NULL),
  ('44_maintenance_daily_cleaning_and_late_checkout.sql', NULL, 'backfill', NULL),
  ('45_hotel_contact_phone_fields.sql', NULL, 'backfill', NULL),
  ('46_contact_cleaning_cash_updates.sql', NULL, 'backfill', NULL),
  ('47_confirmation_message_template.sql', NULL, 'backfill', NULL),
  ('48_security_critical_lockdown.sql', NULL, 'backfill', NULL),
  ('49_hardening.sql', NULL, 'backfill', NULL),
  ('50_walkin_siesta_and_guest.sql', NULL, 'backfill', NULL),
  ('51_reservation_guest_notes.sql', NULL, 'backfill', NULL),
  ('52_edit_reservation_admin_only.sql', NULL, 'backfill', NULL),
  ('53_guest_registry_fields.sql', NULL, 'backfill', NULL),
  ('54_walkin_create_registry_fields.sql', NULL, 'backfill', NULL),
  ('55_payment_uses_active_open_shift.sql', NULL, 'backfill', NULL),
  ('56_fix_late_checkout_onconflict.sql', NULL, 'backfill', NULL),
  ('57_guest_first_last_name.sql', NULL, 'backfill', NULL),
  ('58_guests_directory_table.sql', NULL, 'backfill', NULL),
  ('59_guest_spine_reservation.sql', NULL, 'backfill',
   'OJO: numero 59 duplicado con 59_single_hotel_cash_shift_and_checkout_pieces.sql.'),
  ('59_single_hotel_cash_shift_and_checkout_pieces.sql', NULL, 'backfill',
   'OJO: numero 59 duplicado con 59_guest_spine_reservation.sql.'),
  ('60_guest_spine_walk_in.sql', NULL, 'backfill', NULL),
  ('61_company_passengers.sql', NULL, 'backfill', NULL),
  ('62_walkin_person_company_fork.sql', NULL, 'backfill', NULL),
  ('63_associated_clients_delete_policy.sql', NULL, 'backfill', NULL),
  ('64_cuenta_corriente.sql', NULL, 'backfill', NULL),
  ('65_early_checkout.sql', NULL, 'backfill', NULL),
  ('66_restore_checkout_pieces.sql', NULL, 'backfill', NULL),
  ('67_daily_cleaning_categories_and_fiscal_export.sql', NULL, 'backfill', NULL),
  ('68_one_cleaning_per_day_for_non_required.sql', NULL, 'backfill', NULL),
  ('69_room_change_repricing_and_tariff_auth.sql', NULL, 'backfill', NULL),
  ('70_receptionist_edit_before_checkin.sql', NULL, 'backfill', NULL),
  ('71_shift_close_guard_bi_and_fixes.sql', NULL, 'backfill', NULL),
  ('72_arca_facturacion_electronica.sql', NULL, 'backfill', NULL),
  ('73_arca_fixes_dni_discard.sql', NULL, 'backfill', NULL),
  ('74_arca_factura_a.sql', NULL, 'backfill', NULL),
  ('75_arca_exento_y_leyendas.sql', NULL, 'backfill', NULL),
  ('76_reservation_writes_via_rpc.sql', NULL, 'backfill', NULL),
  ('77_lockdown_direct_table_writes.sql', NULL, 'backfill',
   'Sin objetos nuevos; verificada porque reservations/payments/cash_shifts solo tienen politica SELECT.'),
  ('78_medium_fixes_fiscal_overpayment_shiftguard.sql', NULL, 'backfill', NULL),
  ('79_facturacion_cuenta_corriente.sql', NULL, 'backfill',
   'Superada en parte: rpc_list_cc_charges_to_invoice fue reemplazada por rpc_list_cc_account_stays (ver mig 90).'),
  ('80_nota_credito_y_decision_facturacion.sql', NULL, 'backfill',
   'Superada en parte: rpc_list_cc_charges_to_invoice fue reemplazada por rpc_list_cc_account_stays (ver mig 90).'),
  ('81_datos_fiscales_huesped.sql', NULL, 'backfill', NULL),
  ('82_facturacion_externa_y_control.sql', NULL, 'backfill', NULL),
  ('83_facturacion_obligatoria_bancaria.sql', NULL, 'backfill', NULL),
  ('84_cerrar_sql_arbitrario_anon.sql', NULL, 'backfill',
   'Sin objetos nuevos; verificada porque run_sql y exec_ddl no tienen EXECUTE para anon.'),
  ('85_default_privileges_sin_anon.sql', NULL, 'backfill',
   'Sin objetos nuevos; verificada por pg_default_acl: las funciones nuevas de public no otorgan EXECUTE a anon.'),
  ('86_revocar_anon_de_rpc_de_staff.sql', NULL, 'backfill',
   'Sin objetos nuevos; verificada porque las RPC de staff solo dan EXECUTE a authenticated y service_role.'),
  ('87_checkin_llegada_atrasada.sql', NULL, 'backfill', NULL),
  ('88_reserva_empresa_sin_pasajero.sql', NULL, 'backfill', NULL),
  ('89_pago_cta_cte_solo_por_checkout.sql', timestamptz '2026-09-08 12:00:00-03', 'migracion',
   'Aplicada en esta sesion via exec_ddl, en 3 pasos verificados.')
ON CONFLICT (filename) DO NOTHING;

SELECT public.record_migration('90_captura_drift_facturacion_cta_cte.sql');
SELECT public.record_migration('91_registro_de_migraciones.sql');

COMMIT;
