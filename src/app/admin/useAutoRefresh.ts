"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
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
 * Ojo con la pantalla de mantenimiento (F4-7): al rol de mantenimiento el proxy lo manda de
 * `/admin` a `/maintenance`, así que ahí la pregunta daría siempre que no. Necesita una
 * ruta propia bajo `/maintenance`.
 */
export const PING_URL = "/admin/ping";

/** Si el servidor no contesta en este tiempo, se lo da por caído hasta el próximo turno. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * Chequeos fallidos seguidos (por cualquier causa) antes de avisar en pantalla que Hoy no
 * se actualiza. Con uno o dos puede ser un corte de segundos: no vale la pena el aviso.
 */
export const FAILED_CHECKS_BEFORE_NOTICE = 3;

/**
 * Cómo salió el chequeo:
 * - "ok": el panel contestó (2xx, sin redirección);
 * - "redirect": el proxy redirigió (a `/login` o a `/forbidden`). Pasa con la sesión
 *   cerrada (por ejemplo, "Salir" en otro dispositivo cierra la sesión en todos) o con
 *   Supabase que no contesta: desde el navegador no se distinguen;
 * - "failed": todo lo demás (sin red, internet cortado, más de `PROBE_TIMEOUT_MS`, un 5xx
 *   durante un deploy, un 404 si la ruta no está).
 */
export type ProbeResult = "ok" | "redirect" | "failed";

/**
 * Lo que devuelve `useAutoRefresh` cuando lleva `FAILED_CHECKS_BEFORE_NOTICE` chequeos
 * fallidos seguidos: desde cuándo (`Date.now()`) la pantalla no se pone al día y cómo
 * salió el último chequeo.
 */
export type RefreshTrouble = { since: number; reason: Exclude<ProbeResult, "ok"> };

/**
 * Lo que dicen Hoy y la pantalla de error de `/admin` cuando el chequeo recibe una
 * redirección. F5 lleva a la pantalla de ingreso; si el que no contesta es el sistema,
 * tampoco anda: por eso "si sigue así".
 */
export const SESSION_CLOSED_NOTICE =
  "Se cerró la sesión o el sistema no responde. Si sigue así, apretá F5 para volver a entrar.";

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
 * - la PC no tiene red (`navigator.onLine`; el corte de internet lo ve `probeServer`),
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
  return isOffline(doc) || shouldWait(doc);
}

/** La PC no tiene red. */
function isOffline(doc: Document): boolean {
  return doc.defaultView?.navigator.onLine === false;
}

/**
 * Lo de `shouldSkipRefresh` salvo la red: no se recarga a propósito, así que no cuenta
 * como un chequeo fallido para el aviso de Hoy.
 */
function shouldWait(doc: Document): boolean {
  if (doc.hidden) return true;
  if (doc.querySelector('[aria-modal="true"]')) return true;
  if (doc.querySelector(OVERLAY_SELECTOR)) return true;

  const active = doc.activeElement;
  if (!active) return false;
  if (EDITABLE_TAGS.has(active.tagName)) return true;
  // closest() y no isContentEditable: cubre también lo que está adentro de un editable.
  return active.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

/**
 * ¿Está el panel? "ok" solo si `/admin/ping` contesta 2xx sin redirección. "redirect" si
 * el proxy redirige a `/login` o a `/forbidden` (sesión cerrada o vencida, Supabase caído,
 * sesión o rol que no se pudieron leer). "failed" si el pedido falla (internet cortado,
 * servidor apagado, más de `PROBE_TIMEOUT_MS`) o si contesta otra cosa (el 502 del proxy
 * durante un deploy, un 404 si la ruta no está).
 *
 * `redirect: "manual"`: el navegador no sigue la redirección y la devuelve como
 * `opaqueredirect`; `redirected` cubre a uno que la siguiera igual, y un 3xx a la vista, a
 * uno que la devolviera tal cual. HEAD y `no-store`: sin cuerpo y sin leerlo de la caché
 * del navegador.
 */
async function askServer(signal: AbortSignal): Promise<ProbeResult> {
  try {
    const res = await fetch(PING_URL, {
      method: "HEAD",
      cache: "no-store",
      redirect: "manual",
      signal,
    });
    if (res.type === "opaqueredirect" || res.redirected) return "redirect";
    if (res.status >= 300 && res.status < 400) return "redirect";
    return res.status >= 200 && res.status < 300 ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * El chequeo antes de recargar: pregunta una vez si el panel contesta, con el corte de
 * `PROBE_TIMEOUT_MS`. `cancel` la corta antes (si la pantalla se desmonta mientras espera)
 * y entonces `result` da "failed". La usan el refresco automático y el botón "Reintentar"
 * de la pantalla de error de `/admin`: así el botón tampoco recarga sin conexión ni sin
 * sesión, y puede decir cuál de las dos es.
 */
export function probeServer(): { result: Promise<ProbeResult>; cancel: () => void } {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const result = askServer(controller.signal).finally(() => window.clearTimeout(timeout));
  return {
    result,
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
 * Devuelve null mientras anda. Con `FAILED_CHECKS_BEFORE_NOTICE` chequeos fallidos
 * seguidos (sin red en la PC cuenta como uno), devuelve desde cuándo la pantalla no se
 * pone al día (la última recarga, o cuando se montó) y cómo salió el último chequeo, para
 * que la pantalla lo avise. Vuelve a null con el primer chequeo que anda. No recargar a
 * propósito (pestaña oculta, cuadro abierto, un campo con el foco, alguien usándola) no
 * cuenta como falla.
 *
 * Lo que NO puede hacer: frenar una recarga que ya salió. Si alguien abre un cuadro
 * mientras vuelve la respuesta (alrededor de un segundo, sobre todo justo al volver a la
 * pestaña), el cuadro recibe los datos nuevos. Eso se resuelve en el cuadro, no acá.
 */
export function useAutoRefresh({
  intervalMs = AUTO_REFRESH_INTERVAL_MS,
  paused = false,
  onRefresh,
}: UseAutoRefreshOptions = {}): RefreshTrouble | null {
  const router = useRouter();
  const [trouble, setTrouble] = useState<RefreshTrouble | null>(null);
  // Fuera del efecto: no vuelven a cero si el efecto se rearma (por ejemplo, con `paused`).
  const failedChecksRef = useRef(0);
  // Cuándo se puso al día la pantalla por última vez (null hasta que se monta).
  const lastUpdatedAtRef = useRef<number | null>(null);
  // Lee el `onRefresh` y el router del último render sin ser dependencia del efecto: si
  // lo fuera, un `onRefresh` nuevo en cada render reiniciaría la cuenta de los 30 s.
  const doRefresh = useEffectEvent(() => {
    if (onRefresh) onRefresh();
    else router.refresh();
  });

  useEffect(() => {
    // Lo que se ve al montar es de recién: cuenta como puesta al día.
    if (lastUpdatedAtRef.current === null) lastUpdatedAtRef.current = Date.now();
    if (paused) return;

    let disposed = false;
    let lastRefreshAt = -Infinity;
    let lastActivityAt = -Infinity;
    // La consulta al servidor en curso: mientras no vuelve, no se arranca otra.
    let probe: ReturnType<typeof probeServer> | null = null;
    // La recarga que espera a que la pantalla quede quieta: hay una sola a la vez.
    let quietTimer: number | null = null;

    const inUse = () => Date.now() - lastActivityAt < ACTIVITY_QUIET_MS;

    // Anota cómo salió un chequeo. Solo toca el estado cuando cambia lo que se muestra.
    const noteCheck = (result: ProbeResult) => {
      if (result === "ok") {
        if (failedChecksRef.current >= FAILED_CHECKS_BEFORE_NOTICE) setTrouble(null);
        failedChecksRef.current = 0;
        return;
      }
      failedChecksRef.current += 1;
      if (failedChecksRef.current < FAILED_CHECKS_BEFORE_NOTICE) return;
      const since = lastUpdatedAtRef.current ?? Date.now();
      setTrouble((prev) =>
        prev?.since === since && prev.reason === result ? prev : { since, reason: result }
      );
    };

    const refreshWhenQuiet = () => {
      if (quietTimer !== null) return;
      const wait = Math.max(0, lastActivityAt + ACTIVITY_QUIET_MS - Date.now());
      quietTimer = window.setTimeout(() => {
        quietTimer = null;
        void refresh();
      }, wait);
    };

    const refresh = async () => {
      if (probe || shouldWait(document)) return;
      if (inUse()) {
        refreshWhenQuiet();
        return;
      }
      // Sin red en la PC no se le pregunta al servidor, pero es un chequeo que falló: la
      // pantalla tampoco se pone al día.
      if (isOffline(document)) {
        noteCheck("failed");
        return;
      }
      const current = probeServer();
      probe = current;
      const result = await current.result;
      probe = null;
      if (disposed) return;
      noteCheck(result);
      // Mientras se esperaba al servidor pudo abrirse un cuadro o tomar el foco un campo.
      if (result !== "ok" || shouldSkipRefresh(document)) return;
      // O pudieron empezar a usarla: se pregunta de nuevo cuando quede quieta.
      if (inUse()) {
        refreshWhenQuiet();
        return;
      }
      lastRefreshAt = Date.now();
      lastUpdatedAtRef.current = lastRefreshAt;
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

  return trouble;
}
