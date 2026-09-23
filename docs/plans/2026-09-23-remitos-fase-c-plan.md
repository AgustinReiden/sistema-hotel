# Remitos fase C: plan de implementación

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** que un remito de cuenta corriente sin firmar a las 48 h del check-out se vea como vencido, que la consolidada avise qué remitos faltan antes de emitir (y guarde el motivo si se emite igual), y que el admin pueda pedir el PDF con los remitos firmados de cada factura.

**Architecture:** la regla vive en la base (migración 124: ajustes, dos tablas cerradas y funciones `SECURITY DEFINER` como las de la 116). El panel `/admin/remitos` suma dos secciones en componentes propios (Vencidos y Paquetes) para no inflar `RemitosClient`. La consolidada consulta los faltantes antes de abrir el cuadro de revisión de F0-1 y el servidor los vuelve a controlar. El paquete lo arma un workflow nuevo de n8n con una función nueva del worker (`/unir`, con pdf-lib, que ya es dependencia).

**Tech Stack:** Next.js 16 (server actions), Supabase (PL/pgSQL, PostgREST), Vitest + Testing Library, Node 22 (`node --test`) para la automatización, n8n, pdf-lib.

**Diseño:** [`2026-09-23-remitos-fase-c-design.md`](2026-09-23-remitos-fase-c-design.md). **Reglas del repo:** las de [`2026-09-23-reorden-ux-plan.md`](2026-09-23-reorden-ux-plan.md) § "Reglas de este repo" valen acá sin excepción (rama por PR desde `origin/main`, nunca mergear, repo público, CRLF con la herramienta de edición, DDL con `exec_ddl` y OK de Agustín, deriva con PROD, tests por texto o `aria-label`).

---

## Mapa

| PR | Rama | Depende de | Migración | Qué |
|---|---|---|---|---|
| **C1** | `claude/remitos-vencidos` | — | **124** (entera) | Tareas 1-9: reglas puras, migración, vencidos en el panel, numerito, ajustes. |
| **C2** | `claude/remitos-aviso-consolidada` | C1 y **F0-1** mergeados | — | Tareas 10-14: faltantes al emitir, motivo, constancia. |
| **C3** | `claude/remitos-paquetes` | C1 mergeado | — | Tareas 15-22: `/unir`, workflow *Remitos - Paquetes*, sección Paquetes. |

C1 y C3 no tocan nada fuera de `src/app/admin/remitos/`, `src/lib/{remitos,data,types}.ts`, `src/app/admin/layout.tsx` (una línea) y `automatizaciones/remitos/`. C2 toca `src/app/admin/fiscal/consolidada/*` **después** de F0-1. Si hay conflictos con el reorden de UX, se resuelven al mergear (pedido de Agustín).

**Estilo (plan de UX, F5):** texto de 12 px como mínimo (`text-xs` o más; nada de `text-[11px]`), grises `slate-500` o más oscuros para texto, color principal `brand-700` en lo nuevo. Los componentes existentes del panel usan `emerald`: no se cambian en estos PRs.

---

# PR C1 · Vencidos

### Task 1: rama

```bash
git fetch origin
git switch -c claude/remitos-vencidos --no-track origin/main
```

### Task 2: tipos y reglas puras

**Files:**
- Modify: `src/lib/types.ts` (bloque `RemitosSalud`, cerca de la línea 1341)
- Modify: `src/lib/remitos.ts`
- Test: `src/__tests__/remitos.test.ts`

**Step 1: tipos.** En `RemitosSalud`, agregar al final:

```ts
  /** Remitos vencidos (mig 124): pasaron `horas_vencimiento` del check-out y no están firmados. */
  vencidos: number;
  /** Cuántos de los `a_revisar` también están vencidos (para no contarlos dos veces). */
  a_revisar_vencidos: number;
  horas_vencimiento: number;
  /** "AAAA-MM-DD": los cargos desde esa fecha (hora del hotel) pueden vencer. */
  alertar_desde: string;
```

**Step 2: tests que fallan.** En `src/__tests__/remitos.test.ts`, sumar al import `esVencido, motivoVencido, remitosParaRevisar, textoParaRevisar, textoVencidos, haceCuanto` y agregar:

```ts
describe("vencidos (mig 124)", () => {
  const AHORA = Date.parse("2026-09-28T15:00:00Z");
  const AJ = { horas_vencimiento: 48, alertar_desde: "2026-09-24" };
  const hace = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();

  it("vence a las 48 h si no está firmado ni marcado sin remito", () => {
    expect(esVencido(fila("sin_escanear", { created_at: hace(49) }), AJ, AHORA)).toBe(true);
    expect(esVencido(fila("sin_escanear", { created_at: hace(47) }), AJ, AHORA)).toBe(false);
    for (const e of ["evaluando", "a_revisar", "sin_firma"] as const) {
      expect(esVencido(fila(e, { created_at: hace(49) }), AJ, AHORA)).toBe(true);
    }
    expect(esVencido(fila("firmado", { created_at: hace(200) }), AJ, AHORA)).toBe(false);
    expect(esVencido(fila("sin_remito", { created_at: hace(200) }), AJ, AHORA)).toBe(false);
  });

  it("los cargos anteriores a alertar_desde no vencen", () => {
    // 2026-09-23 21:00 en Argentina es 2026-09-24 00:00 UTC: cuenta la fecha del hotel.
    expect(esVencido(fila("sin_escanear", { created_at: "2026-09-24T00:00:00Z" }), AJ, AHORA)).toBe(false);
    expect(esVencido(fila("sin_escanear", { created_at: "2026-09-24T03:30:00Z" }), AJ, AHORA)).toBe(true);
  });

  it("motivo del vencido en castellano", () => {
    expect(motivoVencido("sin_escanear")).toBe("sin escanear");
    expect(motivoVencido("evaluando")).toBe("la IA todavía no lo miró");
    expect(motivoVencido("a_revisar")).toBe("a revisar");
    expect(motivoVencido("sin_firma")).toBe("sin firma");
  });

  it("resumen de vencidos por motivo", () => {
    expect(textoVencidos([fila("sin_escanear"), fila("sin_escanear"), fila("sin_firma")])).toBe(
      "3 vencidos: 2 sin escanear · 1 sin firma"
    );
    expect(textoVencidos([fila("a_revisar")])).toBe("1 vencido: 1 a revisar");
  });

  it("para revisar: el menú y el panel dicen lo mismo, sin contar dos veces", () => {
    const s = { ...SALUD_BASE, a_revisar: 3, a_revisar_vencidos: 1, vencidos: 4, piezas_abiertas: 1 };
    expect(remitosParaRevisar(s)).toEqual({ remitos: 2, vencidos: 4, piezas: 1, total: 7 });
    expect(textoParaRevisar(remitosParaRevisar(s))).toBe("Para revisar: 2 remitos, 4 vencidos y 1 pieza");
    expect(textoParaRevisar({ remitos: 0, vencidos: 1, piezas: 0, total: 1 })).toBe("Para revisar: 1 vencido");
    expect(textoParaRevisar({ remitos: 0, vencidos: 0, piezas: 0, total: 0 })).toBeNull();
  });

  it("hace cuánto salió: horas hasta 3 días, después días", () => {
    expect(haceCuanto(hace(50), AHORA)).toBe("hace 50 h");
    expect(haceCuanto(hace(80), AHORA)).toBe("hace 3 días");
  });

  it("el semáforo del mes suma los vencidos", () => {
    const r = resumirRemitos([fila("firmado"), fila("sin_escanear")]);
    expect(textoSemaforo(r, 1)).toBe("2 remitos: 1 firmado · 1 sin escanear · 1 vencido");
    expect(textoSemaforo(r)).toBe("2 remitos: 1 firmado · 1 sin escanear");
  });
});
```

`SALUD_BASE` es el `RemitosSalud` que ya usa el archivo para `avisosSalud` (si no existe con ese nombre, usar el que haya), completado con los campos nuevos: `vencidos: 0, a_revisar_vencidos: 0, horas_vencimiento: 48, alertar_desde: "2026-09-24"`. Actualizar también los `RemitosSalud` literales del archivo para que compilen.

**Step 3: correr y ver que fallan.**

Run: `npx vitest run src/__tests__/remitos.test.ts`
Expected: FAIL (`esVencido is not a function`, etc.)

**Step 4: implementar** en `src/lib/remitos.ts`. Import nuevo: `import { hotelDateKey } from "./time";`.

```ts
// ─── Vencidos (mig 124) ────────────────────────────────────────────────────────

export type AjustesVencimiento = { horas_vencimiento: number; alertar_desde: string };

/**
 * Misma regla que app_remitos_vencido (mig 124): cargo desde `alertar_desde` (fecha
 * del hotel), pasaron `horas_vencimiento` corridas y no está firmado ni "sin remito".
 */
export function esVencido(
  row: Pick<RemitoPanelRow, "estado" | "created_at">,
  aj: AjustesVencimiento,
  ahoraMs: number
): boolean {
  if (row.estado === "firmado" || row.estado === "sin_remito") return false;
  if (hotelDateKey(row.created_at) < aj.alertar_desde) return false;
  return ahoraMs - Date.parse(row.created_at) >= aj.horas_vencimiento * 3_600_000;
}

const MOTIVO_VENCIDO: Partial<Record<RemitoEstado, string>> = {
  sin_escanear: "sin escanear",
  evaluando: "la IA todavía no lo miró",
  a_revisar: "a revisar",
  sin_firma: "sin firma",
};

export function motivoVencido(estado: RemitoEstado): string {
  return MOTIVO_VENCIDO[estado] ?? REMITO_ESTADO_LABEL[estado].toLowerCase();
}

export function textoVencidos(rows: Pick<RemitoPanelRow, "estado">[]): string {
  const cuenta = new Map<string, number>();
  for (const r of rows) {
    // En el resumen, "evaluando" a secas; la frase larga es para el renglón.
    const m = r.estado === "evaluando" ? "evaluando" : motivoVencido(r.estado);
    cuenta.set(m, (cuenta.get(m) ?? 0) + 1);
  }
  const partes = [...cuenta].map(([m, c]) => `${c} ${m}`);
  return `${rows.length} ${rows.length === 1 ? "vencido" : "vencidos"}: ${partes.join(" · ")}`;
}

export type ParaRevisar = { remitos: number; vencidos: number; piezas: number; total: number };

/**
 * Lo que cuenta el numerito del menú y lo que dice la línea "Para revisar" del
 * panel (regla de F1-2 del plan de UX: lo que dice el menú es lo que se ve al abrir).
 * Un remito a revisar que además venció se cuenta una sola vez, como vencido.
 */
export function remitosParaRevisar(s: RemitosSalud): ParaRevisar {
  const remitos = Math.max(0, s.a_revisar - s.a_revisar_vencidos);
  return { remitos, vencidos: s.vencidos, piezas: s.piezas_abiertas, total: remitos + s.vencidos + s.piezas_abiertas };
}

export function textoParaRevisar(p: ParaRevisar): string | null {
  const partes = [
    p.remitos > 0 ? `${p.remitos} ${p.remitos === 1 ? "remito" : "remitos"}` : null,
    p.vencidos > 0 ? `${p.vencidos} ${p.vencidos === 1 ? "vencido" : "vencidos"}` : null,
    p.piezas > 0 ? `${p.piezas} ${p.piezas === 1 ? "pieza" : "piezas"}` : null,
  ].filter((x): x is string => x !== null);
  if (partes.length === 0) return null;
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
  return `Para revisar: ${lista}`;
}

export function haceCuanto(iso: string, ahoraMs: number): string {
  const horas = Math.floor((ahoraMs - Date.parse(iso)) / 3_600_000);
  if (horas < 72) return `hace ${Math.max(0, horas)} h`;
  return haceDias(iso, ahoraMs);
}
```

Y `textoSemaforo` pasa a aceptar los vencidos del mes (segundo parámetro opcional, así el resto de las llamadas sigue igual):

```ts
export function textoSemaforo(r: ResumenRemitos, vencidos = 0): string {
  if (r.total === 0) return "No hay remitos en este período.";
  const partes = PARTES.filter((p) => r.porEstado[p.estado] > 0).map(
    (p) => `${r.porEstado[p.estado]} ${r.porEstado[p.estado] === 1 ? p.uno : p.varios}`
  );
  if (vencidos > 0) partes.push(`${vencidos} ${vencidos === 1 ? "vencido" : "vencidos"}`);
  return `${r.total} ${r.total === 1 ? "remito" : "remitos"}: ${partes.join(" · ")}`;
}
```

**Step 5: correr y ver que pasan.**

Run: `npx vitest run src/__tests__/remitos.test.ts`
Expected: PASS

**Step 6: commit**

```bash
git add src/lib/types.ts src/lib/remitos.ts src/__tests__/remitos.test.ts
git commit -m "Remitos: reglas de vencidos y de 'para revisar'"
```

### Task 3: migración 124

**Files:**
- Create: `supabase_migrations/124_remitos_fase_c.sql`
- Modify: `supabase_migrations/README.md` (sumar la línea de la 124 como las demás)

**Antes de escribir:** confirmar que `rpc_remitos_salud` de PROD es igual al archivo de la 116 (regla de deriva):

```sql
select md5(p.prosrc) from pg_proc p where p.proname = 'rpc_remitos_salud';
```

y comparar contra el md5 del cuerpo en `116_remitos_firmados.sql` (entre `AS $$` y `$$;`, con LF). Si difiere, partir de `select pg_get_functiondef('public.rpc_remitos_salud()'::regprocedure)`.

Contenido completo. **Los comentarios no llevan comillas** (se aplica por `exec_ddl`).

```sql
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
```

**Commit:**

```bash
git add supabase_migrations/124_remitos_fase_c.sql supabase_migrations/README.md
git commit -m "Remitos fase C: migración 124 (vencidos, constancia, paquetes)"
```

### Task 4: prueba en seco contra PROD (se deshace sola)

Igual que la Task 3.3 del plan de la 116: la migración entera sin `BEGIN;`/`COMMIT;`, con LF, más este bloque que termina en `RAISE EXCEPTION`. `exec_ddl` es atómico y no queda nada escrito. No hace falta OK, pero avisarle a Agustín antes.

Armar el payload con un script temporal **en el scratchpad** (nunca en `automatizaciones/remitos/salida/`: eslint lo revisa).

```sql
DO $prueba$
DECLARE
  v_admin UUID := (SELECT p.id FROM public.profiles p WHERE p.role = 'admin' ORDER BY p.created_at LIMIT 1);
  v_inv UUID;
  v_res UUID;
  v_mov UUID;
  v_num INT;
  v_e UUID;
  v_r JSONB := '{}'::jsonb;
  v_x JSONB;
  v_paq UUID;
  v_err TEXT;
BEGIN
  INSERT INTO public.remitos_privado (id, clave_hash)
  VALUES (1, extensions.digest('clave-de-prueba-0123456789-0123456789', 'sha256'))
  ON CONFLICT (id) DO UPDATE SET clave_hash = EXCLUDED.clave_hash;
  PERFORM set_config('request.headers', json_build_object('x-remitos-clave', 'clave-de-prueba-0123456789-0123456789')::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- Una consolidada vigente y el cargo de su primera estadia.
  SELECT i.id INTO v_inv FROM public.invoices i
   WHERE i.kind = 'consolidada' AND i.status = 'authorized' AND i.anulada_at IS NULL
   ORDER BY i.created_at DESC LIMIT 1;
  SELECT ir.reservation_id INTO v_res FROM public.invoice_reservations ir
   WHERE ir.invoice_id = v_inv AND ir.unlinked_at IS NULL ORDER BY ir.fch_desde LIMIT 1;
  SELECT m.id, m.remito_numero INTO v_mov, v_num FROM public.cuenta_corriente_movimientos m
   WHERE m.reservation_id = v_res AND m.tipo = 'cargo' LIMIT 1;

  -- Vencidos: con alertar_desde en julio, los cargos viejos sin firmar vencen.
  v_r := v_r || jsonb_build_object('01_salud_hoy', public.rpc_remitos_salud());
  PERFORM public.rpc_remitos_guardar_vencimiento(48, DATE '2026-07-01');
  v_r := v_r || jsonb_build_object('02_salud_julio', public.rpc_remitos_salud());
  BEGIN PERFORM public.rpc_remitos_guardar_vencimiento(0, DATE '2026-07-01'); v_err := 'no fallo';
  EXCEPTION WHEN others THEN v_err := SQLSTATE; END;
  v_r := v_r || jsonb_build_object('03_horas_0', v_err);

  -- Faltantes: el cargo viejo sin escaneo no cuenta; con un escaneo evaluando, si.
  v_r := v_r || jsonb_build_object('04_faltantes_sin_escaneo', public.rpc_remitos_faltantes(ARRAY[v_res]));
  v_x := public.rpc_remitos_registrar_escaneo(jsonb_build_object('numero', v_num, 'drive_file_id', 'f-prueba',
           'drive_link', 'l-prueba', 'hash_sha256', repeat('f', 64), 'ubicacion', '1.1'));
  v_e := (v_x ->> 'escaneo_id')::uuid;
  v_r := v_r || jsonb_build_object('05_faltantes_evaluando', public.rpc_remitos_faltantes(ARRAY[v_res]));

  -- Constancia: sin motivo falla; con motivo se guarda una sola vez.
  BEGIN PERFORM public.rpc_remitos_guardar_constancia(v_inv, ' '); v_err := 'no fallo';
  EXCEPTION WHEN others THEN v_err := SQLSTATE; END;
  v_r := v_r || jsonb_build_object('06_constancia_sin_motivo', v_err);
  v_r := v_r || jsonb_build_object('07_constancia', public.rpc_remitos_guardar_constancia(v_inv, 'el papel se perdio en el traslado'));
  v_r := v_r || jsonb_build_object('08_constancia_otra_vez', public.rpc_remitos_guardar_constancia(v_inv, 'otro motivo'),
                                   '08_filas', (SELECT count(*) FROM public.remito_constancias_factura k WHERE k.invoice_id = v_inv));

  -- Paquete: sin firmados falla; firmado por la IA se puede pedir.
  BEGIN PERFORM public.rpc_remitos_pedir_paquete(v_inv); v_err := 'no fallo';
  EXCEPTION WHEN others THEN v_err := SQLSTATE; END;
  v_r := v_r || jsonb_build_object('09_sin_firmados', v_err);
  PERFORM public.rpc_remitos_guardar_firma(v_e, 'si', 0.98, 'rubrica', 'modelo');
  v_r := v_r || jsonb_build_object('10_faltantes_firmado', public.rpc_remitos_faltantes(ARRAY[v_res]));
  v_x := public.rpc_remitos_pedir_paquete(v_inv);
  v_paq := (v_x ->> 'paquete_id')::uuid;
  v_r := v_r || jsonb_build_object('11_pedido', v_x);
  BEGIN PERFORM public.rpc_remitos_pedir_paquete(v_inv); v_err := 'no fallo';
  EXCEPTION WHEN others THEN v_err := SQLSTATE; END;
  v_r := v_r || jsonb_build_object('12_pedido_doble', v_err);
  v_r := v_r || jsonb_build_object('13_tomar', public.rpc_remitos_paquete_tomar());
  v_r := v_r || jsonb_build_object('14_tomar_vacio', public.rpc_remitos_paquete_tomar());
  v_r := v_r || jsonb_build_object('15_listo', public.rpc_remitos_paquete_listo(v_paq, 'f-paquete', 'l-paquete', 1));
  v_r := v_r || jsonb_build_object('16_listado', jsonb_path_query_array(
                   public.rpc_remitos_paquetes(
                     (SELECT CASE WHEN m.associated_client_id IS NOT NULL THEN 'company' ELSE 'guest' END FROM public.cuenta_corriente_movimientos m WHERE m.id = v_mov),
                     (SELECT COALESCE(m.associated_client_id, m.guest_id) FROM public.cuenta_corriente_movimientos m WHERE m.id = v_mov)),
                   '$[*] ? (@.invoice_id == $i)', jsonb_build_object('i', v_inv)));
  v_x := public.rpc_remitos_pedir_paquete(v_inv);
  v_r := v_r || jsonb_build_object('17_version_2', v_x ->> 'version');
  v_r := v_r || jsonb_build_object('18_error', public.rpc_remitos_paquete_error((v_x ->> 'paquete_id')::uuid, 'R-000001: el archivo de Drive no esta'),
                                   '18_estado', (SELECT p.estado FROM public.remito_paquetes p WHERE p.id = (v_x ->> 'paquete_id')::uuid));

  -- Permisos y clave.
  v_r := v_r || jsonb_build_object('19_permisos', jsonb_build_object(
    'auth_tomar', has_function_privilege('authenticated', 'public.rpc_remitos_paquete_tomar()', 'EXECUTE'),
    'anon_pedir', has_function_privilege('anon', 'public.rpc_remitos_pedir_paquete(uuid)', 'EXECUTE'),
    'auth_vencido', has_function_privilege('authenticated', 'public.app_remitos_vencido(timestamptz, text)', 'EXECUTE'),
    'anon_tomar', has_function_privilege('anon', 'public.rpc_remitos_paquete_tomar()', 'EXECUTE'),
    'auth_pedir', has_function_privilege('authenticated', 'public.rpc_remitos_pedir_paquete(uuid)', 'EXECUTE')));
  PERFORM set_config('request.headers', json_build_object('x-remitos-clave', 'otra-clave-0123456789-0123456789-xx')::text, true);
  BEGIN PERFORM public.rpc_remitos_paquete_tomar(); v_err := 'no fallo';
  EXCEPTION WHEN others THEN v_err := SQLSTATE; END;
  v_r := v_r || jsonb_build_object('20_clave_mala', v_err);
  RAISE EXCEPTION 'PRUEBA %', v_r::text;
END
$prueba$;
```

Llamar `select public.exec_ddl($m124$ <payload> $m124$)` por el MCP. **Esperado** (la respuesta es el error `PRUEBA {...}`):

| Paso | Esperado |
|---|---|
| `01` | Trae `vencidos`, `a_revisar_vencidos`, `horas_vencimiento: 48`, `alertar_desde: "2026-09-24"`. `vencidos` es 0 si todavía no hay cargos de más de 48 h desde el 24/09. |
| `02` | `vencidos` mayor que 0 (los cargos de julio en adelante sin firmar). |
| `03` | `22023` |
| `04` | `[]` si el cargo es anterior a `controlar_desde` y no tiene escaneo. |
| `05` | Un faltante con ese número y `estado: evaluando`. |
| `06` | `P0074` |
| `07` | `guardada: true` y `faltantes` ≥ 1. |
| `08` | `guardada: true` y una sola fila. |
| `09` | `P0072` si la factura no tenía ningún remito firmado; si ya tenía, `no fallo` (y en `11` hay que descontar ese paquete de la cuenta de versiones). |
| `10` | `[]` (ya firmado). |
| `11` | `version: 1` (o 2 si `09` no falló), `remitos` ≥ 1, `total` ≥ 1. |
| `12` | `P0071` |
| `13` | `paquete_id`, `factura_texto` tipo `FB 00008-000…`, `cliente` y `escaneos` con `drive_file_id: f-prueba`. |
| `14` | `{}` |
| `15` | `ok` |
| `16` | Una fila con `remitos_firmados` ≥ 1, la constancia, el paquete `listo` y `firmados_nuevos: 0`. |
| `17` | La versión siguiente a la de `11`. |
| `18` | `cambio: true`, estado `error` |
| `19` | `auth_tomar`, `anon_pedir` y `auth_vencido` en `false`; `anon_tomar` y `auth_pedir` en `true`. |
| `20` | `42501` |

Si algo no da: corregir el SQL, commit nuevo y repetir. Al final confirmar que no quedó nada: `select to_regclass('public.remito_paquetes')` → `null`.

### Task 5: datos y layout

**Files:**
- Modify: `src/lib/data.ts` (bloque "Remitos firmados (mig 116)", ~4764)
- Modify: `src/app/admin/layout.tsx:82-90`
- Modify: `src/app/admin/remitos/page.tsx` (`SALUD_VACIA`)

**Step 1:** en `getRemitosSalud`, sumar al objeto devuelto:

```ts
    vencidos: Number(r.vencidos) || 0,
    a_revisar_vencidos: Number(r.a_revisar_vencidos) || 0,
    horas_vencimiento: Number(r.horas_vencimiento) || 48,
    alertar_desde: strOrNull(r.alertar_desde) ?? "2026-09-24",
```

**Step 2:** debajo de `saveRemitosAjustes`, agregar:

```ts
export async function saveRemitosVencimiento(horas: number, alertarDesde: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_remitos_guardar_vencimiento", {
    p_horas: horas,
    p_alertar_desde: alertarDesde,
  });
  if (error) throw error;
}
```

**Step 3:** en `layout.tsx`, el numerito pasa a salir del helper (import `remitosParaRevisar` de `@/lib/remitos`):

```ts
getRemitosSalud()
  .then((s) => remitosParaRevisar(s).total)
```

(el resto de esa llamada queda igual, con su `.catch(() => 0)`).

**Step 4:** en `page.tsx`, completar `SALUD_VACIA` con `vencidos: 0, a_revisar_vencidos: 0, horas_vencimiento: 48, alertar_desde: "2026-09-24"`.

**Step 5:** `npm run typecheck`. Expected: los únicos errores son los `RemitosSalud` literales de `RemitosClient.test.tsx` (se arreglan en la Task 7).

**Step 6: commit**

```bash
git add src/lib/data.ts src/app/admin/layout.tsx src/app/admin/remitos/page.tsx
git commit -m "Remitos: la salud trae los vencidos y el numerito los cuenta"
```

### Task 6: ajustes de vencimiento

**Files:**
- Modify: `src/app/admin/remitos/actions.ts` (`saveRemitosAjustesAction`)

**Step 1:** reemplazar `saveRemitosAjustesAction` (importar `saveRemitosVencimiento` de `@/lib/data` y `DATE_KEY` de `@/lib/date-range`):

```ts
export async function saveRemitosAjustesAction(
  umbralPct: number,
  controlarDesde: number,
  horasVencimiento: number,
  alertarDesde: string
): Promise<ActionResult> {
  if (!Number.isFinite(umbralPct) || umbralPct < 50 || umbralPct > 100) {
    return { success: false, error: "El umbral tiene que estar entre 50 y 100." };
  }
  if (!numeroValido(controlarDesde)) return { success: false, error: "Número de remito inválido." };
  if (!Number.isInteger(horasVencimiento) || horasVencimiento < 1 || horasVencimiento > 720) {
    return { success: false, error: "Las horas para vencer tienen que estar entre 1 y 720." };
  }
  if (!DATE_KEY.test(alertarDesde)) return { success: false, error: "Fecha inválida." };
  try {
    await assertRemitosAdmin();
    await saveRemitosAjustes(Math.round(umbralPct) / 100, controlarDesde);
    await saveRemitosVencimiento(horasVencimiento, alertarDesde);
    revalidar();
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudieron guardar los ajustes.") };
  }
}
```

**Step 2: commit** (junto con la Task 7, que es quien la llama).

### Task 7: sección Vencidos y línea "Para revisar"

**Files:**
- Create: `src/app/admin/remitos/VencidosSection.tsx`
- Create: `src/app/admin/remitos/VencidosSection.test.tsx`
- Modify: `src/app/admin/remitos/RemitosClient.tsx`
- Modify: `src/app/admin/remitos/RemitosClient.test.tsx`
- Modify: `src/app/admin/remitos/page.tsx`

**Step 1: test del componente (falla).**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import VencidosSection from "./VencidosSection";
import type { RemitoEstado, RemitoPanelRow } from "@/lib/types";

const AHORA = Date.parse("2026-09-28T15:00:00Z");
const fila = (numero: number, estado: RemitoEstado, horas: number): RemitoPanelRow => ({
  movimiento_id: `m${numero}`, remito_numero: numero, created_at: new Date(AHORA - horas * 3_600_000).toISOString(),
  amount: 50000, client_kind: "company", client_id: "c1", cliente: "Empresa de prueba", room_number: "4",
  pasajero: "Pasajero", estado, decidido_por: null, decidido_por_nombre: null, estado_at: null, nota: null,
  escaneo_version: estado === "sin_escanear" ? null : 1,
  escaneo_link: estado === "sin_escanear" ? null : "https://example.test/x",
  escaneo_origen: estado === "sin_escanear" ? null : "qr",
  firma_ia: null, firma_ia_confianza: null, firma_ia_observacion: null,
});

describe("VencidosSection", () => {
  it("no muestra nada si no hay vencidos", () => {
    const { container } = render(<VencidosSection rows={[]} horas={48} nowMs={AHORA} renderAcciones={() => null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lista cada vencido con su motivo, hace cuánto salió y sus acciones", () => {
    render(
      <VencidosSection
        rows={[fila(163, "sin_escanear", 50), fila(170, "sin_firma", 90)]}
        horas={48}
        nowMs={AHORA}
        renderAcciones={(r) => <button type="button">Acción {r.remito_numero}</button>}
      />
    );
    expect(screen.getByText("Vencidos (2)")).toBeInTheDocument();
    expect(screen.getByText("2 vencidos: 1 sin escanear · 1 sin firma")).toBeInTheDocument();
    expect(screen.getByText("R-000163")).toBeInTheDocument();
    expect(screen.getByText(/hace 50 h/)).toBeInTheDocument();
    expect(screen.getByText(/hace 3 días/)).toBeInTheDocument();
    expect(screen.getByText("Acción 170")).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/app/admin/remitos/VencidosSection.test.tsx` → FAIL (no existe el módulo).

**Step 2: componente.**

```tsx
"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { formatAmount } from "@/lib/format";
import { haceCuanto, motivoVencido, numeroRemitoVisible, textoVencidos } from "@/lib/remitos";
import type { RemitoPanelRow } from "@/lib/types";

type Props = {
  rows: RemitoPanelRow[];
  horas: number;
  nowMs: number;
  /** Las mismas acciones que el resto del panel (vienen de RemitosClient). */
  renderAcciones: (r: RemitoPanelRow) => ReactNode;
};

/**
 * Remitos que a las `horas` del check-out no están firmados (mig 124). No depende del
 * mes elegido: un vencido de otro mes sigue siendo un problema de hoy.
 */
export default function VencidosSection({ rows, horas, nowMs, renderAcciones }: Props) {
  if (rows.length === 0) return null;
  return (
    <section className="bg-white border border-rose-200 rounded-xl" aria-label="Remitos vencidos">
      <div className="px-4 py-3 border-b border-rose-100">
        <h2 className="text-sm font-bold text-rose-800 flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          {`Vencidos (${rows.length})`}
        </h2>
        <p className="text-xs text-slate-600 mt-0.5">
          Pasaron más de {horas} h del check-out y el remito no está firmado.
        </p>
        <p className="text-sm font-semibold text-slate-700 mt-1">{textoVencidos(rows)}</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.movimiento_id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm">
                <span className="font-mono font-semibold">{numeroRemitoVisible(r.remito_numero)}</span>
                <span className="text-slate-600">
                  {" · "}
                  {r.cliente}
                  {r.room_number ? ` · Hab. ${r.room_number}` : ""}
                  {" · "}
                  {formatAmount(r.amount)}
                </span>
              </p>
              <p className="text-xs text-slate-600">
                Salió {haceCuanto(r.created_at, nowMs)} · <span className="font-semibold text-rose-700">{motivoVencido(r.estado)}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {r.escaneo_link && (
                <a
                  href={r.escaneo_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline mr-1"
                >
                  Ver <ExternalLink size={12} />
                </a>
              )}
              {renderAcciones(r)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Run el test → PASS.

**Step 3: RemitosClient.** Cambios puntuales (no reordenar el resto: F1-2 también toca este archivo):
- Props: `vencidos?: RemitoPanelRow[]` (default `[]`).
- Import `VencidosSection` y de `@/lib/remitos`: `esVencido`, `remitosParaRevisar`, `textoParaRevisar`.
- Estado de ajustes: `const [horasTexto, setHorasTexto] = useState(String(salud.horas_vencimiento));` y `const [alertarDesde, setAlertarDesde] = useState(salud.alertar_desde);`.
- `guardarAjustes`: `saveRemitosAjustesAction(Number(umbralPct), Number(desdeTexto), Number(horasTexto), alertarDesde)`.
- Vencidos del mes para el semáforo: `const vencidosDelMes = useMemo(() => rows.filter((r) => esVencido(r, salud, nowMs)).length, [rows, salud, nowMs]);` y `textoSemaforo(resumen, vencidosDelMes)`.
- Justo antes del `<p data-testid="semaforo">`, la línea de F1-2:

```tsx
{textoParaRevisar(remitosParaRevisar(salud)) && (
  <p className="text-sm font-semibold text-rose-800" data-testid="para-revisar">
    {textoParaRevisar(remitosParaRevisar(salud))}
  </p>
)}
```

- Justo después de los avisos de salud (antes de esa línea), la sección:

```tsx
<VencidosSection rows={vencidos} horas={salud.horas_vencimiento} nowMs={nowMs} renderAcciones={accionesDe} />
```

- En el modal "Ajustes de remitos", después del campo de "controlar desde", dos campos más (mismo estilo que los existentes, `inputClass`):

```tsx
<div>
  <label htmlFor="ajuste-horas" className="block text-sm font-semibold text-slate-700 mb-1.5">
    Horas para que un remito venza
  </label>
  <input id="ajuste-horas" type="number" min={1} max={720} value={horasTexto}
    onChange={(e) => setHorasTexto(e.target.value)} className={`${inputClass} w-full`} />
  <p className="text-xs text-slate-600 mt-1">Desde el check-out. Si no está firmado a esa altura, aparece en Vencidos.</p>
</div>
<div>
  <label htmlFor="ajuste-alertar" className="block text-sm font-semibold text-slate-700 mb-1.5">
    Alertar desde
  </label>
  <input id="ajuste-alertar" type="date" value={alertarDesde}
    onChange={(e) => setAlertarDesde(e.target.value)} className={`${inputClass} w-full`} />
  <p className="text-xs text-slate-600 mt-1">Los cargos anteriores a esta fecha nunca vencen.</p>
</div>
```

**Step 4: tests de RemitosClient.** Completar `SALUD` con `vencidos: 0, a_revisar_vencidos: 0, horas_vencimiento: 48, alertar_desde: "2026-09-24"`. Agregar:

```tsx
it("la línea 'para revisar' dice lo mismo que el numerito del menú", () => {
  renderPanel({ salud: { ...SALUD, a_revisar: 2, a_revisar_vencidos: 1, vencidos: 3, piezas_abiertas: 1 } });
  expect(screen.getByTestId("para-revisar")).toHaveTextContent("Para revisar: 1 remito, 3 vencidos y 1 pieza");
});

it("muestra los vencidos con sus acciones", () => {
  renderPanel({ vencidos: [fila("sin_escanear", { created_at: "2026-09-19T12:00:00Z" })] });
  expect(screen.getByText("Vencidos (1)")).toBeInTheDocument();
  expect(screen.getByText("Sin remito")).toBeInTheDocument();
});

it("los ajustes mandan horas y fecha", async () => {
  saveRemitosAjustesAction.mockResolvedValue({ success: true });
  renderPanel();
  fireEvent.click(screen.getByText("Ajustes"));
  fireEvent.change(screen.getByLabelText("Horas para que un remito venza"), { target: { value: "72" } });
  fireEvent.click(screen.getByText("Guardar"));
  await waitFor(() => expect(saveRemitosAjustesAction).toHaveBeenCalledWith(95, 151, 72, "2026-09-24"));
});
```

(Usar el texto real del botón de guardar del modal; si no es "Guardar", ajustar.)

**Step 5: page.tsx.** Después del `Promise.all`, cargar los vencidos solo si hay (no cuesta nada cuando no hay):

```ts
const hoyKey = hotelDateKey(ahora);
const vencidos =
  salud.vencidos > 0
    ? (await cargar(listRemitos(salud.alertar_desde, hoyKey), [], "los remitos vencidos"))
        .filter((r) => esVencido(r, salud, ahora.getTime()))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    : [];
```

(import `esVencido` de `@/lib/remitos`) y pasar `vencidos={vencidos}` a `RemitosClient`.

**Step 6:** `npx vitest run src/app/admin/remitos src/__tests__/remitos.test.ts` → PASS.

**Step 7: commit**

```bash
git add src/app/admin/remitos
git commit -m "Remitos: sección Vencidos, línea 'para revisar' y ajustes de vencimiento"
```

### Task 8: verificación local y PR

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Todo en verde. Push y PR (cuerpo: qué cambia, que **la 124 se aplica antes del deploy** con OK, y la verificación). Termina con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

### Task 9: aplicar la 124 y verificar (👤 OK de Agustín)

1. 👤 **AGUSTÍN:** OK explícito para aplicar la 124. Va **antes** de mergear C1 (sin la 124, el Ajustes de C1 falla con "function not found"; el resto sigue andando porque la salud vieja no trae vencidos y el numerito queda como hoy).
2. Aplicar con `select public.exec_ddl($m124$ ... $m124$)` sin `BEGIN;`/`COMMIT;` ni `;` final. Si el payload es muy largo para una llamada, partirlo como la 116 (tablas; ayudantes y salud; panel; n8n y permisos y registro), **en ese orden**.
3. Verificar:
   - `select filename from public.applied_migrations where filename = '124_remitos_fase_c.sql'` → una fila.
   - md5 de `prosrc` de las 12 funciones contra el archivo (script en el scratchpad, como con la 116).
   - Los cinco `has_function_privilege` del paso `19` de la prueba en seco, ahora de verdad.
   - `select horas_vencimiento, alertar_desde from public.remitos_ajustes` → `48`, `2026-09-24`.
4. 👤 **AGUSTÍN:** mergear C1. Después del deploy: abrir `/admin/remitos`. Sin vencidos, no aparece la sección ni cambia el numerito. Desde el 26/09, un remito del 24/09 sin firmar tiene que aparecer en Vencidos.

---

# PR C2 · Aviso en la consolidada

**Arranca cuando C1 y F0-1 estén mergeados.** Confirmar antes:

```bash
git fetch origin
git ls-tree --name-only origin/main src/app/admin/fiscal/consolidada/ | grep ConsolidadaConfirmModal
```

Si no aparece, F0-1 no está: frenar y avisar. Las líneas de `ConsolidadaClient.tsx` que se citan abajo son de antes de F0-1: volver a ubicarlas.

### Task 10: rama, tipos y reglas

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/remitos.ts`, `src/__tests__/remitos.test.ts`

```bash
git switch -c claude/remitos-aviso-consolidada --no-track origin/main
```

**Tipos** (junto a los de remitos, y en `ConsolidatedInvoicePayload`):

```ts
export type RemitoFaltante = {
  movimiento_id: string;
  reservation_id: string;
  remito_numero: number;
  estado: RemitoEstado;
};
```

```ts
  /** Motivo para emitir con remitos faltantes (mig 124). Obligatorio si faltan. */
  motivoRemitos?: string;
```

**Test (falla):**

```ts
describe("faltantes al facturar", () => {
  it("texto con número y estado de cada uno", () => {
    expect(textoFaltantes([
      { movimiento_id: "a", reservation_id: "r1", remito_numero: 163, estado: "sin_escanear" },
      { movimiento_id: "b", reservation_id: "r2", remito_numero: 170, estado: "sin_firma" },
    ])).toBe("Faltan 2 remitos firmados: R-000163 (sin escanear) · R-000170 (sin firma)");
    expect(textoFaltantes([{ movimiento_id: "a", reservation_id: "r1", remito_numero: 9, estado: "a_revisar" }]))
      .toBe("Falta 1 remito firmado: R-000009 (a revisar)");
  });

  it("el motivo tiene que decir algo", () => {
    expect(motivoRemitosValido("  ")).toBe(false);
    expect(motivoRemitosValido("ok")).toBe(false);
    expect(motivoRemitosValido("se perdió")).toBe(true);
  });
});
```

**Implementación** en `src/lib/remitos.ts`:

```ts
export function textoFaltantes(f: RemitoFaltante[]): string {
  const lista = f
    .map((x) => `${numeroRemitoVisible(x.remito_numero)} (${REMITO_ESTADO_LABEL[x.estado].toLowerCase()})`)
    .join(" · ");
  return f.length === 1 ? `Falta 1 remito firmado: ${lista}` : `Faltan ${f.length} remitos firmados: ${lista}`;
}

/** Mismo mínimo que rpc_remitos_guardar_constancia (3 letras). */
export function motivoRemitosValido(m: string | undefined | null): boolean {
  return (m ?? "").trim().length >= 3;
}
```

Run → PASS. Commit: `Remitos: texto de faltantes al facturar`.

### Task 11: datos

**Files:** Modify `src/lib/data.ts` (bloque de remitos)

```ts
/** Remitos controlados de esas estadías que no están firmados (mig 124). */
export async function listRemitosFaltantes(reservationIds: string[]): Promise<RemitoFaltante[]> {
  if (reservationIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_remitos_faltantes", { p_reservation_ids: reservationIds });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    movimiento_id: String(f.movimiento_id),
    reservation_id: String(f.reservation_id),
    remito_numero: Number(f.remito_numero),
    estado: f.estado as RemitoFaltante["estado"],
  }));
}

export async function saveRemitoConstancia(invoiceId: string, motivo: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_remitos_guardar_constancia", {
    p_invoice_id: invoiceId,
    p_motivo: motivo,
  });
  if (error) throw error;
}
```

Commit con la Task 12.

### Task 12: el servidor controla y guarda la constancia antes de ARCA

**Files:**
- Modify: `src/app/admin/fiscal/consolidada/actions.ts`
- Create: `src/__tests__/consolidada-remitos.test.ts`

**Step 1: test (falla).**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const listRemitosFaltantes = vi.fn();
const saveRemitoConstancia = vi.fn();
const createConsolidatedInvoiceDraft = vi.fn();
const emitInvoice = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data", () => ({
  listRemitosFaltantes: (...a: unknown[]) => listRemitosFaltantes(...a),
  saveRemitoConstancia: (...a: unknown[]) => saveRemitoConstancia(...a),
  createConsolidatedInvoiceDraft: (...a: unknown[]) => createConsolidatedInvoiceDraft(...a),
  listCcAccountStays: vi.fn(),
}));
vi.mock("@/lib/arca/emitter", () => ({ emitInvoice: (...a: unknown[]) => emitInvoice(...a) }));

import { emitConsolidatedInvoiceAction } from "@/app/admin/fiscal/consolidada/actions";

const PAYLOAD = { kind: "company" as const, clientId: "c1", reservationIds: ["r1", "r2"] };
const FALTA = [{ movimiento_id: "m1", reservation_id: "r1", remito_numero: 163, estado: "sin_escanear" }];

describe("consolidada y remitos faltantes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createConsolidatedInvoiceDraft.mockResolvedValue({ invoiceId: "inv1", impTotal: 1, count: 2, cbteTipo: 1 });
    emitInvoice.mockResolvedValue({ status: "authorized", invoiceId: "inv1" });
  });

  it("sin faltantes emite como siempre y no guarda constancia", async () => {
    listRemitosFaltantes.mockResolvedValue([]);
    const r = await emitConsolidatedInvoiceAction(PAYLOAD);
    expect(r.success).toBe(true);
    expect(saveRemitoConstancia).not.toHaveBeenCalled();
    expect(emitInvoice).toHaveBeenCalledWith("inv1");
  });

  it("con faltantes y sin motivo no crea nada", async () => {
    listRemitosFaltantes.mockResolvedValue(FALTA);
    const r = await emitConsolidatedInvoiceAction(PAYLOAD);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("R-000163");
    expect(createConsolidatedInvoiceDraft).not.toHaveBeenCalled();
    expect(emitInvoice).not.toHaveBeenCalled();
  });

  it("con faltantes y motivo guarda la constancia ANTES de mandar a ARCA", async () => {
    listRemitosFaltantes.mockResolvedValue(FALTA);
    const orden: string[] = [];
    saveRemitoConstancia.mockImplementation(async () => { orden.push("constancia"); });
    emitInvoice.mockImplementation(async () => { orden.push("arca"); return { status: "authorized", invoiceId: "inv1" }; });
    const r = await emitConsolidatedInvoiceAction({ ...PAYLOAD, motivoRemitos: "se perdió en el traslado" });
    expect(r.success).toBe(true);
    expect(saveRemitoConstancia).toHaveBeenCalledWith("inv1", "se perdió en el traslado");
    expect(orden).toEqual(["constancia", "arca"]);
  });

  it("si la constancia no se guarda, no manda a ARCA", async () => {
    listRemitosFaltantes.mockResolvedValue(FALTA);
    saveRemitoConstancia.mockRejectedValue(new Error("boom"));
    const r = await emitConsolidatedInvoiceAction({ ...PAYLOAD, motivoRemitos: "se perdió" });
    expect(r.success).toBe(false);
    expect(emitInvoice).not.toHaveBeenCalled();
  });

  it("si no se pueden revisar los remitos, la factura sale igual (los remitos no frenan la facturación)", async () => {
    listRemitosFaltantes.mockRejectedValue(new Error("rpc caída"));
    const r = await emitConsolidatedInvoiceAction(PAYLOAD);
    expect(r.success).toBe(true);
    expect(emitInvoice).toHaveBeenCalled();
  });
});
```

La última regla sale del diseño general (§6.6): si la parte de remitos falla, el resto del sistema sigue igual. El control existe para no facturar **sin enterarse**; si no se pudo mirar, la pantalla ya lo dijo (Task 13).

Run: `npx vitest run src/__tests__/consolidada-remitos.test.ts` → FAIL.

**Step 2: implementación.** En `actions.ts`, importar `listRemitosFaltantes`, `saveRemitoConstancia` de `@/lib/data`, `motivoRemitosValido`, `textoFaltantes` de `@/lib/remitos` y `RemitoFaltante` de los tipos. Nueva acción para la pantalla:

```ts
/** Remitos que faltan firmar en esas estadías. La pantalla lo muestra antes de emitir. */
export async function remitosFaltantesAction(reservationIds: string[]): Promise<ActionResult<RemitoFaltante[]>> {
  try {
    return { success: true, data: await listRemitosFaltantes(reservationIds) };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudieron revisar los remitos.") };
  }
}
```

Y `emitConsolidatedInvoiceAction` queda:

```ts
export async function emitConsolidatedInvoiceAction(
  payload: ConsolidatedInvoicePayload
): Promise<ActionResult<EmitInvoiceOutcome & { count: number }>> {
  // El servidor no confía en lo que vio la pantalla: vuelve a mirar los remitos.
  // Si no se puede mirar, la factura sale igual (los remitos nunca frenan la
  // facturación, diseño general §6.6); la pantalla ya avisó que no pudo revisar.
  let faltantes: RemitoFaltante[] = [];
  try {
    faltantes = await listRemitosFaltantes(payload.reservationIds);
  } catch (error: unknown) {
    console.error("[consolidada] no se pudieron revisar los remitos:", error);
  }
  const motivo = payload.motivoRemitos?.trim() ?? "";
  if (faltantes.length > 0 && !motivoRemitosValido(motivo)) {
    return { success: false, error: `${textoFaltantes(faltantes)}. Escribí el motivo para emitir igual.` };
  }

  try {
    const draft = await createConsolidatedInvoiceDraft(payload);
    if (faltantes.length > 0) {
      try {
        await saveRemitoConstancia(draft.invoiceId, motivo);
      } catch (error: unknown) {
        console.error("[consolidada] no se guardó la constancia de remitos:", error);
        revalidateFiscalViews();
        return {
          success: false,
          error:
            "No se pudo guardar el motivo de los remitos faltantes, así que la factura NO se mandó a ARCA: quedó pendiente. Reintentala o descartala desde Facturación.",
        };
      }
    }
    const outcome = await emitInvoice(draft.invoiceId);
    revalidateFiscalViews();
    return { success: true, data: { ...outcome, count: draft.count } };
  } catch (error: unknown) {
    // (el catch que ya existe, sin cambios: 23505 → mensaje accionable)
  }
}
```

Run → PASS. Commit:

```bash
git add src/lib/data.ts src/app/admin/fiscal/consolidada/actions.ts src/__tests__/consolidada-remitos.test.ts
git commit -m "Consolidada: con remitos faltantes pide motivo y lo guarda antes de ARCA"
```

### Task 13: el aviso dentro de "Revisá antes de emitir"

**Files:**
- Modify: `src/app/admin/fiscal/consolidada/ConsolidadaConfirmModal.tsx` (lo crea F0-1)
- Modify: `src/app/admin/fiscal/consolidada/ConsolidadaClient.tsx`
- Modify: `src/app/admin/fiscal/consolidada/ConsolidadaClient.test.tsx`

**Step 1: tests (fallan).** En el mock de `./actions` agregar `remitosFaltantesAction` con default `mockResolvedValue({ success: true, data: [] })` en el `beforeEach` (si no, los tests de F0-1 que abren el cuadro se rompen). Tests nuevos:

```tsx
it("con remitos faltantes, el cuadro los lista y pide motivo para confirmar", async () => {
  remitosFaltantesAction.mockResolvedValue({
    success: true,
    data: [{ movimiento_id: "m1", reservation_id: "r1", remito_numero: 163, estado: "sin_escanear" }],
  });
  // …seleccionar estadías y apretar "Revisar y emitir factura consolidada" como en los tests de F0-1
  expect(await screen.findByText(/Falta 1 remito firmado: R-000163 \(sin escanear\)/)).toBeInTheDocument();
  expect(screen.getByText("Confirmar y emitir en ARCA").closest("button")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Motivo para emitir igual"), { target: { value: "se perdió en el traslado" } });
  expect(screen.getByText("Confirmar y emitir en ARCA").closest("button")).toBeEnabled();
  fireEvent.click(screen.getByText("Confirmar y emitir en ARCA"));
  await waitFor(() => expect(payloadEmitido().motivoRemitos).toBe("se perdió en el traslado"));
});

it("sin faltantes el cuadro queda como siempre", async () => {
  // default: data []
  // …abrir el cuadro
  expect(screen.queryByLabelText("Motivo para emitir igual")).not.toBeInTheDocument();
});

it("si no se pudieron revisar los remitos, lo dice y deja confirmar", async () => {
  remitosFaltantesAction.mockResolvedValue({ success: false, error: "x" });
  // …abrir el cuadro
  expect(await screen.findByText(/No se pudieron revisar los remitos/)).toBeInTheDocument();
  expect(screen.getByText("Confirmar y emitir en ARCA").closest("button")).toBeEnabled();
});
```

**Step 2: ConsolidadaClient.** Estado nuevo:

```ts
/** null = no se pudo revisar; [] = están todos firmados (o no se controlan). */
const [faltantesRemitos, setFaltantesRemitos] = useState<RemitoFaltante[] | null>([]);
const [motivoRemitos, setMotivoRemitos] = useState("");
```

En `revisar()` (F0-1), después de sus validaciones y **antes** de abrir el cuadro:

```ts
const rf = await remitosFaltantesAction(selectedRows.map((r) => r.reservation_id));
setFaltantesRemitos(rf.success ? rf.data ?? [] : null);
setMotivoRemitos("");
```

En `emitConfirmado()`, al armar el payload: `...(faltantesRemitos && faltantesRemitos.length > 0 ? { motivoRemitos: motivoRemitos.trim() } : {})`.

Al cuadro: `faltantesRemitos`, `motivoRemitos`, `onMotivoRemitos={setMotivoRemitos}`.

**Step 3: ConsolidadaConfirmModal.** Props nuevas (`faltantesRemitos: RemitoFaltante[] | null`, `motivoRemitos: string`, `onMotivoRemitos: (v: string) => void`). Arriba del botón de confirmar:

```tsx
{faltantesRemitos === null && (
  <div role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
    No se pudieron revisar los remitos de estas estadías. Podés emitir igual; revisalos después en Remitos firmados.
  </div>
)}
{faltantesRemitos && faltantesRemitos.length > 0 && (
  <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
    <p className="text-sm font-semibold text-amber-900">{textoFaltantes(faltantesRemitos)}</p>
    <label htmlFor="motivo-remitos" className="block text-sm font-semibold text-slate-700">
      Motivo para emitir igual
    </label>
    <textarea
      id="motivo-remitos"
      value={motivoRemitos}
      onChange={(e) => onMotivoRemitos(e.target.value)}
      maxLength={500}
      rows={2}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
      placeholder="Por ejemplo: el papel se perdió y la empresa aceptó facturar igual"
    />
    <p className="text-xs text-slate-600">Queda guardado con la factura, con tu usuario y la fecha.</p>
  </div>
)}
```

Y el botón de confirmar suma a su `disabled`: `|| (faltantesRemitos !== null && faltantesRemitos.length > 0 && !motivoRemitosValido(motivoRemitos))`.

**Step 4:** `npx vitest run src/app/admin/fiscal/consolidada` → PASS (los de F0-1 también).

**Step 5: commit**

```bash
git add src/app/admin/fiscal/consolidada src/lib/types.ts
git commit -m "Consolidada: el cuadro de revisión avisa los remitos faltantes y pide motivo"
```

### Task 14: verificación, PR y prueba en PROD sin facturar

1. `npm run lint && npm run typecheck && npm test && npm run build` en verde. PR con el cuerpo de siempre.
2. 👤 **AGUSTÍN:** mergear.
3. Después del deploy, **sin emitir**: Facturación → Por facturar → "Facturar consolidada" de un cliente con un remito controlado sin firmar → "Revisar y emitir". Tiene que aparecer "Falta… R-00…", el botón deshabilitado hasta escribir el motivo, y **"Volver"** cierra sin emitir.
4. `select count(*) from public.remito_constancias_factura` → 0 (abrir y cerrar el cuadro no guarda nada).

---

# PR C3 · Paquetes

### Task 15: rama y `/unir` en el worker

**Files:**
- Create: `automatizaciones/remitos/worker/unir.mjs`
- Modify: `automatizaciones/remitos/worker/servidor.mjs`
- Test: `automatizaciones/remitos/test/unir.test.mjs`, `automatizaciones/remitos/test/servidor.test.mjs`

```bash
git switch -c claude/remitos-paquetes --no-track origin/main
```

**Step 1: test (falla).** `test/unir.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { unirPdfs, ErrorUnir } from "../worker/unir.mjs";

async function pdfDe(paginas) {
  const d = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) d.addPage([200, 300]);
  return Buffer.from(await d.save()).toString("base64");
}

test("une en el orden recibido y cuenta las páginas", async () => {
  const r = await unirPdfs([{ nombre: "R-000001", pdf_b64: await pdfDe(1) }, { nombre: "R-000002", pdf_b64: await pdfDe(2) }]);
  assert.equal(r.paginas, 3);
  const doc = await PDFDocument.load(Buffer.from(r.pdf_b64, "base64"));
  assert.equal(doc.getPageCount(), 3);
});

test("sin archivos: error claro", async () => {
  await assert.rejects(unirPdfs([]), (e) => e instanceof ErrorUnir && e.codigo === "sin_archivos");
});

test("un archivo que no es PDF corta todo y dice cuál", async () => {
  await assert.rejects(
    unirPdfs([{ nombre: "R-000001", pdf_b64: await pdfDe(1) }, { nombre: "R-000002", pdf_b64: Buffer.from("hola").toString("base64") }]),
    (e) => e instanceof ErrorUnir && e.codigo === "pdf_invalido" && e.message.includes("R-000002")
  );
});
```

Run: `cd automatizaciones/remitos && node --test test/unir.test.mjs` → FAIL.

**Step 2:** `worker/unir.mjs`:

```js
// Une los PDF de un paquete de remitos, en el orden en que llegan. Si uno no es un
// PDF valido, no devuelve nada: un paquete a medias es peor que ninguno.

import { PDFDocument } from "pdf-lib";

export class ErrorUnir extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/** @param {{ nombre?: string, pdf_b64: string }[]} archivos */
export async function unirPdfs(archivos) {
  if (!Array.isArray(archivos) || archivos.length === 0) {
    throw new ErrorUnir("sin_archivos", "No llegó ningún PDF para unir.");
  }
  const salida = await PDFDocument.create();
  for (const [i, a] of archivos.entries()) {
    let doc;
    try {
      doc = await PDFDocument.load(Buffer.from(String(a?.pdf_b64 ?? ""), "base64"));
    } catch {
      throw new ErrorUnir("pdf_invalido", `El archivo ${a?.nombre ?? i + 1} no es un PDF válido.`);
    }
    const paginas = await salida.copyPages(doc, doc.getPageIndices());
    for (const p of paginas) salida.addPage(p);
  }
  const bytes = await salida.save();
  return { paginas: salida.getPageCount(), pdf_b64: Buffer.from(bytes).toString("base64") };
}
```

Run → PASS.

**Step 3: servidor.** Tests nuevos en `test/servidor.test.mjs` (el servidor de prueba ya tiene `maxMb: 1`):

```js
test("unir: devuelve el PDF unido", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const d = await PDFDocument.create();
  d.addPage([100, 100]);
  const b64 = Buffer.from(await d.save()).toString("base64");
  const r = await fetch(`${base}/unir`, {
    method: "POST",
    headers: { "X-Worker-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ archivos: [{ nombre: "R-000001", pdf_b64: b64 }, { nombre: "R-000002", pdf_b64: b64 }] }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).paginas, 2);
});

test("unir: sin token 401 y con basura 422", async () => {
  assert.equal((await fetch(`${base}/unir`, { method: "POST", body: "{}" })).status, 401);
  const r = await fetch(`${base}/unir`, {
    method: "POST", headers: { "X-Worker-Token": TOKEN },
    body: JSON.stringify({ archivos: [{ nombre: "R-000009", pdf_b64: "aG9sYQ==" }] }),
  });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error, "pdf_invalido");
});
```

En `servidor.mjs`: importar `unirPdfs, ErrorUnir` de `./unir.mjs`, documentar la ruta en el comentario de arriba (`POST /unir  body = { archivos: [{ nombre, pdf_b64 }] } -> { paginas, pdf_b64 }`) y reemplazar el ruteo:

```js
    if (url.pathname !== "/procesar" && url.pathname !== "/unir") return responder(res, 404, { error: "no_encontrado" });
    if (req.method !== "POST") return responder(res, 405, { error: "metodo_no_permitido" });
    if (!tokenValido(req, token)) return responder(res, 401, { error: "token_invalido" });

    if (url.pathname === "/unir") {
      try {
        const cuerpo = await leerCuerpo(req, maxBytes);
        let pedido;
        try {
          pedido = JSON.parse(cuerpo.toString("utf8"));
        } catch {
          return responder(res, 400, { error: "json_invalido" });
        }
        const r = await unirPdfs(pedido?.archivos);
        console.log(`[unir] ${pedido.archivos.length} archivos, ${r.paginas} paginas`);
        return responder(res, 200, r);
      } catch (e) {
        if (e.demasiadoGrande) return responder(res, 413, { error: "demasiado_grande", mensaje: `Maximo ${maxMb} MB.` });
        if (e instanceof ErrorUnir) return responder(res, e.codigo === "sin_archivos" ? 400 : 422, { error: e.codigo, mensaje: e.message });
        console.error("[unir] error inesperado", e);
        return responder(res, 500, { error: "error_interno", mensaje: e.message });
      }
    }
```

(el bloque de `/procesar` sigue igual debajo). Run `npm test` en `automatizaciones/remitos` → todo en verde.

**Step 4: commit**

```bash
git add automatizaciones/remitos/worker automatizaciones/remitos/test/unir.test.mjs automatizaciones/remitos/test/servidor.test.mjs
git commit -m "Worker de remitos: /unir arma un PDF con los remitos de un paquete"
```

### Task 16: reglas del paquete en `logica.mjs`

**Files:** Modify `automatizaciones/remitos/n8n/logica.mjs` (agregar y exportar), Test `automatizaciones/remitos/test/logica.test.mjs`

**Test (falla):**

```js
test("paquete: Drive dice que todo está en orden", () => {
  const esc = [{ numero: 163, drive_file_id: "a", archivado_at: "2026-09-25T12:00:00Z" }];
  const meta = [{ statusCode: 200, body: { id: "a", trashed: false, modifiedTime: "2026-09-25T11:59:00Z" } }];
  assert.deepEqual(verificarArchivosPaquete(esc, meta), []);
});

test("paquete: borrado, en la papelera, modificado o sin respuesta", () => {
  const esc = [163, 164, 165, 166].map((numero) => ({ numero, drive_file_id: `f${numero}`, archivado_at: "2026-09-25T12:00:00Z" }));
  const meta = [
    { statusCode: 404, body: { error: { code: 404 } } },
    { statusCode: 200, body: { id: "f164", trashed: true, modifiedTime: "2026-09-25T11:59:00Z" } },
    { statusCode: 200, body: { id: "f165", trashed: false, modifiedTime: "2026-09-26T09:00:00Z" } },
    { statusCode: 500, body: {} },
  ];
  assert.deepEqual(verificarArchivosPaquete(esc, meta), [
    "R-000163: el archivo de Drive no está",
    "R-000164: el archivo está en la papelera de Drive",
    "R-000165: el archivo de Drive cambió después de archivarse",
    "R-000166: Drive no contestó (500)",
  ]);
});

test("paquete: nombre con la factura y la versión", () => {
  assert.equal(nombrePaquete({ factura_texto: "FB 00008-00001234", version: 1 }), "Paquete FB 00008-00001234.pdf");
  assert.equal(nombrePaquete({ factura_texto: "FB 00008-00001234", version: 2 }), "Paquete FB 00008-00001234_v2.pdf");
});
```

**Implementación** (y sumarlas al `export { … }` del final):

```js
// --- Paquetes (mig 124) ---------------------------------------------------------------

/**
 * Lo que dijo Drive de cada archivo del paquete, en el mismo orden que los escaneos.
 * Devuelve los problemas; vacio = se puede armar. Un archivo modificado despues de
 * archivarse (con 10 min de margen por relojes) ya no es el que se evaluo.
 */
function verificarArchivosPaquete(escaneos, metadatos, margenMin = 10) {
  const problemas = [];
  escaneos.forEach((e, i) => {
    const m = metadatos[i] || {};
    const nombre = numeroVisibleR(e.numero);
    const cod = Number(m.statusCode ?? 0);
    if (cod === 404) problemas.push(`${nombre}: el archivo de Drive no está`);
    else if (cod !== 200 || !m.body || !m.body.id) problemas.push(`${nombre}: Drive no contestó (${cod || "sin respuesta"})`);
    else if (m.body.trashed) problemas.push(`${nombre}: el archivo está en la papelera de Drive`);
    else if (Date.parse(m.body.modifiedTime) > Date.parse(e.archivado_at) + margenMin * 60000) {
      problemas.push(`${nombre}: el archivo de Drive cambió después de archivarse`);
    }
  });
  return problemas;
}

function nombrePaquete({ factura_texto, version }) {
  return `Paquete ${factura_texto}${version > 1 ? `_v${version}` : ""}.pdf`;
}
```

Run `node --test test/logica.test.mjs` → PASS. Commit: `Remitos: reglas del paquete (verificar en Drive, nombre)`.

### Task 17: workflow *Remitos - Paquetes*

**Files:** Modify `automatizaciones/remitos/n8n/construir.mjs`, Test `automatizaciones/remitos/test/workflows.test.mjs`

**Step 1: tests (fallan).** En `workflows.test.mjs`, el primer test pasa a "se arman los ocho workflows" con `"Remitos - Paquetes"` en la lista ordenada. Y:

```js
test("paquetes: la base da el pedido, Drive se verifica antes de bajar, el worker une y la base se entera", () => {
  const wf = workflows.find((w) => w.name === "Remitos - Paquetes");
  const tipo = (n) => wf.nodes.find((x) => x.name === n);
  const url = (n) => String(tipo(n).parameters.url);
  assert.match(url("Tomar pedido (base)"), /rpc_remitos_paquete_tomar/);
  assert.match(url("Listo (base)"), /rpc_remitos_paquete_listo/);
  assert.match(url("Error (base)"), /rpc_remitos_paquete_error/);
  assert.match(url("Error del worker (base)"), /rpc_remitos_paquete_error/);
  assert.match(url("Unir (worker)"), /\/unir$/);
  const siguiente = (n) => wf.connections[n].main.flat().map((d) => d.node);
  assert.deepEqual(siguiente("Metadatos"), ["Verificar"]);
  assert.deepEqual(wf.connections["¿Todo en orden?"].main[0].map((d) => d.node), ["Uno por archivo"]);
  assert.deepEqual(wf.connections["¿Todo en orden?"].main[1].map((d) => d.node), ["Error (base)"]);
  // Nada se baja si Drive dijo que algo falta.
  assert.ok(!siguiente("Verificar").includes("Descargar"));
});
```

El test existente "base: toda llamada a Supabase lleva la clave por credencial y la anon key por encabezado" tiene que cubrir también este workflow (si filtra por nombre de workflow, sumarlo).

**Step 2: implementación.** Después de `wfEvaluarFirmas`:

```js
// ================================================================================
// 6) Paquetes: el PDF con los remitos firmados de una factura (mig 124). El admin lo
//    pide en el panel; esto toma el pedido, verifica cada archivo en Drive, los baja,
//    el worker los une y el resultado queda en Remitos/<Cliente>/Paquetes/.
// ================================================================================

function wfPaquetes() {
  contador = 0;
  const F = 300;
  return {
    name: "Remitos - Paquetes",
    nodes: [
      nodo("Cada minuto", "n8n-nodes-base.scheduleTrigger", 1.2,
        { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, [x(0), F]),
      configNodo([x(1), F]),
      supa("Tomar pedido (base)", [x(2), F], "rpc_remitos_paquete_tomar", "={{ JSON.stringify({}) }}"),
      codigo("¿Hay pedido?", `
// Sin pedido, la base devuelve {} y la corrida termina aca.
const p = $input.first().json;
if (!p || !p.paquete_id) return [];
return p.escaneos.map(json => ({ json }));`, [x(3), F], { conLogica: false }),
      http("Metadatos", [x(4), F], {
        url: `=${DRIVE}/{{ $json.drive_file_id }}`, query: { fields: "id,trashed,modifiedTime" }, auth: "google",
        completa: true,
      }),
      codigo("Verificar", `
const pedido = $('Tomar pedido (base)').first().json;
const problemas = verificarArchivosPaquete(pedido.escaneos, $input.all().map(i => i.json));
return [{ json: { paquete_id: pedido.paquete_id, ok: problemas.length === 0, problemas } }];`, [x(5), F]),
      si("¿Todo en orden?", [x(6), F], "={{ $json.ok }}", OP.verdadero),
      codigo("Uno por archivo", `return $('Tomar pedido (base)').first().json.escaneos.map(json => ({ json }));`, [x(7), F], { conLogica: false }),
      http("Descargar", [x(8), F], {
        url: `=${DRIVE}/{{ $json.drive_file_id }}`, query: { alt: "media" }, archivo: true, auth: "google",
      }),
      codigo("Pedido al worker", `
const archivos = [];
for (const [i] of $input.all().entries()) {
  const buf = await this.helpers.getBinaryDataBuffer(i, 'data');
  archivos.push({ nombre: numeroVisibleR($('Uno por archivo').itemMatching(i).json.numero), pdf_b64: buf.toString('base64') });
}
return [{ json: { archivos } }];`, [x(9), F]),
      http("Unir (worker)", [x(10), F], {
        method: "POST", url: `={{ ${CFG("worker_url")} }}/unir`, json: "={{ JSON.stringify($json) }}",
        auth: "worker", timeout: 120000, completa: true,
      }),
      si("¿Unió?", [x(11), F], "={{ String($json.statusCode) }}", OP.igual, "200"),
      codigo("Carpeta del cliente", `
const p = $('Tomar pedido (base)').first().json;
return [{ json: { padre: $('Config').first().json.raiz_id, nombre: limpiarNombre(p.cliente) || 'SIN NOMBRE' } }];`, [x(12), F]),
      llamarAsegurar("Carpeta cliente", [x(13), F]),
      codigo("→ Paquetes", `return [{ json: { padre: $json.id, nombre: 'Paquetes' } }];`, [x(14), F], { conLogica: false }),
      llamarAsegurar("Carpeta Paquetes", [x(15), F]),
      codigo("Preparar subida", `
const p = $('Tomar pedido (base)').first().json;
const u = $('Unir (worker)').first().json.body;
const nombre = nombrePaquete(p);
return [{
  json: { nombre, destino_id: $json.id, paginas: u.paginas },
  binary: { data: { data: u.pdf_b64, mimeType: 'application/pdf', fileName: nombre, fileExtension: 'pdf' } },
}];`, [x(16), F]),
      http("Crear archivo", [x(17), F], {
        method: "POST", url: `=${DRIVE}`, query: { fields: "id" }, auth: "google",
        json: "={{ JSON.stringify({ name: $json.nombre, parents: [$json.destino_id], mimeType: 'application/pdf', description: 'Remitos firmados de ' + $('Tomar pedido (base)').first().json.factura_texto }) }}",
      }),
      codigo("Recuperar PDF", `return { json: $json, binary: $('Preparar subida').item.binary };`, [x(18), F], { cadaItem: true, conLogica: false }),
      http("Subir contenido", [x(19), F], {
        method: "PATCH", url: "=https://www.googleapis.com/upload/drive/v3/files/{{ $json.id }}",
        query: { uploadType: "media", fields: "id,name,webViewLink" }, binario: true, auth: "google",
      }),
      supa("Listo (base)", [x(20), F], "rpc_remitos_paquete_listo",
        "={{ JSON.stringify({ p_paquete_id: $('Tomar pedido (base)').first().json.paquete_id, p_drive_file_id: $json.id, p_drive_link: $json.webViewLink, p_paginas: $('Preparar subida').first().json.paginas }) }}"),
      supa("Error (base)", [x(7), F + 200], "rpc_remitos_paquete_error",
        "={{ JSON.stringify({ p_paquete_id: $json.paquete_id, p_error: $json.problemas.join(' · ') }) }}"),
      supa("Error del worker (base)", [x(12), F + 200], "rpc_remitos_paquete_error",
        "={{ JSON.stringify({ p_paquete_id: $('Tomar pedido (base)').first().json.paquete_id, p_error: 'El worker no pudo unir los PDF: ' + (($json.body && ($json.body.mensaje || $json.body.error)) || $json.statusCode) }) }}"),
    ],
    connections: conexiones([
      ["Cada minuto", "Config"],
      ["Config", "Tomar pedido (base)"],
      ["Tomar pedido (base)", "¿Hay pedido?"],
      ["¿Hay pedido?", "Metadatos"],
      ["Metadatos", "Verificar"],
      ["Verificar", "¿Todo en orden?"],
      ["¿Todo en orden?", "Uno por archivo", 0],
      ["¿Todo en orden?", "Error (base)", 1],
      ["Uno por archivo", "Descargar"],
      ["Descargar", "Pedido al worker"],
      ["Pedido al worker", "Unir (worker)"],
      ["Unir (worker)", "¿Unió?"],
      ["¿Unió?", "Carpeta del cliente", 0],
      ["¿Unió?", "Error del worker (base)", 1],
      ["Carpeta del cliente", "Carpeta cliente"],
      ["Carpeta cliente", "→ Paquetes"],
      ["→ Paquetes", "Carpeta Paquetes"],
      ["Carpeta Paquetes", "Preparar subida"],
      ["Preparar subida", "Crear archivo"],
      ["Crear archivo", "Recuperar PDF"],
      ["Recuperar PDF", "Subir contenido"],
      ["Subir contenido", "Listo (base)"],
    ]),
  };
}
```

Y en `workflows`: `paquetes: wfPaquetes(),`.

Si "Descargar" falla a mitad (Drive se cae entre la verificación y la descarga), la corrida se cae, `Remitos - Errores` la anota y el pedido queda "armando": a los 30 min el panel ofrece volver a pedirlo (lo resuelve `rpc_remitos_pedir_paquete`).

**Step 3:** `npm test` en `automatizaciones/remitos` → PASS. `node n8n/construir.mjs` (con `config.local.json`) → sale `salida/n8n/paquetes.json`.

**Step 4: commit**

```bash
git add automatizaciones/remitos/n8n/construir.mjs automatizaciones/remitos/test/workflows.test.mjs
git commit -m "Remitos: workflow Paquetes (verifica en Drive, une con el worker, sube a Paquetes/)"
```

### Task 18: tipos, reglas de pantalla y datos del paquete

**Files:** `src/lib/types.ts`, `src/lib/remitos.ts`, `src/__tests__/remitos.test.ts`, `src/lib/data.ts`

**Tipos:**

```ts
export type RemitoPaqueteEstado = "pedido" | "armando" | "listo" | "error";

export type RemitoPaqueteFactura = {
  invoice_id: string;
  factura_texto: string;
  cbte_fch: string | null;
  imp_total: number;
  remitos_total: number;
  remitos_firmados: number;
  constancia: { motivo: string; faltantes: number; usuario: string | null; created_at: string } | null;
  paquete: {
    id: string;
    version: number;
    estado: RemitoPaqueteEstado;
    remitos: number;
    drive_link: string | null;
    error: string | null;
    pedido_at: string;
    armando_at: string | null;
    terminado_at: string | null;
  } | null;
  firmados_nuevos: number;
};
```

**Test (falla):**

```ts
describe("paquetes", () => {
  const AHORA = Date.parse("2026-10-01T15:00:00Z");
  const base = (paquete: RemitoPaqueteFactura["paquete"], extra: Partial<RemitoPaqueteFactura> = {}): RemitoPaqueteFactura => ({
    invoice_id: "i1", factura_texto: "FB 00008-00000010", cbte_fch: "2026-09-30", imp_total: 100,
    remitos_total: 3, remitos_firmados: 2, constancia: null, paquete, firmados_nuevos: 0, ...extra,
  });
  const paq = (estado: RemitoPaqueteEstado, extra = {}) => ({
    id: "p1", version: 1, estado, remitos: 2, drive_link: estado === "listo" ? "https://example.test/p" : null,
    error: null, pedido_at: "2026-10-01T14:50:00Z", armando_at: "2026-10-01T14:51:00Z", terminado_at: null, ...extra,
  });

  it("sin paquete se puede armar; sin firmados no", () => {
    expect(estadoPaquete(base(null), AHORA)).toEqual({ puedeArmar: true, armando: false, texto: null });
    expect(estadoPaquete(base(null, { remitos_firmados: 0 }), AHORA).puedeArmar).toBe(false);
  });

  it("pedido o armando: esperar; trabado más de 30 min: se puede volver a pedir", () => {
    expect(estadoPaquete(base(paq("armando")), AHORA)).toMatchObject({ puedeArmar: false, armando: true });
    const trabado = paq("armando", { armando_at: "2026-10-01T14:00:00Z" });
    expect(estadoPaquete(base(trabado), AHORA)).toMatchObject({ puedeArmar: true, armando: false, texto: "Se cortó a mitad de camino: volvé a pedirlo." });
  });

  it("listo con firmados nuevos: avisa y deja volver a armar", () => {
    expect(estadoPaquete(base(paq("listo"), { firmados_nuevos: 1 }), AHORA)).toMatchObject({
      puedeArmar: true, texto: "Hay 1 remito firmado nuevo: volvé a armarlo.",
    });
    expect(estadoPaquete(base(paq("listo")), AHORA)).toMatchObject({ puedeArmar: false, texto: null });
  });

  it("error: muestra el motivo y deja volver a pedir", () => {
    expect(estadoPaquete(base(paq("error", { error: "R-000163: el archivo de Drive no está" })), AHORA)).toMatchObject({
      puedeArmar: true, texto: "No se pudo armar: R-000163: el archivo de Drive no está",
    });
  });
});
```

**Implementación** en `src/lib/remitos.ts`:

```ts
// ─── Paquetes (mig 124) ────────────────────────────────────────────────────────

const PAQUETE_TRABADO_MS = 30 * 60_000;

export type EstadoPaquete = { puedeArmar: boolean; armando: boolean; texto: string | null };

export function estadoPaquete(f: RemitoPaqueteFactura, ahoraMs: number): EstadoPaquete {
  const hayFirmados = f.remitos_firmados > 0;
  const p = f.paquete;
  if (!p) return { puedeArmar: hayFirmados, armando: false, texto: null };
  if (p.estado === "pedido") return { puedeArmar: false, armando: true, texto: null };
  if (p.estado === "armando") {
    const desde = Date.parse(p.armando_at ?? p.pedido_at);
    if (ahoraMs - desde > PAQUETE_TRABADO_MS) {
      return { puedeArmar: hayFirmados, armando: false, texto: "Se cortó a mitad de camino: volvé a pedirlo." };
    }
    return { puedeArmar: false, armando: true, texto: null };
  }
  if (p.estado === "error") {
    return { puedeArmar: hayFirmados, armando: false, texto: `No se pudo armar: ${p.error ?? "error sin detalle"}` };
  }
  if (f.firmados_nuevos > 0) {
    const n = f.firmados_nuevos;
    return { puedeArmar: true, armando: false, texto: `Hay ${n} ${n === 1 ? "remito firmado nuevo" : "remitos firmados nuevos"}: volvé a armarlo.` };
  }
  return { puedeArmar: false, armando: false, texto: null };
}
```

**Datos** en `src/lib/data.ts`:

```ts
export async function listRemitoPaquetes(kind: CtaCteClientKind, clientId: string): Promise<RemitoPaqueteFactura[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_remitos_paquetes", { p_client_kind: kind, p_client_id: clientId });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => {
    const k = f.constancia as Record<string, unknown> | null;
    const p = f.paquete as Record<string, unknown> | null;
    return {
      invoice_id: String(f.invoice_id),
      factura_texto: String(f.factura_texto ?? ""),
      cbte_fch: strOrNull(f.cbte_fch),
      imp_total: Number(f.imp_total) || 0,
      remitos_total: Number(f.remitos_total) || 0,
      remitos_firmados: Number(f.remitos_firmados) || 0,
      constancia: k
        ? { motivo: String(k.motivo), faltantes: Number(k.faltantes) || 0, usuario: strOrNull(k.usuario), created_at: String(k.created_at) }
        : null,
      paquete: p
        ? {
            id: String(p.id),
            version: Number(p.version) || 1,
            estado: p.estado as RemitoPaqueteEstado,
            remitos: Number(p.remitos) || 0,
            drive_link: strOrNull(p.drive_link),
            error: strOrNull(p.error),
            pedido_at: String(p.pedido_at),
            armando_at: strOrNull(p.armando_at),
            terminado_at: strOrNull(p.terminado_at),
          }
        : null,
      firmados_nuevos: Number(f.firmados_nuevos) || 0,
    };
  });
}

export async function requestRemitoPaquete(invoiceId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_remitos_pedir_paquete", { p_invoice_id: invoiceId });
  if (error) throw error;
}
```

Run los tests → PASS. Commit: `Remitos: reglas y datos de los paquetes`.

### Task 19: acción y sección "Paquetes por factura"

**Files:**
- Modify: `src/app/admin/remitos/actions.ts`
- Create: `src/app/admin/remitos/PaquetesSection.tsx`, `src/app/admin/remitos/PaquetesSection.test.tsx`
- Modify: `src/app/admin/remitos/RemitosClient.tsx` (props y un render), `src/app/admin/remitos/page.tsx`

**Acción:**

```ts
export async function pedirPaqueteAction(invoiceId: string): Promise<ActionResult> {
  try {
    await assertRemitosAdmin();
    await requestRemitoPaquete(invoiceId);
    revalidatePath("/admin/remitos");
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo pedir el paquete.") };
  }
}
```

**Test del componente (falla):**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PaquetesSection from "./PaquetesSection";
import type { RemitoPaqueteFactura } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const pedirPaqueteAction = vi.fn();
vi.mock("./actions", () => ({ pedirPaqueteAction: (...a: unknown[]) => pedirPaqueteAction(...a) }));

const AHORA = Date.parse("2026-10-01T15:00:00Z");
const factura = (extra: Partial<RemitoPaqueteFactura> = {}): RemitoPaqueteFactura => ({
  invoice_id: "i1", factura_texto: "FB 00008-00000010", cbte_fch: "2026-09-30", imp_total: 150000,
  remitos_total: 3, remitos_firmados: 2, constancia: null, paquete: null, firmados_nuevos: 0, ...extra,
});

describe("PaquetesSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin cliente elegido pide elegir uno", () => {
    render(<PaquetesSection facturas={[]} clienteElegido={false} nowMs={AHORA} />);
    expect(screen.getByText(/Elegí un cliente/)).toBeInTheDocument();
  });

  it("muestra firmados, la constancia y pide el paquete", async () => {
    pedirPaqueteAction.mockResolvedValue({ success: true });
    render(
      <PaquetesSection
        facturas={[factura({ constancia: { motivo: "se perdió", faltantes: 1, usuario: "Admin", created_at: "2026-09-30T12:00:00Z" } })]}
        clienteElegido
        nowMs={AHORA}
      />
    );
    expect(screen.getByText("FB 00008-00000010")).toBeInTheDocument();
    expect(screen.getByText("2 de 3 firmados")).toBeInTheDocument();
    expect(screen.getByText(/Emitida sin 1 remito — motivo: se perdió/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Armar paquete"));
    await waitFor(() => expect(pedirPaqueteAction).toHaveBeenCalledWith("i1"));
  });

  it("listo: ofrece descargar", () => {
    render(
      <PaquetesSection
        facturas={[factura({ paquete: { id: "p1", version: 1, estado: "listo", remitos: 2, drive_link: "https://example.test/p", error: null, pedido_at: "2026-10-01T14:00:00Z", armando_at: "2026-10-01T14:01:00Z", terminado_at: "2026-10-01T14:02:00Z" } })]}
        clienteElegido
        nowMs={AHORA}
      />
    );
    expect(screen.getByText("Descargar").closest("a")).toHaveAttribute("href", "https://example.test/p");
    expect(screen.queryByText("Armar paquete")).not.toBeInTheDocument();
  });
});
```

**Componente:**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Package } from "lucide-react";
import { toast } from "sonner";

import { formatAmount } from "@/lib/format";
import { estadoPaquete } from "@/lib/remitos";
import { formatHotelDate } from "@/lib/time";
import type { RemitoPaqueteFactura } from "@/lib/types";
import { pedirPaqueteAction } from "./actions";

type Props = { facturas: RemitoPaqueteFactura[]; clienteElegido: boolean; nowMs: number };

/** PDF con los remitos firmados de cada consolidada del cliente (mig 124, lo arma n8n). */
export default function PaquetesSection({ facturas, clienteElegido, nowMs }: Props) {
  const router = useRouter();
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const hayArmando = facturas.some((f) => estadoPaquete(f, nowMs).armando);

  // Mientras n8n arma (tarda un minuto o dos), la lista se refresca sola.
  useEffect(() => {
    if (!hayArmando) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [hayArmando, router]);

  async function pedir(invoiceId: string) {
    setPidiendo(invoiceId);
    const r = await pedirPaqueteAction(invoiceId);
    setPidiendo(null);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success("Paquete pedido. En uno o dos minutos está listo.");
    router.refresh();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl" aria-label="Paquetes por factura">
      <h2 className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-700 flex items-center gap-2">
        <Package size={16} /> Paquetes por factura
      </h2>
      {!clienteElegido ? (
        <p className="px-4 py-3 text-sm text-slate-600">Elegí un cliente para ver sus facturas consolidadas y armar el PDF de remitos.</p>
      ) : facturas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-600">Este cliente no tiene facturas consolidadas vigentes.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {facturas.map((f) => {
            const e = estadoPaquete(f, nowMs);
            return (
              <li key={f.invoice_id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm">
                    <span className="font-mono font-semibold">{f.factura_texto}</span>
                    <span className="text-slate-600">
                      {f.cbte_fch ? ` · ${formatHotelDate(f.cbte_fch)}` : ""} · {formatAmount(f.imp_total)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-700">{`${f.remitos_firmados} de ${f.remitos_total} firmados`}</p>
                  {f.constancia && (
                    <p className="text-xs text-amber-800">
                      {`Emitida sin ${f.constancia.faltantes} ${f.constancia.faltantes === 1 ? "remito" : "remitos"} — motivo: ${f.constancia.motivo}`}
                      {f.constancia.usuario ? ` — ${f.constancia.usuario}` : ""}, {formatHotelDate(f.constancia.created_at)}
                    </p>
                  )}
                  {e.texto && <p className="text-xs text-rose-700">{e.texto}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {f.paquete?.estado === "listo" && f.paquete.drive_link && (
                    <a
                      href={f.paquete.drive_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
                    >
                      <Download size={14} /> Descargar
                    </a>
                  )}
                  {e.armando && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                      <Loader2 size={14} className="animate-spin" /> Armando…
                    </span>
                  )}
                  {e.puedeArmar && (
                    <button
                      type="button"
                      disabled={pidiendo !== null}
                      onClick={() => void pedir(f.invoice_id)}
                      className="text-xs px-2 py-1 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {f.paquete ? "Volver a armar" : "Armar paquete"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

**Integración:**
- `RemitosClient`: prop `paquetes?: RemitoPaqueteFactura[]` (default `[]`) y, después de la sección de piezas, `<PaquetesSection facturas={paquetes} clienteElegido={cliente !== ""} nowMs={nowMs} />`.
- `page.tsx`: si hay cliente elegido, cargar `cargar(listRemitoPaquetes(clientKind, clientId), [], "los paquetes")` dentro del `Promise.all` (con `Promise.resolve([])` si no hay cliente) y pasar `paquetes`.
- `RemitosClient.test.tsx`: sumar `pedirPaqueteAction` al mock de `./actions`.

Run `npx vitest run src/app/admin/remitos` → PASS. Commit: `Remitos: sección Paquetes por factura`.

### Task 20: documentación

**Files:** `automatizaciones/remitos/README.md`, `docs/plans/2026-09-23-remitos-fase-c-design.md`

- README §9 (tabla de workflows): fila `Remitos - Paquetes` | Cada minuto | "Toma el pedido más viejo de la base, le pregunta a Drive por cada remito (que exista, no esté en la papelera ni se haya modificado), los baja, el worker los une y deja el PDF en `Remitos/<Cliente>/Paquetes/`. Si algo falla, el pedido queda en error con el motivo: nunca sale a medias."
- README "Activos": sumar Paquetes.
- README "Qué pasa cuando algo falla": filas del paquete (archivo borrado/modificado; worker caído; corrida cortada → 30 min).
- README §3 (worker): la ruta `/unir`.
- Diseño: "Estado: implementado" cuando estén los tres PR, y lo que haya cambiado.

Commit: `Remitos: README y diseño con los paquetes`.

### Task 21: verificación local y PR

```bash
npm run lint && npm run typecheck && npm test && npm run build
cd automatizaciones/remitos && npm test
```

Todo en verde. PR con el cuerpo de siempre, avisando que **hay que redesplegar el worker** (app aparte en Coolify) e **importar el workflow nuevo**.

### Task 22: puesta en marcha (👤 AGUSTÍN) y prueba real

1. 👤 **AGUSTÍN:** mergear C3.
2. 👤 **AGUSTÍN:** redesplegar la app del worker en Coolify. Verificar: `POST https://<worker>/unir` sin token → 401.
3. `node n8n/construir.mjs` y 👤 **AGUSTÍN** importa `salida/n8n/paquetes.json` como workflow nuevo, en *Settings*: **Execution order v1** y **Error workflow: Remitos - Errores**. Anotar el id en `config.local.json` (`paquetes_id`) y verificarlo con `herramientas/comparar-workflow.mjs`.
4. 👤 **AGUSTÍN:** activarlo.
5. Prueba real con una consolidada **ya emitida** que tenga al menos un remito firmado: panel → cliente → "Armar paquete". En uno o dos minutos: "Descargar" abre el PDF en Drive (`Remitos/<Cliente>/Paquetes/`), con los remitos en el orden de la factura. Verificar en la base: `select estado, paginas, error from public.remito_paquetes order by pedido_at desc limit 1` → `listo`.
6. Memoria del proyecto (`project_remitos_firmados.md` y el índice): la 124 aplicada con fecha, los PR, el workflow Paquetes y su id, y cualquier trampa nueva.
