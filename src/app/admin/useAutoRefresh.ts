"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Cada cuánto se pone al día Hoy si nadie toca nada. */
export const AUTO_REFRESH_INTERVAL_MS = 30000;

/**
 * Al volver a la pestaña llegan dos avisos casi juntos (`visibilitychange` y `focus`).
 * Sin este margen serían dos recargas seguidas de todo el tablero contra Supabase, o,
 * sin red, dos chequeos fallidos de una vez (el aviso de Hoy saldría antes de tiempo).
 * Se cuenta desde el último chequeo, haya andado o no, o desde la última recarga.
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

/**
 * Las páginas que ya se vieron en esta pestaña: el `renderedAt` de cada una y cuándo la vio
 * la PC por primera vez (con el reloj de la PC). Con Atrás o Adelante, Next vuelve a montar
 * la página que tenía guardada, con los datos y el `renderedAt` de entonces: si ese
 * `renderedAt` ya está acá, es una vuelta, y si la PC lo vio hace más de un turno, esos datos
 * son viejos. `renderedAt` solo se usa para reconocer la página: nunca se compara la hora del
 * servidor con la de la PC (pueden no coincidir).
 *
 * Vive en el módulo, así que dura lo que la pestaña (un F5 lo vacía, pero después de un F5
 * la página llega nueva del servidor). Hoy anota una página cada 30 s mientras está a la
 * vista: `SEEN_PAGES_LIMIT` cubre más de 16 horas seguidas y son solo números. Una página
 * que se cayó del registro cuenta como nueva: espera el turno, como antes.
 */
const firstSeenByRenderedAt = new Map<number, number>();
const SEEN_PAGES_LIMIT = 2000;

/** Anota la página si es nueva y devuelve cuándo la vio la PC por primera vez. */
function rememberPage(renderedAt: number, now: number): number {
  const seenAt = firstSeenByRenderedAt.get(renderedAt);
  if (seenAt !== undefined) return seenAt;
  firstSeenByRenderedAt.set(renderedAt, now);
  if (firstSeenByRenderedAt.size > SEEN_PAGES_LIMIT) {
    // Un Map recorre en el orden en que se anotó: la primera es la más vieja.
    const oldest = firstSeenByRenderedAt.keys().next().value;
    if (oldest !== undefined) firstSeenByRenderedAt.delete(oldest);
  }
  return now;
}

/** Vacía el registro de páginas vistas. Lo usan los tests: cada uno arranca de cero. */
export function resetSeenPages(): void {
  firstSeenByRenderedAt.clear();
}

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

/** ¿Dicen lo mismo? Así un chequeo que no cambia nada no vuelve a pintar la línea. */
function sameTrouble(a: RefreshTrouble | null, b: RefreshTrouble | null): boolean {
  return a === b || (a !== null && b !== null && a.since === b.since && a.reason === b.reason);
}

/**
 * Lo que dicen Hoy y la pantalla de error de `/admin` cuando el chequeo recibe una
 * redirección. F5 lleva a la pantalla de ingreso; si el que no contesta es el sistema,
 * tampoco anda: por eso "si sigue así".
 */
export const SESSION_CLOSED_NOTICE =
  "Se cerró la sesión o el sistema no responde. Si sigue así, apretá F5 para volver a entrar.";

/**
 * Si alguien movió el mouse, tocó la pantalla, usó la rueda, apretó una tecla o la pantalla
 * se estuvo desplazando hace menos que esto, la recarga espera: al llegar, un aviso que
 * aparece o una tarjeta que cambia de alto corre la grilla, y el toque caería en otro botón.
 * Se reintenta apenas la pantalla queda quieta este tiempo, sin esperar al próximo turno.
 */
const ACTIVITY_QUIET_MS = 2000;

/**
 * Lo que cuenta como "la están usando". `touchmove` y `scroll` cubren el desplazamiento:
 * cuando el navegador toma el deslizamiento del dedo manda `pointercancel` y deja de mandar
 * pointer events, y mientras se arrastra la barra con el mouse tampoco llegan `pointermove`.
 * `scroll` sigue llegando durante todo el desplazamiento, también con el impulso después de
 * soltar el dedo. El panel se desplaza en un div interno, donde `scroll` no burbujea: por
 * eso los listeners van en captura, como en `IdleLogout`.
 */
const ACTIVITY_EVENTS = [
  "pointermove",
  "pointerdown",
  "touchstart",
  "touchmove",
  "wheel",
  "scroll",
  "keydown",
] as const;

/**
 * Si el puntero quedó apoyado sobre algo que se aprieta (un botón, un enlace), la pantalla
 * cuenta como en uso hasta este tiempo después del último movimiento, no solo 2 s: quien lee
 * la tarjeta con el mouse ya sobre "Cobrar Medio Dia" está por hacer clic, y si la grilla se
 * corre en ese momento el clic cae en el botón de otra habitación. Tiene tope para que un
 * mouse que quedó olvidado sobre un botón no frene el refresco para siempre.
 */
const POINTER_ON_CONTROL_HOLD_MS = 10000;

/** Lo que se aprieta, con el puntero encima. */
const CONTROL_UNDER_POINTER_SELECTOR = [
  "button:hover",
  "a:hover",
  '[role="button"]:hover',
  "input:hover",
  "select:hover",
  "label:hover",
  "summary:hover",
].join(", ");

/** ¿El puntero está apoyado sobre algo que se aprieta? */
function pointerOnControl(doc: Document): boolean {
  return doc.querySelector(CONTROL_UNDER_POINTER_SELECTOR) !== null;
}

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
  /**
   * Cuándo armó el servidor lo que se ve (`Date.now()` del render de la página). Es la hora
   * que da el aviso: con Atrás o Adelante, Next vuelve a mostrar la página de su caché, con
   * los datos de la última vez que se pidió, y la hora de montar diría otra cosa. Viaja con
   * la página, así que cada recarga que llega trae la suya. Sin esto, la pantalla cuenta
   * como puesta al día al montarse y en cada recarga que se pide.
   *
   * También sirve para reconocer esa vuelta: si al montarse la página ya se había visto en
   * esta pestaña hace más de `intervalMs` (con el reloj de la PC), se pone al día enseguida,
   * como al volver a la pestaña, en lugar de esperar el primer turno.
   */
  renderedAt?: number;
};

/**
 * Pone al día la pantalla sola: cada `intervalMs`, al volver a la ventana (`focus`), al
 * volver a la pestaña (`visibilitychange`) y al volver con Atrás o Adelante a una página
 * vieja (con `renderedAt`: ver `rememberPage`). Usa `router.refresh()`, que vuelve a
 * pedir los server components (el mismo patrón que la Caja). Antes de cada recarga:
 * - `shouldSkipRefresh` decide si no conviene (pestaña oculta, sin red, cuadro abierto,
 *   foco en un campo): se saltea hasta el próximo turno;
 * - si la están usando (actividad en los últimos `ACTIVITY_QUIET_MS`, o en los últimos
 *   `POINTER_ON_CONTROL_HOLD_MS` si el puntero quedó sobre un botón), espera y recarga
 *   apenas la pantalla queda quieta. Los "`intervalMs` como máximo" valen mientras nadie
 *   la usa;
 * - `probeServer` comprueba que el panel conteste, pasando por el proxy. Si no, no recarga
 *   y la pantalla queda como estaba, dentro del panel.
 * Es el único hook de refresco del panel: lo usan Hoy, la pantalla de error de `/admin`
 * (con `onRefresh`) y, más adelante, la pantalla de mantenimiento.
 *
 * Devuelve null mientras anda. Con `FAILED_CHECKS_BEFORE_NOTICE` chequeos fallidos
 * seguidos (sin red en la PC cuenta como uno), devuelve desde cuándo la pantalla no se
 * pone al día (`renderedAt` si se lo pasan; si no, la última recarga o cuando se montó) y
 * cómo salió el último chequeo, para
 * que la pantalla lo avise. Vuelve a null con el primer chequeo que anda. No recargar a
 * propósito (pestaña oculta, cuadro abierto, un campo con el foco, alguien usándola) no
 * cuenta como falla. Lo devuelto cambia (aparece, se va o cambia de causa) recién cuando
 * la pantalla queda quieta, igual que la recarga: el chequeo puede volver hasta
 * `PROBE_TIMEOUT_MS` después de salir, y si en ese rato la empezaron a usar, la línea del
 * aviso correría la grilla bajo el toque.
 *
 * Lo que NO puede hacer: frenar una recarga que ya salió. Si alguien abre un cuadro
 * mientras vuelve la respuesta (alrededor de un segundo, sobre todo justo al volver a la
 * pestaña), el cuadro recibe los datos nuevos. Eso se resuelve en el cuadro, no acá.
 */
export function useAutoRefresh({
  intervalMs = AUTO_REFRESH_INTERVAL_MS,
  paused = false,
  onRefresh,
  renderedAt,
}: UseAutoRefreshOptions = {}): RefreshTrouble | null {
  const router = useRouter();
  const [trouble, setTrouble] = useState<RefreshTrouble | null>(null);
  // Fuera del efecto: no vuelven a cero si el efecto se rearma (por ejemplo, con `paused`).
  const failedChecksRef = useRef(0);
  // Cuándo se puso al día la pantalla por última vez (null hasta que se monta).
  const lastUpdatedAtRef = useRef<number | null>(null);
  // Con `renderedAt`, la hora la trae la página: al montarse (también la que Next saca de
  // su caché con Atrás) y con cada recarga que llega. Va antes del efecto de abajo, que la
  // lee al montarse.
  useEffect(() => {
    if (renderedAt !== undefined) lastUpdatedAtRef.current = renderedAt;
  }, [renderedAt]);
  // Lo que tiene que devolver el hook según el último chequeo, mientras espera a que la
  // pantalla quede quieta para mostrarse (undefined: no hay nada esperando). Fuera del
  // efecto para que no se pierda si el efecto se rearma: se muestra con el chequeo siguiente.
  const pendingTroubleRef = useRef<RefreshTrouble | null | undefined>(undefined);
  // Ponerse al día como al volver a la pestaña (`refreshOnReturn` del efecto de abajo). Es
  // null mientras el refresco está pausado: con `paused`, una vuelta con Atrás no pregunta.
  const refreshOnReturnRef = useRef<(() => void) | null>(null);
  // Lee el `onRefresh`, el router y `renderedAt` del último render sin ser dependencias del
  // efecto: si lo fueran, un `onRefresh` nuevo en cada render (o la hora nueva que trae cada
  // recarga) reiniciaría la cuenta de los 30 s.
  const doRefresh = useEffectEvent((requestedAt: number) => {
    // Sin `renderedAt`, la pantalla cuenta como puesta al día cuando se pide la recarga.
    // Con `renderedAt`, cuando llega: la página nueva trae su hora.
    if (renderedAt === undefined) lastUpdatedAtRef.current = requestedAt;
    if (onRefresh) onRefresh();
    else router.refresh();
  });

  useEffect(() => {
    // Sin `renderedAt`, lo que se ve al montar se toma como de recién.
    if (lastUpdatedAtRef.current === null) lastUpdatedAtRef.current = Date.now();
    if (paused) return;

    let disposed = false;
    // Cuándo salió el último chequeo (haya andado o no) o la última recarga.
    let lastCheckAt = -Infinity;
    let lastActivityAt = -Infinity;
    // La consulta al servidor en curso: mientras no vuelve, no se arranca otra.
    let probe: ReturnType<typeof probeServer> | null = null;
    // La recarga que espera a que la pantalla quede quieta: hay una sola a la vez.
    let quietTimer: number | null = null;
    // El cambio de lo que devuelve el hook que espera a que la pantalla quede quieta.
    let showTimer: number | null = null;

    // Cuánto falta para que la pantalla cuente como quieta (0 si ya lo está): 2 s desde la
    // última actividad, o `POINTER_ON_CONTROL_HOLD_MS` si el puntero quedó sobre un botón.
    const untilQuiet = () => {
      const hold = pointerOnControl(document) ? POINTER_ON_CONTROL_HOLD_MS : ACTIVITY_QUIET_MS;
      return Math.max(0, lastActivityAt + hold - Date.now());
    };
    const inUse = () => untilQuiet() > 0;

    // Muestra lo que dejó el último chequeo (la línea de Hoy aparece, se va o cambia de
    // causa) con la pantalla quieta, como la recarga: si la están usando, espera a que quede
    // quieta. Solo toca el estado cuando cambia lo que se muestra.
    const showWhenQuiet = () => {
      if (pendingTroubleRef.current === undefined || showTimer !== null) return;
      if (inUse()) {
        showTimer = window.setTimeout(() => {
          showTimer = null;
          showWhenQuiet();
        }, untilQuiet());
        return;
      }
      const next = pendingTroubleRef.current;
      pendingTroubleRef.current = undefined;
      setTrouble((prev) => (sameTrouble(prev, next) ? prev : next));
    };

    // Anota cómo salió un chequeo. La cuenta cambia en el momento; lo que se muestra, con
    // la pantalla quieta.
    const noteCheck = (result: ProbeResult) => {
      if (result === "ok") {
        if (failedChecksRef.current >= FAILED_CHECKS_BEFORE_NOTICE) {
          pendingTroubleRef.current = null;
        }
        failedChecksRef.current = 0;
      } else {
        failedChecksRef.current += 1;
        if (failedChecksRef.current >= FAILED_CHECKS_BEFORE_NOTICE) {
          const since = lastUpdatedAtRef.current ?? Date.now();
          pendingTroubleRef.current = { since, reason: result };
        }
      }
      showWhenQuiet();
    };

    const refreshWhenQuiet = () => {
      if (quietTimer !== null) return;
      quietTimer = window.setTimeout(() => {
        quietTimer = null;
        void refresh();
      }, untilQuiet());
    };

    const refresh = async () => {
      if (probe || shouldWait(document)) return;
      if (inUse()) {
        refreshWhenQuiet();
        return;
      }
      // Desde acá sale un chequeo: el otro aviso de volver a la pestaña ya no arranca otro.
      lastCheckAt = Date.now();
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
      lastCheckAt = Date.now();
      doRefresh(lastCheckAt);
    };
    const onActivity = () => {
      lastActivityAt = Date.now();
    };
    const onInterval = () => {
      void refresh();
    };
    // Volver a la ventana o a la pestaña: con un chequeo (y una recarga) alcanza aunque
    // lleguen los dos avisos, también sin red.
    const refreshOnReturn = () => {
      if (Date.now() - lastCheckAt < RETURN_GAP_MS) return;
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
    refreshOnReturnRef.current = refreshOnReturn;
    return () => {
      disposed = true;
      refreshOnReturnRef.current = null;
      if (probe) {
        probe.cancel();
        probe = null;
      }
      if (quietTimer !== null) {
        window.clearTimeout(quietTimer);
        quietTimer = null;
      }
      if (showTimer !== null) {
        window.clearTimeout(showTimer);
        showTimer = null;
      }
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, ACTIVITY_LISTENER_OPTIONS);
      }
    };
  }, [intervalMs, paused]);

  // ¿La página que se ve es una vuelta con Atrás o Adelante a datos viejos? Mira el registro
  // de páginas vistas (y anota la página si es nueva) con el reloj de la PC. Lee
  // `intervalMs` del último render sin ser dependencia.
  const onPageShown = useEffectEvent((shownRenderedAt: number) => {
    const now = Date.now();
    if (now - rememberPage(shownRenderedAt, now) > intervalMs) {
      // Lo mismo que al volver a la pestaña: respeta la pestaña oculta, un cuadro abierto,
      // un campo con el foco, la actividad y el chequeo, y un `focus` justo después no
      // pregunta de nuevo.
      refreshOnReturnRef.current?.();
    }
  });
  // Va después del efecto de arriba: al montarse, `refreshOnReturn` ya está armado. Corre
  // al montarse (la vuelta con Atrás monta la página de nuevo) y con cada página que llega
  // (se anota desde ese momento).
  useEffect(() => {
    if (renderedAt !== undefined) onPageShown(renderedAt);
  }, [renderedAt]);

  return trouble;
}
