-- Migration 106: quien decide si se cobra una pieza usada sin estadia es el admin,
-- no el recepcionista.
--
-- CORRIGE UNA DECISION DE DISENO DE LA MIG 105. Ahi rpc_regularize_occupied_room
-- quedo con app_is_staff(), con este razonamiento: "el recepcionista puede
-- regularizar (que genera plata) pero no puede hacer desaparecer el aviso". El
-- razonamiento estaba mal. Cargar la estadia NO es solo apretar un boton: implica
-- elegir a nombre de quien se carga, cuantas noches y a que tarifa. Sobre una pieza
-- donde nadie sabe quien durmio, eso es decidir si se cobra y cuanto, y esa decision
-- no es del mostrador.
--
-- NO LE SACA TRABAJO AL RECEPCIONISTA. Si el pasajero SIGUE en la habitacion, no
-- necesita la alerta para nada: hace el walk-in normal desde la tarjeta de la pieza,
-- como cualquier otro dia. La alerta es para el caso en que el uso YA PASO y hay que
-- averiguar que fue, que es cuando conviene que lo mire el administrador.
--
-- EL RECEPCIONISTA SIGUE VIENDO TODO. La ventana de staff no se cierra: la sigue
-- leyendo con app_is_staff(). Al contrario, ahora muestra MAS. Antes devolvia solo
-- lo no resuelto, asi que el aviso desaparecia sin decir en que termino. Ahora
-- arrastra 48 horas de avisos ya resueltos con su desenlace, para que el que esta en
-- el mostrador vea si esa pieza se termino cobrando o no. Ver una decision ajena no
-- es tomarla.
--
-- COMO SE LEE EL DESENLACE: decision = 'regularizada' significa que se cargo la
-- estadia (la sella rpc_regularize_occupied_room). Resuelta sin esa marca significa
-- que un admin la cerro sin cobrar, y desde la mig 105 eso exige escribir el motivo,
-- que viaja en resolved_notes.
--
-- Aplicar a PROD por secciones via select public.exec_ddl($MIG$ ... $MIG$) SIN ; final
-- y SIN BEGIN/COMMIT. Requiere la 105 aplicada.
-- OJO: rpc_list_room_occupancy_alerts cambia su RETURNS TABLE, asi que va
-- DROP + CREATE en UNA SOLA seccion.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) La ventana de staff ahora cuenta tambien como termino cada aviso.
--    DROP + CREATE EN UNA SOLA SECCION (cambia el RETURNS TABLE).
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_list_room_occupancy_alerts();

CREATE FUNCTION public.rpc_list_room_occupancy_alerts()
RETURNS TABLE (
  alert_id bigint,
  room_id integer,
  room_number text,
  message text,
  created_at timestamptz,
  detected_at timestamptz,
  reported_by_name text,
  resolved_at timestamptz,
  decision text,
  resolved_notes text,
  resolved_by_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.app_is_staff() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.related_room_id, r.room_number, a.message, a.created_at,
         -- Cuando la mucama lo vio, que no es cuando alguien lo mira: es la fecha
         -- que hay que precargar en la estadia.
         COALESCE(l.cleaned_at, a.created_at),
         l.cleaner_name,
         a.resolved_at,
         a.decision,
         a.resolved_notes,
         p.full_name
  FROM public.admin_alerts a
  LEFT JOIN public.rooms r ON r.id = a.related_room_id
  LEFT JOIN public.room_cleaning_log l ON l.id = a.related_cleaning_log_id
  LEFT JOIN public.profiles p ON p.id = a.resolved_by
  WHERE a.kind = 'room_occupied_without_active_reservation'
    -- Lo abierto siempre; lo cerrado solo por 48 horas. Sin ese corte, el historial
    -- entero se le apila en la pantalla principal al que entra a trabajar.
    AND (a.resolved_at IS NULL OR a.resolved_at > NOW() - INTERVAL '48 hours')
  ORDER BY a.resolved_at NULLS FIRST, a.created_at DESC
  LIMIT 50;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_list_room_occupancy_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_list_room_occupancy_alerts() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Cargar la estadia para cerrar el aviso pasa a ser del admin.
-- ─────────────────────────────────────────────────────────────────────────────
-- Unico cambio respecto de la mig 105: app_is_staff() -> app_is_admin(). El resto
-- del cuerpo queda igual, idempotencia incluida.
CREATE OR REPLACE FUNCTION public.rpc_regularize_occupied_room(
  p_alert_id bigint,
  p_reservation_id uuid,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kind text;
  v_room_id integer;
  v_resolved timestamptz;
  v_res_room_id integer;
  v_res_status public.reservation_status;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Solo el administrador decide si esta pieza se cobra.' USING errcode = '42501';
  END IF;

  SELECT a.kind, a.related_room_id, a.resolved_at
  INTO v_kind, v_room_id, v_resolved
  FROM public.admin_alerts a
  WHERE a.id = p_alert_id
  FOR UPDATE;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Aviso no encontrado.' USING errcode = 'P0002';
  END IF;

  IF v_kind <> 'room_occupied_without_active_reservation' THEN
    RAISE EXCEPTION 'Este aviso no se regulariza cargando una estadia.' USING errcode = '22023';
  END IF;

  -- IDEMPOTENTE A PROPOSITO. El front hace dos llamadas seguidas (cargar la estadia
  -- y cerrar el aviso). Si la segunda falla por red, el reintento tiene que ser
  -- seguro: la plata ya esta cargada y volver a explotar aca no arregla nada.
  IF v_resolved IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  SELECT r.room_id, r.status INTO v_res_room_id, v_res_status
  FROM public.reservations r WHERE r.id = p_reservation_id;

  IF v_res_room_id IS NULL THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING errcode = 'P0002';
  END IF;
  IF v_res_status <> 'checked_in' THEN
    RAISE EXCEPTION 'La estadia tiene que estar con el huesped adentro para cerrar el aviso.' USING errcode = '22023';
  END IF;
  -- Que la estadia sea de ESTA pieza es lo unico que hace que el aviso quede
  -- explicado. Sin esta validacion, cerrar el aviso seria apuntar a cualquier cosa.
  IF v_room_id IS NOT NULL AND v_res_room_id <> v_room_id THEN
    RAISE EXCEPTION 'Esa estadia es de otra habitacion.' USING errcode = '22023';
  END IF;

  UPDATE public.admin_alerts
  SET resolved_at = NOW(),
      resolved_by = auth.uid(),
      resolved_notes = NULLIF(BTRIM(p_notes), ''),
      decision = 'regularizada',
      related_reservation_id = p_reservation_id
  WHERE id = p_alert_id AND resolved_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'already', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_regularize_occupied_room(bigint, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_regularize_occupied_room(bigint, uuid, text) TO authenticated;

DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('106_el_cobro_de_la_pieza_usada_lo_decide_el_admin.sql');
  END IF;
END $do$;

COMMIT;
