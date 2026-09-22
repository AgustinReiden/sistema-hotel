-- ─────────────────────────────────────────────────────────────────────────────
-- 116: remitos firmados de cuenta corriente, adentro del sistema.
--
-- POR QUÉ. Cuando el hotel emite la consolidada, la empresa pide los remitos
-- firmados que respaldan cada consumo. Hoy dos personas escanean y cotejan a
-- mano. La automatizacion (automatizaciones/remitos, en n8n) ya separa los
-- escaneos, lee el QR de cada remito, lo archiva en Drive y le pregunta a Gemini
-- si esta firmado, pero anotaba todo en una planilla. Con esto el estado de cada
-- remito vive en la base, colgado de su cargo.
--
-- Diseño: docs/plans/2026-09-22-remitos-integracion-design.md.
--
-- QUIEN ESCRIBE. n8n no tiene sesion ni la llave maestra: llama como anon a seis
-- funciones que exigen la clave de la integracion en el encabezado
-- x-remitos-clave. En la base queda solo su huella (remitos_privado), igual que
-- la clave interna de ARCA en fiscal_private. El panel usa funciones que exigen
-- app_is_admin(). Las tablas nacen cerradas y solo las tocan estas funciones.
--
-- LA REGLA DE LA IA VIVE ACA y no en n8n: n8n informa lo que dijo Gemini y la
-- base decide con el umbral de remitos_ajustes (0,95 por defecto). La IA nunca
-- pisa lo que decidio una persona sobre el mismo escaneo.
--
-- ALCANCE. Se controlan los remitos impresos con QR: desde controlar_desde (el
-- primer cargo creado despues del despliegue del comprobante con QR) y cualquier
-- remito que tenga al menos un escaneo.
--
-- El comprobante con QR se mergeo el 2026-09-22 a las 18:41 UTC (PR 124); la
-- hora de abajo es el merge mas 10 minutos. Entre el merge y la prueba en seco no
-- hubo cargos, asi que controlar_desde queda en el primero posterior (161).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Ajustes, una sola fila ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remitos_ajustes (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  umbral_confianza NUMERIC(3,2) NOT NULL DEFAULT 0.95
    CHECK (umbral_confianza BETWEEN 0.50 AND 1.00),
  max_intentos_firma INT NOT NULL DEFAULT 5 CHECK (max_intentos_firma BETWEEN 1 AND 20),
  controlar_desde INT NOT NULL CHECK (controlar_desde >= 1),
  ultima_ingesta_at TIMESTAMPTZ,
  ultima_evaluacion_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

INSERT INTO public.remitos_ajustes (id, controlar_desde)
SELECT 1, COALESCE(
  (SELECT MIN(m.remito_numero) FROM public.cuenta_corriente_movimientos m
    WHERE m.tipo = 'cargo' AND m.created_at >= TIMESTAMPTZ '2026-09-22 18:52:00+00'),
  (SELECT COALESCE(MAX(m.remito_numero), 0) + 1 FROM public.cuenta_corriente_movimientos m))
ON CONFLICT (id) DO NOTHING;

-- 2) Huella de la clave de la integracion --------------------------------------------
CREATE TABLE IF NOT EXISTS public.remitos_privado (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  clave_hash BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Escaneos archivados ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_escaneos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cc_movimiento_id UUID NOT NULL REFERENCES public.cuenta_corriente_movimientos(id),
  version INT NOT NULL CHECK (version >= 1),
  origen TEXT NOT NULL CHECK (origen IN ('qr', 'tipeado')),
  drive_file_id TEXT NOT NULL CHECK (btrim(drive_file_id) <> ''),
  drive_link TEXT,
  hash_sha256 TEXT NOT NULL CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  lote_archivo TEXT,
  lote_hash TEXT,
  ubicacion TEXT,
  firma_ia TEXT CHECK (firma_ia IN ('si', 'no', 'error')),
  firma_ia_confianza NUMERIC(3,2) CHECK (firma_ia_confianza BETWEEN 0 AND 1),
  firma_ia_observacion TEXT,
  firma_ia_modelo TEXT,
  firma_ia_intentos INT NOT NULL DEFAULT 0 CHECK (firma_ia_intentos >= 0),
  firma_ia_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  CONSTRAINT remito_escaneos_version_uq UNIQUE (cc_movimiento_id, version),
  CONSTRAINT remito_escaneos_hash_uq UNIQUE (hash_sha256)
);

-- 4) Estado actual de cada remito con actividad ------------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_control (
  cc_movimiento_id UUID PRIMARY KEY REFERENCES public.cuenta_corriente_movimientos(id),
  estado TEXT NOT NULL CHECK (estado IN ('evaluando', 'a_revisar', 'firmado', 'sin_firma', 'sin_remito')),
  escaneo_id UUID REFERENCES public.remito_escaneos(id),
  decidido_por TEXT NOT NULL CHECK (decidido_por IN ('sistema', 'ia', 'persona')),
  usuario_id UUID REFERENCES auth.users(id),
  nota TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT remito_control_sin_remito_con_nota
    CHECK (estado <> 'sin_remito' OR length(btrim(COALESCE(nota, ''))) > 0),
  CONSTRAINT remito_control_persona_con_usuario
    CHECK (decidido_por <> 'persona' OR usuario_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS remito_control_estado_idx ON public.remito_control (estado);

-- 5) Registro de cambios, solo se agrega -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_eventos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cc_movimiento_id UUID NOT NULL REFERENCES public.cuenta_corriente_movimientos(id),
  estado_anterior TEXT,
  estado_nuevo TEXT NOT NULL,
  decidido_por TEXT NOT NULL,
  usuario_id UUID REFERENCES auth.users(id),
  escaneo_id UUID REFERENCES public.remito_escaneos(id),
  nota TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS remito_eventos_mov_idx ON public.remito_eventos (cc_movimiento_id, created_at);

-- 6) Piezas que fueron a _Revisar ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_piezas_revisar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hash_sha256 TEXT NOT NULL UNIQUE CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  drive_file_id TEXT NOT NULL CHECK (btrim(drive_file_id) <> ''),
  drive_link TEXT,
  lote_archivo TEXT,
  lote_hash TEXT,
  ubicacion TEXT,
  motivo TEXT NOT NULL CHECK (motivo ~ '^[a-z_]{3,40}$'),
  numeros_leidos TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_at TIMESTAMPTZ,
  resuelta_por UUID REFERENCES auth.users(id),
  resuelta_como TEXT CHECK (resuelta_como IN ('asignada', 'reescaneada', 'descartada')),
  resuelta_nota TEXT,
  cc_movimiento_id UUID REFERENCES public.cuenta_corriente_movimientos(id),
  CONSTRAINT remito_piezas_resuelta_coherente CHECK ((resuelta_at IS NULL) = (resuelta_como IS NULL)),
  CONSTRAINT remito_piezas_asignada_con_remito CHECK (resuelta_como <> 'asignada' OR cc_movimiento_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS remito_piezas_abiertas_idx
  ON public.remito_piezas_revisar (created_at) WHERE resuelta_at IS NULL;

-- 7) Todo cerrado: solo las funciones de abajo tocan estas tablas -----------------------------------
ALTER TABLE public.remitos_ajustes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remitos_privado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_escaneos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remito_piezas_revisar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.remitos_ajustes, public.remitos_privado, public.remito_escaneos,
  public.remito_control, public.remito_eventos, public.remito_piezas_revisar
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.remito_eventos_id_seq FROM PUBLIC, anon, authenticated;

-- 8) Ayudantes internos, sin GRANT -------------------------------------------------------------------
--
-- En PROD toda funcion nueva de postgres nace con EXECUTE explicito para
-- authenticated (ACL por defecto), y REVOKE FROM PUBLIC no lo saca. Por eso estos
-- ayudantes se cierran tambien para anon y authenticated, como en las migs 111 y
-- 114: app_remitos_cambiar_estado escribe estados sin controlar nada, y abierta
-- dejaria a cualquier usuario logueado marcar remitos por la API.

-- La clave llega en el encabezado x-remitos-clave: PostgREST deja los encabezados
-- en request.headers. En n8n vive en una credencial, que no se puede meter en el
-- cuerpo de un pedido.
CREATE OR REPLACE FUNCTION public.app_remitos_clave_ok()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clave TEXT;
BEGIN
  BEGIN
    v_clave := NULLIF(current_setting('request.headers', true), '')::json ->> 'x-remitos-clave';
  EXCEPTION WHEN others THEN
    RETURN FALSE;
  END;
  IF v_clave IS NULL OR length(v_clave) < 32 THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.remitos_privado p
     WHERE p.id = 1 AND p.clave_hash = extensions.digest(v_clave, 'sha256')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.app_remitos_clave_ok() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_remitos_tz()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT NULLIF(btrim(h.timezone), '') FROM public.hotel_settings h LIMIT 1),
                  'America/Argentina/Tucuman');
$$;
REVOKE ALL ON FUNCTION public.app_remitos_tz() FROM PUBLIC, anon, authenticated;

-- Unico lugar que escribe remito_control. Siempre deja el rastro en remito_eventos.
CREATE OR REPLACE FUNCTION public.app_remitos_cambiar_estado(
  p_mov UUID, p_estado TEXT, p_decidido_por TEXT, p_usuario UUID, p_escaneo UUID, p_nota TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anterior TEXT;
  v_nota TEXT := NULLIF(btrim(COALESCE(p_nota, '')), '');
  v_escaneo UUID;
BEGIN
  SELECT c.estado, c.escaneo_id INTO v_anterior, v_escaneo
    FROM public.remito_control c WHERE c.cc_movimiento_id = p_mov FOR UPDATE;
  v_escaneo := COALESCE(p_escaneo, v_escaneo);

  INSERT INTO public.remito_control AS c
    (cc_movimiento_id, estado, escaneo_id, decidido_por, usuario_id, nota, updated_at)
  VALUES (p_mov, p_estado, v_escaneo, p_decidido_por, p_usuario, v_nota, NOW())
  ON CONFLICT (cc_movimiento_id) DO UPDATE
     SET estado = EXCLUDED.estado,
         escaneo_id = EXCLUDED.escaneo_id,
         decidido_por = EXCLUDED.decidido_por,
         usuario_id = EXCLUDED.usuario_id,
         nota = EXCLUDED.nota,
         updated_at = NOW();

  INSERT INTO public.remito_eventos
    (cc_movimiento_id, estado_anterior, estado_nuevo, decidido_por, usuario_id, escaneo_id, nota)
  VALUES (p_mov, v_anterior, p_estado, p_decidido_por, p_usuario, v_escaneo, v_nota);
END;
$$;
REVOKE ALL ON FUNCTION public.app_remitos_cambiar_estado(UUID, TEXT, TEXT, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- 9) Funciones para n8n: exigen la clave de la integracion -----------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_remitos_planificar(p_numeros INT[], p_hashes TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT := public.app_remitos_tz();
  v_remitos JSONB;
  v_hashes JSONB;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'numero', n.numero,
           'existe', m.id IS NOT NULL,
           'cliente', COALESCE(ac.display_name, g.full_name),
           'periodo', to_char(m.created_at AT TIME ZONE v_tz, 'YYYY-MM'),
           'versiones', COALESCE((SELECT MAX(e.version) FROM public.remito_escaneos e
                                   WHERE e.cc_movimiento_id = m.id), 0)
         ) ORDER BY n.numero), '[]'::jsonb)
    INTO v_remitos
    FROM (SELECT DISTINCT unnest(COALESCE(p_numeros, '{}'::int[])) AS numero) n
    LEFT JOIN public.cuenta_corriente_movimientos m ON m.remito_numero = n.numero AND m.tipo = 'cargo'
    LEFT JOIN public.associated_clients ac ON ac.id = m.associated_client_id
    LEFT JOIN public.guests g ON g.id = m.guest_id;

  SELECT COALESCE(jsonb_agg(DISTINCT h.hash), '[]'::jsonb)
    INTO v_hashes
    FROM unnest(COALESCE(p_hashes, '{}'::text[])) AS h(hash)
   WHERE EXISTS (SELECT 1 FROM public.remito_escaneos e WHERE e.hash_sha256 = h.hash)
      OR EXISTS (SELECT 1 FROM public.remito_piezas_revisar p WHERE p.hash_sha256 = h.hash);

  RETURN jsonb_build_object('remitos', v_remitos, 'hashes_registrados', v_hashes);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_registrar_escaneo(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT := lower(btrim(COALESCE(p ->> 'hash_sha256', '')));
  v_numero INT := (p ->> 'numero')::int;
  v_existente public.remito_escaneos%ROWTYPE;
  v_mov UUID;
  v_version INT;
  v_id UUID;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  -- Idempotente: la misma pieza (misma huella) nunca se registra dos veces.
  SELECT * INTO v_existente FROM public.remito_escaneos WHERE hash_sha256 = v_hash;
  IF FOUND THEN
    RETURN jsonb_build_object('escaneo_id', v_existente.id, 'version', v_existente.version, 'ya_existia', TRUE);
  END IF;

  SELECT m.id INTO v_mov FROM public.cuenta_corriente_movimientos m
   WHERE m.remito_numero = v_numero AND m.tipo = 'cargo';
  IF v_mov IS NULL THEN
    RAISE EXCEPTION 'El remito % no existe', v_numero USING errcode = 'P0060';
  END IF;

  SELECT COALESCE(MAX(e.version), 0) + 1 INTO v_version
    FROM public.remito_escaneos e WHERE e.cc_movimiento_id = v_mov;

  INSERT INTO public.remito_escaneos
    (cc_movimiento_id, version, origen, drive_file_id, drive_link, hash_sha256, lote_archivo, lote_hash, ubicacion)
  VALUES (v_mov, v_version, 'qr', p ->> 'drive_file_id', p ->> 'drive_link', v_hash,
          p ->> 'lote_archivo', p ->> 'lote_hash', p ->> 'ubicacion')
  RETURNING id INTO v_id;

  -- Escaneo nuevo: vuelve a evaluando aunque ya estuviera confirmado, porque la
  -- imagen nueva puede contradecir a la vieja.
  PERFORM public.app_remitos_cambiar_estado(v_mov, 'evaluando', 'sistema', NULL, v_id, NULL);

  RETURN jsonb_build_object('escaneo_id', v_id, 'version', v_version, 'ya_existia', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_registrar_pieza(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT := lower(btrim(COALESCE(p ->> 'hash_sha256', '')));
  v_id UUID;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;

  INSERT INTO public.remito_piezas_revisar
    (hash_sha256, drive_file_id, drive_link, lote_archivo, lote_hash, ubicacion, motivo, numeros_leidos)
  VALUES (v_hash, p ->> 'drive_file_id', p ->> 'drive_link', p ->> 'lote_archivo', p ->> 'lote_hash',
          p ->> 'ubicacion', p ->> 'motivo',
          ARRAY(SELECT jsonb_array_elements_text(COALESCE(p -> 'numeros_leidos', '[]'::jsonb))))
  ON CONFLICT (hash_sha256) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.remito_piezas_revisar r WHERE r.hash_sha256 = v_hash;
    RETURN jsonb_build_object('pieza_id', v_id, 'ya_existia', TRUE);
  END IF;
  RETURN jsonb_build_object('pieza_id', v_id, 'ya_existia', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_firmas_pendientes(p_limite INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max INT;
  v_lista JSONB;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  SELECT a.max_intentos_firma INTO v_max FROM public.remitos_ajustes a WHERE a.id = 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'escaneo_id', t.id, 'drive_file_id', t.drive_file_id,
           'numero', t.remito_numero, 'intentos', t.firma_ia_intentos)
         ORDER BY t.firma_ia_intentos, t.created_at), '[]'::jsonb)
    INTO v_lista
    FROM (
      SELECT e.id, e.drive_file_id, m.remito_numero, e.firma_ia_intentos, e.created_at
        FROM public.remito_control c
        JOIN public.remito_escaneos e ON e.id = c.escaneo_id
        JOIN public.cuenta_corriente_movimientos m ON m.id = e.cc_movimiento_id
       WHERE c.estado = 'evaluando'
         AND (e.firma_ia IS NULL OR e.firma_ia = 'error')
         AND e.firma_ia_intentos < COALESCE(v_max, 5)
       ORDER BY e.firma_ia_intentos, e.created_at
       LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 5), 50))
    ) t;
  RETURN v_lista;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_guardar_firma(
  p_escaneo_id UUID, p_firma TEXT, p_confianza NUMERIC, p_observacion TEXT, p_modelo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.remito_escaneos%ROWTYPE;
  v_c public.remito_control%ROWTYPE;
  v_umbral NUMERIC;
  v_max INT;
  v_estado TEXT;
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_firma IS NULL OR p_firma NOT IN ('si', 'no', 'error') THEN
    RAISE EXCEPTION 'Firma invalida: %', p_firma USING errcode = '22023';
  END IF;
  SELECT a.umbral_confianza, a.max_intentos_firma INTO v_umbral, v_max
    FROM public.remitos_ajustes a WHERE a.id = 1;

  UPDATE public.remito_escaneos
     SET firma_ia = p_firma,
         firma_ia_confianza = CASE WHEN p_firma = 'error' THEN NULL
                                   ELSE LEAST(1, GREATEST(0, COALESCE(p_confianza, 0))) END,
         firma_ia_observacion = left(p_observacion, 300),
         firma_ia_modelo = left(p_modelo, 80),
         firma_ia_intentos = firma_ia_intentos + 1,
         firma_ia_at = NOW()
   WHERE id = p_escaneo_id
   RETURNING * INTO v_e;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escaneo inexistente' USING errcode = 'P0061';
  END IF;

  SELECT * INTO v_c FROM public.remito_control WHERE cc_movimiento_id = v_e.cc_movimiento_id FOR UPDATE;
  -- La IA solo decide sobre el escaneo vigente, mientras el remito esta evaluando
  -- y ninguna persona decidio sobre ese escaneo.
  IF NOT FOUND OR v_c.escaneo_id IS DISTINCT FROM v_e.id OR v_c.estado <> 'evaluando'
     OR v_c.decidido_por = 'persona' THEN
    RETURN jsonb_build_object('estado', COALESCE(v_c.estado, 'sin_escanear'), 'cambio', FALSE);
  END IF;

  IF p_firma IN ('si', 'no') AND v_e.firma_ia_confianza >= COALESCE(v_umbral, 0.95) THEN
    v_estado := CASE p_firma WHEN 'si' THEN 'firmado' ELSE 'sin_firma' END;
  ELSIF p_firma IN ('si', 'no') THEN
    v_estado := 'a_revisar';
  ELSIF v_e.firma_ia_intentos >= COALESCE(v_max, 5) THEN
    v_estado := 'a_revisar';
  ELSE
    RETURN jsonb_build_object('estado', 'evaluando', 'cambio', FALSE);
  END IF;

  PERFORM public.app_remitos_cambiar_estado(v_e.cc_movimiento_id, v_estado, 'ia', NULL, v_e.id, NULL);
  RETURN jsonb_build_object('estado', v_estado, 'cambio', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_latido(p_que TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_remitos_clave_ok() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_que = 'ingesta' THEN
    UPDATE public.remitos_ajustes SET ultima_ingesta_at = NOW() WHERE id = 1;
  ELSIF p_que = 'evaluacion' THEN
    UPDATE public.remitos_ajustes SET ultima_evaluacion_at = NOW() WHERE id = 1;
  ELSE
    RAISE EXCEPTION 'Latido desconocido: %', p_que USING errcode = '22023';
  END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- 10) Funciones del panel: solo admin --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_remitos_listar(p_client_kind TEXT, p_client_id UUID, p_desde DATE, p_hasta DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT := public.app_remitos_tz();
  v_desde INT;
  v_filas JSONB;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Periodo invalido' USING errcode = '22023';
  END IF;
  SELECT a.controlar_desde INTO v_desde FROM public.remitos_ajustes a WHERE a.id = 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'movimiento_id', m.id,
           'remito_numero', m.remito_numero,
           'created_at', m.created_at,
           'amount', m.amount,
           'client_kind', CASE WHEN m.associated_client_id IS NOT NULL THEN 'company' ELSE 'guest' END,
           'client_id', COALESCE(m.associated_client_id, m.guest_id),
           'cliente', COALESCE(ac.display_name, g.full_name),
           'room_number', rm.room_number,
           'pasajero', r.client_name,
           'estado', COALESCE(c.estado, 'sin_escanear'),
           'decidido_por', c.decidido_por,
           'decidido_por_nombre', COALESCE(NULLIF(btrim(pr.full_name), ''), u.email::text),
           'estado_at', c.updated_at,
           'nota', c.nota,
           'escaneo_version', e.version,
           'escaneo_link', e.drive_link,
           'escaneo_origen', e.origen,
           'firma_ia', e.firma_ia,
           'firma_ia_confianza', e.firma_ia_confianza,
           'firma_ia_observacion', e.firma_ia_observacion
         ) ORDER BY m.remito_numero), '[]'::jsonb)
    INTO v_filas
    FROM public.cuenta_corriente_movimientos m
    LEFT JOIN public.associated_clients ac ON ac.id = m.associated_client_id
    LEFT JOIN public.guests g ON g.id = m.guest_id
    LEFT JOIN public.reservations r ON r.id = m.reservation_id
    LEFT JOIN public.rooms rm ON rm.id = r.room_id
    LEFT JOIN public.remito_control c ON c.cc_movimiento_id = m.id
    LEFT JOIN public.remito_escaneos e ON e.id = c.escaneo_id
    LEFT JOIN public.profiles pr ON pr.id = c.usuario_id
    LEFT JOIN auth.users u ON u.id = c.usuario_id
   WHERE m.tipo = 'cargo'
     AND (m.remito_numero >= COALESCE(v_desde, 2147483647) OR c.cc_movimiento_id IS NOT NULL)
     AND (m.created_at AT TIME ZONE v_tz)::date BETWEEN p_desde AND p_hasta
     AND (p_client_kind IS NULL
          OR (p_client_kind = 'company' AND m.associated_client_id = p_client_id)
          OR (p_client_kind = 'guest' AND m.guest_id = p_client_id));
  RETURN v_filas;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_salud()
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
  SELECT jsonb_build_object(
           'ultima_ingesta_at', a.ultima_ingesta_at,
           'ultima_evaluacion_at', a.ultima_evaluacion_at,
           'evaluando_viejos', (SELECT count(*) FROM public.remito_control c
                                  JOIN public.remito_escaneos e ON e.id = c.escaneo_id
                                 WHERE c.estado = 'evaluando' AND e.created_at < NOW() - INTERVAL '2 hours'),
           'a_revisar', (SELECT count(*) FROM public.remito_control c WHERE c.estado = 'a_revisar'),
           'piezas_abiertas', (SELECT count(*) FROM public.remito_piezas_revisar p WHERE p.resuelta_at IS NULL),
           'umbral_confianza', a.umbral_confianza,
           'controlar_desde', a.controlar_desde,
           'max_intentos_firma', a.max_intentos_firma)
    INTO v
    FROM public.remitos_ajustes a WHERE a.id = 1;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_marcar(p_movimiento_id UUID, p_estado TEXT, p_nota TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_estado IS NULL OR p_estado NOT IN ('firmado', 'sin_firma', 'sin_remito', 'a_revisar') THEN
    RAISE EXCEPTION 'Estado invalido: %', p_estado USING errcode = '22023';
  END IF;
  IF p_estado = 'sin_remito' AND length(btrim(COALESCE(p_nota, ''))) = 0 THEN
    RAISE EXCEPTION 'Para marcar sin remito hace falta una nota que diga que paso con el papel.' USING errcode = 'P0062';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cuenta_corriente_movimientos m
                  WHERE m.id = p_movimiento_id AND m.tipo = 'cargo') THEN
    RAISE EXCEPTION 'El remito no existe' USING errcode = 'P0060';
  END IF;
  IF p_estado <> 'sin_remito' AND NOT EXISTS (
       SELECT 1 FROM public.remito_control c
        WHERE c.cc_movimiento_id = p_movimiento_id AND c.escaneo_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Este remito todavia no tiene escaneo: primero hay que escanearlo.' USING errcode = 'P0063';
  END IF;

  PERFORM public.app_remitos_cambiar_estado(p_movimiento_id, p_estado, 'persona', auth.uid(), NULL, p_nota);
  RETURN jsonb_build_object('ok', TRUE, 'estado', p_estado);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_piezas(p_incluir_resueltas BOOLEAN)
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
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', t.id, 'created_at', t.created_at, 'motivo', t.motivo,
           'numeros_leidos', to_jsonb(t.numeros_leidos), 'drive_link', t.drive_link,
           'lote_archivo', t.lote_archivo, 'ubicacion', t.ubicacion,
           'resuelta_at', t.resuelta_at, 'resuelta_como', t.resuelta_como,
           'resuelta_nota', t.resuelta_nota, 'remito_numero', t.remito_numero)
         ORDER BY t.created_at DESC), '[]'::jsonb)
    INTO v
    FROM (
      SELECT p.*, m.remito_numero
        FROM public.remito_piezas_revisar p
        LEFT JOIN public.cuenta_corriente_movimientos m ON m.id = p.cc_movimiento_id
       WHERE COALESCE(p_incluir_resueltas, FALSE) OR p.resuelta_at IS NULL
       ORDER BY p.created_at DESC
       LIMIT 200
    ) t;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_buscar(p_numero INT)
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
  SELECT jsonb_build_object(
           'existe', TRUE,
           'movimiento_id', m.id,
           'remito_numero', m.remito_numero,
           'cliente', COALESCE(ac.display_name, g.full_name),
           'created_at', m.created_at,
           'amount', m.amount,
           'room_number', rm.room_number,
           'pasajero', r.client_name,
           'estado', COALESCE(c.estado, 'sin_escanear'),
           'escaneos', (SELECT count(*) FROM public.remito_escaneos e WHERE e.cc_movimiento_id = m.id))
    INTO v
    FROM public.cuenta_corriente_movimientos m
    LEFT JOIN public.associated_clients ac ON ac.id = m.associated_client_id
    LEFT JOIN public.guests g ON g.id = m.guest_id
    LEFT JOIN public.reservations r ON r.id = m.reservation_id
    LEFT JOIN public.rooms rm ON rm.id = r.room_id
    LEFT JOIN public.remito_control c ON c.cc_movimiento_id = m.id
   WHERE m.remito_numero = p_numero AND m.tipo = 'cargo';
  RETURN COALESCE(v, jsonb_build_object('existe', FALSE));
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_asignar_pieza(p_pieza_id UUID, p_numero INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p public.remito_piezas_revisar%ROWTYPE;
  v_mov UUID;
  v_version INT;
  v_id UUID;
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  SELECT * INTO v_p FROM public.remito_piezas_revisar WHERE id = p_pieza_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La pieza no existe' USING errcode = 'P0064';
  END IF;
  IF v_p.resuelta_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta pieza ya se resolvio' USING errcode = 'P0065';
  END IF;
  -- Una imagen con varios tickets nunca queda como respaldo de uno solo.
  IF v_p.motivo IN ('forma_no_reconocida', 'varios_codigos') THEN
    RAISE EXCEPTION 'Esta imagen tiene varios tickets: hay que volver a escanearlos separados.' USING errcode = 'P0066';
  END IF;
  SELECT m.id INTO v_mov FROM public.cuenta_corriente_movimientos m
   WHERE m.remito_numero = p_numero AND m.tipo = 'cargo';
  IF v_mov IS NULL THEN
    RAISE EXCEPTION 'El remito R-% no existe', lpad(p_numero::text, 6, '0') USING errcode = 'P0060';
  END IF;
  IF EXISTS (SELECT 1 FROM public.remito_escaneos e WHERE e.hash_sha256 = v_p.hash_sha256) THEN
    RAISE EXCEPTION 'Esta imagen ya esta vinculada a un remito' USING errcode = 'P0067';
  END IF;

  SELECT COALESCE(MAX(e.version), 0) + 1 INTO v_version
    FROM public.remito_escaneos e WHERE e.cc_movimiento_id = v_mov;
  INSERT INTO public.remito_escaneos
    (cc_movimiento_id, version, origen, drive_file_id, drive_link, hash_sha256, lote_archivo, lote_hash, ubicacion, created_by)
  VALUES (v_mov, v_version, 'tipeado', v_p.drive_file_id, v_p.drive_link, v_p.hash_sha256,
          v_p.lote_archivo, v_p.lote_hash, v_p.ubicacion, auth.uid())
  RETURNING id INTO v_id;

  UPDATE public.remito_piezas_revisar
     SET resuelta_at = NOW(), resuelta_por = auth.uid(), resuelta_como = 'asignada', cc_movimiento_id = v_mov
   WHERE id = p_pieza_id;

  -- Queda evaluando: la IA mira la firma como en cualquier escaneo.
  PERFORM public.app_remitos_cambiar_estado(v_mov, 'evaluando', 'sistema', auth.uid(), v_id, 'Escaneo asignado a mano');
  RETURN jsonb_build_object('ok', TRUE, 'escaneo_id', v_id, 'version', v_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_resolver_pieza(p_pieza_id UUID, p_como TEXT, p_nota TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_como IS NULL OR p_como NOT IN ('reescaneada', 'descartada') THEN
    RAISE EXCEPTION 'Resolucion invalida: %', p_como USING errcode = '22023';
  END IF;
  IF p_como = 'descartada' AND length(btrim(COALESCE(p_nota, ''))) = 0 THEN
    RAISE EXCEPTION 'Para descartar una pieza hace falta una nota.' USING errcode = 'P0062';
  END IF;
  UPDATE public.remito_piezas_revisar
     SET resuelta_at = NOW(), resuelta_por = auth.uid(), resuelta_como = p_como,
         resuelta_nota = NULLIF(btrim(COALESCE(p_nota, '')), '')
   WHERE id = p_pieza_id AND resuelta_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La pieza no existe o ya se resolvio' USING errcode = 'P0065';
  END IF;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_remitos_guardar_ajustes(p_umbral NUMERIC, p_controlar_desde INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado' USING errcode = '42501';
  END IF;
  IF p_umbral IS NULL OR p_umbral < 0.50 OR p_umbral > 1.00 THEN
    RAISE EXCEPTION 'El umbral tiene que estar entre 50 y 100' USING errcode = '22023';
  END IF;
  IF p_controlar_desde IS NULL OR p_controlar_desde < 1 THEN
    RAISE EXCEPTION 'El numero desde el que se controla tiene que ser 1 o mas' USING errcode = '22023';
  END IF;
  UPDATE public.remitos_ajustes
     SET umbral_confianza = p_umbral, controlar_desde = p_controlar_desde,
         updated_at = NOW(), updated_by = auth.uid()
   WHERE id = 1;
  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

-- 11) Permisos -------------------------------------------------------------------------------------
-- Cada grupo solo para quien lo usa: las de n8n para anon (con la clave), las del
-- panel para authenticated (con app_is_admin). El REVOKE nombra al otro rol porque
-- el ACL por defecto de PROD le da EXECUTE explicito a authenticated.
REVOKE ALL ON FUNCTION public.rpc_remitos_planificar(INT[], TEXT[]) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.rpc_remitos_registrar_escaneo(JSONB) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.rpc_remitos_registrar_pieza(JSONB) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.rpc_remitos_firmas_pendientes(INT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.rpc_remitos_guardar_firma(UUID, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.rpc_remitos_latido(TEXT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_planificar(INT[], TEXT[]) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_registrar_escaneo(JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_registrar_pieza(JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_firmas_pendientes(INT) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_guardar_firma(UUID, TEXT, NUMERIC, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_latido(TEXT) TO anon;

REVOKE ALL ON FUNCTION public.rpc_remitos_listar(TEXT, UUID, DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_salud() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_marcar(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_piezas(BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_buscar(INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_asignar_pieza(UUID, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_resolver_pieza(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_remitos_guardar_ajustes(NUMERIC, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_listar(TEXT, UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_salud() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_marcar(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_piezas(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_buscar(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_asignar_pieza(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_resolver_pieza(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_remitos_guardar_ajustes(NUMERIC, INT) TO authenticated;

-- Registro
DO $do$
BEGIN
  IF to_regprocedure('public.record_migration(text, text)') IS NOT NULL THEN
    PERFORM public.record_migration('116_remitos_firmados.sql');
  END IF;
END
$do$;

COMMIT;
