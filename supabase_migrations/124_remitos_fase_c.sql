-- ─────────────────────────────────────────────────────────────────────────────
-- 124: remitos firmados, fase C.
--
-- POR QUE. Un remito perdido se descubria recien al armar la consolidada, un mes
-- despues. Esto adelanta el aviso a las 48 h del check-out (vencidos), lo repite
-- al emitir la consolidada (faltantes, con motivo obligatorio para emitir igual) y
-- arma el PDF de remitos firmados de cada factura (paquete, lo arma n8n).
--
-- Diseño: docs/plans/2026-09-23-remitos-fase-c-design.md.
--
-- No toca tablas fuera de las de remitos. Las dos tablas nuevas nacen cerradas,
-- como las de la 116: solo las tocan estas funciones.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Ajustes de vencimiento ----------------------------------------------------------
ALTER TABLE public.remitos_ajustes
  ADD COLUMN IF NOT EXISTS horas_vencimiento INT NOT NULL DEFAULT 48
    CHECK (horas_vencimiento BETWEEN 1 AND 720),
  ADD COLUMN IF NOT EXISTS alertar_desde DATE NOT NULL DEFAULT DATE '2026-09-24';

-- 2) Constancia de una consolidada emitida con remitos faltantes ----------------------
CREATE TABLE IF NOT EXISTS public.remito_constancias_factura (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL UNIQUE REFERENCES public.invoices(id),
  faltantes JSONB NOT NULL,
  motivo TEXT NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 500),
  usuario_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Paquetes: un pedido por version, lo arma n8n --------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_paquetes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id),
  version INT NOT NULL CHECK (version >= 1),
  estado TEXT NOT NULL DEFAULT 'pedido' CHECK (estado IN ('pedido', 'armando', 'listo', 'error')),
  escaneos JSONB NOT NULL,
  total_remitos INT NOT NULL CHECK (total_remitos >= 0),
  drive_file_id TEXT,
  drive_link TEXT,
  paginas INT,
  error TEXT,
  pedido_por UUID NOT NULL REFERENCES auth.users(id),
  pedido_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  armando_at TIMESTAMPTZ,
  terminado_at TIMESTAMPTZ,
  CONSTRAINT remito_paquetes_version_uq UNIQUE (invoice_id, version),
  CONSTRAINT remito_paquetes_listo_con_archivo CHECK (estado <> 'listo' OR drive_file_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS remito_paquetes_pedidos_idx
  ON public.remito_paquetes (pedido_at) WHERE estado = 'pedido';

ALTER TABLE public.remito_constancias_factura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_paquetes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.remito_constancias_factura, public.remito_paquetes FROM PUBLIC, anon, authenticated;

-- 4) Ayudantes internos ---------------------------------------------------------------

-- La regla de vencido, en un solo lugar. La copia en TypeScript (esVencido en
-- src/lib/remitos.ts) tiene que decir lo mismo.
CREATE OR REPLACE FUNCTION public.app_remitos_vencido(p_created_at TIMESTAMPTZ, p_estado TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p_estado, 'sin_escanear') NOT IN ('firmado', 'sin_remito')
     AND (p_created_at AT TIME ZONE public.app_remitos_tz())::date >= a.alertar_desde
     AND p_created_at <= NOW() - make_interval(hours => a.horas_vencimiento)
    FROM public.remitos_ajustes a
   WHERE a.id = 1
$$;
REVOKE ALL ON FUNCTION public.app_remitos_vencido(TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;

-- Remitos controlados de esas estadias que no estan firmados ni marcados sin remito.
-- Controlado = desde controlar_desde o con al menos un escaneo (el alcance del panel).
CREATE OR REPLACE FUNCTION public.app_remitos_faltantes_de(p_reservation_ids UUID[])
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'movimiento_id', m.id,
           'reservation_id', m.reservation_id,
           'remito_numero', m.remito_numero,
           'estado', COALESCE(c.estado, 'sin_escanear'))
         ORDER BY m.remito_numero), '[]'::jsonb)
    FROM public.cuenta_corriente_movimientos m
    JOIN public.remitos_ajustes a ON a.id = 1
    LEFT JOIN public.remito_control c ON c.cc_movimiento_id = m.id
   WHERE m.tipo = 'cargo'
     AND m.reservation_id = ANY(COALESCE(p_reservation_ids, '{}'::uuid[]))
     AND (m.remito_numero >= a.controlar_desde OR c.cc_movimiento_id IS NOT NULL)
     AND COALESCE(c.estado, 'sin_escanear') NOT IN ('firmado', 'sin_remito')
$$;
REVOKE ALL ON FUNCTION public.app_remitos_faltantes_de(UUID[]) FROM PUBLIC, anon, authenticated;

-- Texto de la factura para el nombre del paquete: FB 00008-00001234.
CREATE OR REPLACE FUNCTION public.app_remitos_factura_texto(p_invoice_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'F' || CASE i.cbte_tipo WHEN 1 THEN 'A' WHEN 6 THEN 'B' WHEN 11 THEN 'C' ELSE '?' END
         || ' ' || lpad(COALESCE(i.pto_vta, 0)::text, 5, '0') || '-' || lpad(COALESCE(i.cbte_nro, 0)::text, 8, '0')
    FROM public.invoices i
   WHERE i.id = p_invoice_id
$$;
REVOKE ALL ON FUNCTION public.app_remitos_factura_texto(UUID) FROM PUBLIC, anon, authenticated;

-- 5) Salud del panel: suma los vencidos (mismo cuerpo que la 116 mas cuatro claves) ---
CREATE OR REPLACE FUNCTION public.rpc_remitos_salud()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
  v_desde TIMESTAMPTZ;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  SELECT (a.alertar_desde::timestamp AT TIME ZONE public.app_remitos_tz()) INTO v_desde
    FROM public.remitos_ajustes a WHERE a.id = 1;
  SELECT jsonb_build_object(
           'ultima_ingesta_at', a.ultima_ingesta_at,
           'ultima_evaluacion_at', a.ultima_evaluacion_at,
           'evaluando_viejos', (SELECT count(*) FROM public.remito_control c
                                  JOIN public.remito_escaneos e ON e.id = c.escaneo_id
                                 WHERE c.estado = 'evaluando' AND e.created_at < NOW() - INTERVAL '2 hours'),
           'a_revisar', (SELECT count(*) FROM public.remito_control c WHERE c.estado = 'a_revisar'),
           'piezas_abiertas', (SELECT count(*) FROM public.remito_piezas_revisar p WHERE p.resuelta_at IS NULL),
           'vencidos', (SELECT count(*) FROM public.cuenta_corriente_movimientos m
                          LEFT JOIN public.remito_control c ON c.cc_movimiento_id = m.id
                         WHERE m.tipo = 'cargo' AND m.created_at >= v_desde
                           AND public.app_remitos_vencido(m.created_at, c.estado)),
           'a_revisar_vencidos', (SELECT count(*) FROM public.cuenta_corriente_movimientos m
                                    JOIN public.remito_control c ON c.cc_movimiento_id = m.id
                                   WHERE m.tipo = 'cargo' AND m.created_at >= v_desde AND c.estado = 'a_revisar'
                                     AND public.app_remitos_vencido(m.created_at, c.estado)),
           'umbral_confianza', a.umbral_confianza,
           'controlar_desde', a.controlar_desde,
           'max_intentos_firma', a.max_intentos_firma,
           'horas_vencimiento', a.horas_vencimiento,
           'alertar_desde', a.alertar_desde)
    INTO v
    FROM public.remitos_ajustes a WHERE a.id = 1;
  RETURN v;
END;
$$;

-- 6) Panel: solo admin ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_remitos_guardar_vencimiento(p_horas INT, p_alertar_desde DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_horas IS NULL OR p_horas < 1 OR p_horas > 720 THEN
    RAISE EXCEPTION 'Las horas para vencer tienen que estar entre 1 y 720' USING errcode = '22023';
  END IF;
  IF p_alertar_desde IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha desde la que se alerta' USING errcode = '22023';
  END IF;
  UPDATE public.remitos_ajustes
     SET horas_vencimiento = p_horas, alertar_desde = p_alertar_desde,
         updated_at = NOW(), updated_by = auth.uid()
   WHERE id = 1;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_faltantes(p_reservation_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  RETURN public.app_remitos_faltantes_de(p_reservation_ids);
END;
$$;

-- Se llama despues de crear el borrador y ANTES de mandarlo a ARCA. Los faltantes
-- se recalculan aca, sobre las estadias de la factura: no se confia en lo que
-- mando la pantalla. Si no hay faltantes no guarda nada. Si ya habia constancia
-- (reintento de la misma factura pendiente), queda la primera.
CREATE OR REPLACE FUNCTION public.rpc_remitos_guardar_constancia(p_invoice_id UUID, p_motivo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_faltantes JSONB;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice_id AND i.kind = 'consolidada') THEN
    RAISE EXCEPTION 'La factura no existe o no es una consolidada' USING errcode = 'P0070';
  END IF;
  IF length(btrim(COALESCE(p_motivo, ''))) < 3 THEN
    RAISE EXCEPTION 'Falta el motivo para emitir con remitos faltantes' USING errcode = 'P0074';
  END IF;
  v_faltantes := public.app_remitos_faltantes_de(ARRAY(
    SELECT ir.reservation_id FROM public.invoice_reservations ir
     WHERE ir.invoice_id = p_invoice_id AND ir.unlinked_at IS NULL));
  IF jsonb_array_length(v_faltantes) = 0 THEN
    RETURN jsonb_build_object('ok', TRUE, 'guardada', FALSE);
  END IF;
  INSERT INTO public.remito_constancias_factura (invoice_id, faltantes, motivo, usuario_id)
  VALUES (p_invoice_id, v_faltantes, left(btrim(p_motivo), 500), auth.uid())
  ON CONFLICT (invoice_id) DO NOTHING;
  RETURN jsonb_build_object('ok', TRUE, 'guardada', TRUE, 'faltantes', jsonb_array_length(v_faltantes));
END;
$$;

-- Consolidadas vigentes de un cliente, con sus remitos, la constancia y el ultimo paquete.
CREATE OR REPLACE FUNCTION public.rpc_remitos_paquetes(p_client_kind TEXT, p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_client_kind NOT IN ('company', 'guest') OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'Cliente invalido' USING errcode = '22023';
  END IF;

  WITH facturas AS (
    SELECT DISTINCT i.id
      FROM public.invoices i
      JOIN public.invoice_reservations ir ON ir.invoice_id = i.id AND ir.unlinked_at IS NULL
      JOIN public.cuenta_corriente_movimientos m ON m.reservation_id = ir.reservation_id AND m.tipo = 'cargo'
     WHERE i.kind = 'consolidada' AND i.status = 'authorized' AND i.anulada_at IS NULL
       AND ((p_client_kind = 'company' AND m.associated_client_id = p_client_id)
         OR (p_client_kind = 'guest' AND m.guest_id = p_client_id))
  ),
  remitos AS (
    SELECT ir.invoice_id, m.id AS movimiento_id, c.estado, c.escaneo_id
      FROM facturas f
      JOIN public.invoice_reservations ir ON ir.invoice_id = f.id AND ir.unlinked_at IS NULL
      JOIN public.cuenta_corriente_movimientos m ON m.reservation_id = ir.reservation_id AND m.tipo = 'cargo'
      LEFT JOIN public.remito_control c ON c.cc_movimiento_id = m.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'invoice_id', i.id,
           'factura_texto', public.app_remitos_factura_texto(i.id),
           'cbte_fch', i.cbte_fch,
           'imp_total', i.imp_total,
           'remitos_total', (SELECT count(*) FROM remitos r WHERE r.invoice_id = i.id),
           'remitos_firmados', (SELECT count(*) FROM remitos r WHERE r.invoice_id = i.id AND r.estado = 'firmado'),
           'constancia', (SELECT jsonb_build_object(
                             'motivo', k.motivo,
                             'faltantes', jsonb_array_length(k.faltantes),
                             'usuario', COALESCE(NULLIF(btrim(pr.full_name), ''), u.email::text),
                             'created_at', k.created_at)
                            FROM public.remito_constancias_factura k
                            LEFT JOIN public.profiles pr ON pr.id = k.usuario_id
                            LEFT JOIN auth.users u ON u.id = k.usuario_id
                           WHERE k.invoice_id = i.id),
           'paquete', (SELECT jsonb_build_object(
                          'id', p.id, 'version', p.version, 'estado', p.estado,
                          'remitos', jsonb_array_length(p.escaneos), 'drive_link', p.drive_link,
                          'error', p.error, 'pedido_at', p.pedido_at, 'armando_at', p.armando_at,
                          'terminado_at', p.terminado_at)
                         FROM public.remito_paquetes p
                        WHERE p.invoice_id = i.id
                        ORDER BY p.version DESC LIMIT 1),
           'firmados_nuevos', (SELECT count(*) FROM remitos r
                                WHERE r.invoice_id = i.id AND r.estado = 'firmado'
                                  AND NOT EXISTS (
                                    SELECT 1 FROM public.remito_paquetes p
                                     WHERE p.invoice_id = i.id
                                       AND p.version = (SELECT max(p2.version) FROM public.remito_paquetes p2 WHERE p2.invoice_id = i.id)
                                       AND p.escaneos @> jsonb_build_array(jsonb_build_object('escaneo_id', r.escaneo_id))))
         ) ORDER BY i.cbte_fch DESC NULLS LAST, i.cbte_nro DESC NULLS LAST), '[]'::jsonb)
    INTO v
    FROM facturas f
    JOIN public.invoices i ON i.id = f.id;
  RETURN v;
END;
$$;

-- Pide un paquete. Congela la lista: los remitos firmados de la factura, en el orden
-- del impreso (fecha de entrada y numero), con el archivo y la hora de archivo de
-- su escaneo vigente.
CREATE OR REPLACE FUNCTION public.rpc_remitos_pedir_paquete(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ultimo public.remito_paquetes%ROWTYPE;
  v_escaneos JSONB;
  v_total INT;
  v_version INT;
  v_id UUID;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i
                  WHERE i.id = p_invoice_id AND i.kind = 'consolidada'
                    AND i.status = 'authorized' AND i.anulada_at IS NULL) THEN
    RAISE EXCEPTION 'La factura no es una consolidada vigente' USING errcode = 'P0070';
  END IF;

  SELECT p.* INTO v_ultimo FROM public.remito_paquetes p
   WHERE p.invoice_id = p_invoice_id ORDER BY p.version DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_ultimo.estado = 'pedido'
       OR (v_ultimo.estado = 'armando' AND v_ultimo.armando_at > NOW() - INTERVAL '30 minutes') THEN
      RAISE EXCEPTION 'Ese paquete ya se esta armando' USING errcode = 'P0071';
    END IF;
    IF v_ultimo.estado = 'armando' THEN
      UPDATE public.remito_paquetes
         SET estado = 'error', error = 'Se corto a mitad de camino (mas de 30 minutos armando).', terminado_at = NOW()
       WHERE id = v_ultimo.id;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'numero', m.remito_numero,
           'movimiento_id', m.id,
           'escaneo_id', e.id,
           'drive_file_id', e.drive_file_id,
           'archivado_at', e.created_at)
         ORDER BY ir.fch_desde, m.remito_numero), '[]'::jsonb)
    INTO v_escaneos
    FROM public.invoice_reservations ir
    JOIN public.cuenta_corriente_movimientos m ON m.reservation_id = ir.reservation_id AND m.tipo = 'cargo'
    JOIN public.remito_control c ON c.cc_movimiento_id = m.id AND c.estado = 'firmado'
    JOIN public.remito_escaneos e ON e.id = c.escaneo_id
   WHERE ir.invoice_id = p_invoice_id AND ir.unlinked_at IS NULL;

  SELECT count(*) INTO v_total
    FROM public.invoice_reservations ir
    JOIN public.cuenta_corriente_movimientos m ON m.reservation_id = ir.reservation_id AND m.tipo = 'cargo'
   WHERE ir.invoice_id = p_invoice_id AND ir.unlinked_at IS NULL;

  IF jsonb_array_length(v_escaneos) = 0 THEN
    RAISE EXCEPTION 'Esta factura todavia no tiene remitos firmados' USING errcode = 'P0072';
  END IF;

  v_version := COALESCE(v_ultimo.version, 0) + 1;
  INSERT INTO public.remito_paquetes (invoice_id, version, escaneos, total_remitos, pedido_por)
  VALUES (p_invoice_id, v_version, v_escaneos, v_total, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', TRUE, 'paquete_id', v_id, 'version', v_version,
                            'remitos', jsonb_array_length(v_escaneos), 'total', v_total);
END;
$$;

-- 7) n8n: exigen la clave de la integracion ------------------------------------------------

-- Toma el pedido mas viejo y lo marca armando. Sin pedidos devuelve un objeto vacio.
CREATE OR REPLACE FUNCTION public.rpc_remitos_paquete_tomar()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p public.remito_paquetes%ROWTYPE;
  v_cliente TEXT;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  SELECT p.* INTO v_p FROM public.remito_paquetes p
   WHERE p.estado = 'pedido' ORDER BY p.pedido_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN '{}'::jsonb;
  END IF;
  UPDATE public.remito_paquetes SET estado = 'armando', armando_at = NOW() WHERE id = v_p.id;

  SELECT COALESCE(ac.display_name, g.full_name) INTO v_cliente
    FROM public.invoice_reservations ir
    JOIN public.cuenta_corriente_movimientos m ON m.reservation_id = ir.reservation_id AND m.tipo = 'cargo'
    LEFT JOIN public.associated_clients ac ON ac.id = m.associated_client_id
    LEFT JOIN public.guests g ON g.id = m.guest_id
   WHERE ir.invoice_id = v_p.invoice_id
   ORDER BY ir.fch_desde LIMIT 1;

  RETURN jsonb_build_object(
    'paquete_id', v_p.id,
    'version', v_p.version,
    'factura_texto', public.app_remitos_factura_texto(v_p.invoice_id),
    'cliente', COALESCE(v_cliente, 'SIN NOMBRE'),
    'escaneos', v_p.escaneos);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_paquete_listo(
  p_paquete_id UUID, p_drive_file_id TEXT, p_drive_link TEXT, p_paginas INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF btrim(COALESCE(p_drive_file_id, '')) = '' THEN
    RAISE EXCEPTION 'Falta el archivo del paquete' USING errcode = '22023';
  END IF;
  UPDATE public.remito_paquetes
     SET estado = 'listo', drive_file_id = p_drive_file_id, drive_link = p_drive_link,
         paginas = p_paginas, error = NULL, terminado_at = NOW()
   WHERE id = p_paquete_id AND estado = 'armando';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El paquete no estaba armandose' USING errcode = 'P0073';
  END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_paquete_error(p_paquete_id UUID, p_error TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  UPDATE public.remito_paquetes
     SET estado = 'error', error = left(COALESCE(NULLIF(btrim(p_error), ''), 'Error sin detalle'), 500),
         terminado_at = NOW()
   WHERE id = p_paquete_id AND estado IN ('pedido', 'armando');
  RETURN jsonb_build_object('ok', TRUE, 'cambio', FOUND);
END;
$$;

-- 8) Permisos (como en la 116: cada grupo solo para su rol) -----------------------------
REVOKE ALL ON FUNCTION public.rpc_remitos_paquete_tomar() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.rpc_remitos_paquete_listo(UUID, TEXT, TEXT, INT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.rpc_remitos_paquete_error(UUID, TEXT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_paquete_tomar() TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_paquete_listo(UUID, TEXT, TEXT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_paquete_error(UUID, TEXT) TO anon;

REVOKE ALL ON FUNCTION public.rpc_remitos_salud() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_guardar_vencimiento(INT, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_faltantes(UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_guardar_constancia(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_paquetes(TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_pedir_paquete(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_salud() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_guardar_vencimiento(INT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_faltantes(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_guardar_constancia(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_paquetes(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_pedir_paquete(UUID) TO authenticated;

-- Registro
DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('124_remitos_fase_c.sql');
  END IF;
END
$do$;

COMMIT;
