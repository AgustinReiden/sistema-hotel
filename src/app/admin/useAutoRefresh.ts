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
 * Antes de recargar se le pregunta al panel si está (`src/app/admin/ping/route.ts`, que
 * contesta 204 sin datos). `navigator.onLine` solo sabe si la PC tiene red local: con el
 * router prendido sigue en true aunque se haya cortado internet, y ahí `router.refresh()`
 * falla y Next cambia Hoy por la página de error de Chrome. La ruta está dentro de `/admin`,
 * así que pasa por el proxy, que lee la sesión y el rol igual que la recarga: si Supabase
 * no contesta, el proxy redirige a `/login` o a `/forbidden` y la pregunta da que no.
 */
export const PING_URL = "/admin/ping";

/** Si el servidor no contesta en este tiempo, se lo da por caído hasta el próximo turno. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * Si alguien movió el mouse, tocó la pantalla, usó la rueda o apretó una tecla hace menos
 * que esto, la recarga espera: al llegar, un aviso que aparece o una tarjeta que cambia de
 * alto corre la grilla, y el toque caería en otro botón. Se reintenta apenas la pantalla
 * queda quieta este tiempo, sin esperar al próximo turno.
 */
const ACTIVITY_QUIET_MS = 2000;

/** Lo que cuenta como "la están usando". */
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "touchstart", "wheel", "keydown"] as const;

/**
 * Pasivos: no frenan el scroll ni el toque. En captura: los ve aunque un cuadro corte la
 * propagación. Tiene que ser el mismo objeto en el removeEventListener.
 */
const ACTIVITY_LISTENER_OPTIONS: AddEventListenerOptions = { passive: true, capture: true };

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
 * ¿Está el panel? Solo si `/admin/ping` contesta 2xx sin redirección. No, si el pedido
 * falla (internet cortado, servidor apagado, más de `PROBE_TIMEOUT_MS`), si contesta otra
 * cosa (el 502 del proxy durante un deploy, un 404 si la ruta no está) o si el proxy
 * redirige a `/login` o a `/forbidden` (Supabase caído, sesión o rol que no se pudieron
 * leer, sesión vencida).
 *
 * `redirect: "manual"`: el navegador no sigue la redirección y la devuelve como
 * `opaqueredirect`; `redirected` cubre a uno que la siguiera igual. HEAD y `no-store`:
 * sin cuerpo y sin leerlo de la caché del navegador.
 */
async function serverAnswers(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(PING_URL, {
      method: "HEAD",
      cache: "no-store",
      redirect: "manual",
      signal,
    });
    if (res.type === "opaqueredirect" || res.redirected) return false;
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

/**
 * El chequeo antes de recargar: pregunta una vez si el panel contesta, con el corte de
 * `PROBE_TIMEOUT_MS`. `cancel` la corta antes (si la pantalla se desmonta mientras espera)
 * y entonces `answers` da false. La usan el refresco automático y el botón "Reintentar" de
 * la pantalla de error de `/admin`: así el botón tampoco recarga sin conexión ni sin sesión.
 */
export function probeServer(): { answers: Promise<boolean>; cancel: () => void } {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const answers = serverAnswers(controller.signal).finally(() => window.clearTimeout(timeout));
  return {
    answers,
    cancel: () => {
      window.clearTimeout(timeout);
      controller.abort();
    },
  };
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
 * pedir los server components (el mismo patrón que la Caja). Antes de cada recarga:
 * - `shouldSkipRefresh` decide si no conviene (pestaña oculta, sin red, cuadro abierto,
 *   foco en un campo): se saltea hasta el próximo turno;
 * - si la están usando (actividad en los últimos `ACTIVITY_QUIET_MS`), espera y recarga
 *   apenas la pantalla queda quieta. Los "`intervalMs` como máximo" valen mientras nadie
 *   la usa;
 * - `probeServer` comprueba que el panel conteste, pasando por el proxy. Si no, no recarga
 *   y la pantalla queda como estaba, dentro del panel.
 * Es el único hook de refresco del panel: lo usan Hoy, la pantalla de error de `/admin`
 * (con `onRefresh`) y, más adelante, la pantalla de mantenimiento.
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
    let lastActivityAt = -Infinity;
    // La consulta al servidor en curso: mientras no vuelve, no se arranca otra.
    let probe: ReturnType<typeof probeServer> | null = null;
    // La recarga que espera a que la pantalla quede quieta: hay una sola a la vez.
    let quietTimer: number | null = null;

    const inUse = () => Date.now() - lastActivityAt < ACTIVITY_QUIET_MS;

    const refreshWhenQuiet = () => {
      if (quietTimer !== null) return;
      const wait = Math.max(0, lastActivityAt + ACTIVITY_QUIET_MS - Date.now());
      quietTimer = window.setTimeout(() => {
        quietTimer = null;
        void refresh();
      }, wait);
    };

    const refresh = async () => {
      if (probe || shouldSkipRefresh(document)) return;
      if (inUse()) {
        refreshWhenQuiet();
        return;
      }
      const current = probeServer();
      probe = current;
      const answers = await current.answers;
      probe = null;
      // Mientras se esperaba al servidor pudo abrirse un cuadro o tomar el foco un campo.
      if (disposed || !answers || shouldSkipRefresh(document)) return;
      // O pudieron empezar a usarla: se pregunta de nuevo cuando quede quieta.
      if (inUse()) {
        refreshWhenQuiet();
        return;
      }
      lastRefreshAt = Date.now();
      doRefresh();
    };
    const onActivity = () => {
      lastActivityAt = Date.now();
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
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, ACTIVITY_LISTENER_OPTIONS);
    }
    return () => {
      disposed = true;
      if (probe) {
        probe.cancel();
        probe = null;
      }
      if (quietTimer !== null) {
        window.clearTimeout(quietTimer);
        quietTimer = null;
      }
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, ACTIVITY_LISTENER_OPTIONS);
      }
    };
  }, [intervalMs, paused]);
}
