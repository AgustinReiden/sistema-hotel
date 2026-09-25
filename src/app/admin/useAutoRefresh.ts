"use client";

import { useEffect, useEffectEvent } from "react";
import { useRouter } from "next/navigation";

/** Cada cuánto se pone al día Hoy si nadie toca nada. */
export const AUTO_REFRESH_INTERVAL_MS = 30000;

/**
 * Al volver a la pestaña llegan dos avisos casi juntos (`visibilitychange` y `focus`).
 * Sin este margen serían dos recargas seguidas de todo el tablero contra Supabase.
 * Solo frena esos avisos: la recarga del intervalo nunca se saltea por una reciente,
 * así un cambio aparece en `intervalMs` como máximo.
 */
const RETURN_GAP_MS = 2000;

/**
 * Antes de recargar se pregunta si el servidor contesta. `navigator.onLine` solo sabe si la
 * PC tiene red local: con el router prendido sigue en true aunque se haya cortado internet,
 * y ahí `router.refresh()` falla y Next cambia Hoy por la página de error de Chrome.
 * Se pide el ícono de la pestaña: no pasa por el middleware ni por Supabase.
 */
const PROBE_URL = "/favicon.ico";

/** Si el servidor no contesta en este tiempo, se lo da por caído hasta el próximo turno. */
const PROBE_TIMEOUT_MS = 5000;

/** Lo que tiene el foco cuando alguien está escribiendo. */
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * La capa oscura que tapa toda la pantalla: la tienen todos los cuadros del panel.
 * Casi ninguno tiene todavía `aria-modal` (llega con F5-8), así que se los reconoce por ella.
 */
const OVERLAY_SELECTOR = ".fixed.inset-0";

/**
 * ¿Conviene NO recargar ahora? Sí cuando:
 * - la pestaña está oculta (nadie la mira: se pone al día al volver),
 * - la PC no tiene red (`navigator.onLine`; el corte de internet lo ve `serverAnswers`),
 * - hay un cuadro abierto (`aria-modal="true"` o la capa `fixed inset-0`),
 * - el foco está en un campo (input, textarea, select o algo editable).
 *
 * Un cuadro abierto lee la tarjeta recién cuando se confirma: si la recarga le cambia la
 * reserva o el saldo abajo, el cobro, el check-in o la cancelación caen sobre otro dato.
 * Y `router.refresh()` conserva lo que está en pantalla solo si la consulta sale bien:
 * sin conexión, con un error del servidor o después de un deploy, Next recarga la página
 * entera y se pierde lo que estaba cargado. Con un cuadro abierto, mejor esperar.
 */
export function shouldSkipRefresh(doc: Document): boolean {
  if (doc.hidden) return true;
  if (doc.defaultView?.navigator.onLine === false) return true;
  if (doc.querySelector('[aria-modal="true"]')) return true;
  if (doc.querySelector(OVERLAY_SELECTOR)) return true;

  const active = doc.activeElement;
  if (!active) return false;
  if (EDITABLE_TAGS.has(active.tagName)) return true;
  // closest() y no isContentEditable: cubre también lo que está adentro de un editable.
  return active.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/**
 * ¿Contesta el servidor? No, si el pedido falla (internet cortado, servidor apagado, más de
 * `PROBE_TIMEOUT_MS`) o si el proxy devuelve un error 5xx (por ejemplo, el 502 mientras se
 * cambia el contenedor en un deploy). Un 404 cuenta como que contesta: si algún día se
 * borra el ícono, el refresco sigue andando.
 *
 * HEAD y `no-store` para no bajar el ícono ni leerlo de la caché del navegador; el `?t=`
 * es por si hay una caché en el camino que lo guarde aunque el servidor esté caído.
 */
async function serverAnswers(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${PROBE_URL}?t=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
      signal,
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

type UseAutoRefreshOptions = {
  /** Cada cuánto recarga (por defecto, 30 segundos). */
  intervalMs?: number;
  /** true mientras la pantalla tiene algo propio abierto que no se quiere tocar. */
  paused?: boolean;
  /**
   * Qué hacer para ponerse al día en lugar de `router.refresh()`. La pantalla de error de
   * `/admin` lo usa para reintentar (pedir la pantalla y volver a pintarla). Puede cambiar
   * en cada render: se usa siempre el último, sin rearmar el intervalo.
   */
  onRefresh?: () => void;
};

/**
 * Pone al día la pantalla sola: cada `intervalMs`, al volver a la ventana (`focus`) y
 * al volver a la pestaña (`visibilitychange`). Usa `router.refresh()`, que vuelve a
 * pedir los server components (el mismo patrón que la Caja). Cuándo no recarga lo decide
 * `shouldSkipRefresh`, y antes de recargar se comprueba que el servidor conteste. Es el
 * único hook de refresco del panel: lo usan Hoy, la pantalla de error de `/admin` (con
 * `onRefresh`) y, más adelante, la pantalla de mantenimiento.
 *
 * Lo que NO puede hacer: frenar una recarga que ya salió. Si alguien abre un cuadro
 * mientras vuelve la respuesta (alrededor de un segundo, sobre todo justo al volver a la
 * pestaña), el cuadro recibe los datos nuevos. Eso se resuelve en el cuadro, no acá.
 */
export function useAutoRefresh({
  intervalMs = AUTO_REFRESH_INTERVAL_MS,
  paused = false,
  onRefresh,
}: UseAutoRefreshOptions = {}): void {
  const router = useRouter();
  // Lee el `onRefresh` y el router del último render sin ser dependencia del efecto: si
  // lo fuera, un `onRefresh` nuevo en cada render reiniciaría la cuenta de los 30 s.
  const doRefresh = useEffectEvent(() => {
    if (onRefresh) onRefresh();
    else router.refresh();
  });

  useEffect(() => {
    if (paused) return;

    let disposed = false;
    let lastRefreshAt = -Infinity;
    // La consulta al servidor en curso: mientras no vuelve, no se arranca otra.
    let probe: { controller: AbortController; timeout: number } | null = null;

    const refresh = async () => {
      if (probe || shouldSkipRefresh(document)) return;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      probe = { controller, timeout };
      const answers = await serverAnswers(controller.signal);
      window.clearTimeout(timeout);
      probe = null;
      // Mientras se esperaba al servidor pudo abrirse un cuadro o tomar el foco un campo.
      if (disposed || !answers || shouldSkipRefresh(document)) return;
      lastRefreshAt = Date.now();
      doRefresh();
    };
    const onInterval = () => {
      void refresh();
    };
    // Volver a la ventana o a la pestaña: con una recarga alcanza aunque lleguen los dos avisos.
    const refreshOnReturn = () => {
      if (Date.now() - lastRefreshAt < RETURN_GAP_MS) return;
      void refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshOnReturn();
    };

    const interval = window.setInterval(onInterval, intervalMs);
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      if (probe) {
        window.clearTimeout(probe.timeout);
        probe.controller.abort();
        probe = null;
      }
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, paused]);
}
