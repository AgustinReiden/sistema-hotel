"use client";

import { useEffect } from "react";
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
 * - no hay conexión,
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

type UseAutoRefreshOptions = {
  /** Cada cuánto recarga (por defecto, 30 segundos). */
  intervalMs?: number;
  /** true mientras la pantalla tiene algo propio abierto que no se quiere tocar. */
  paused?: boolean;
};

/**
 * Pone al día la pantalla sola: cada `intervalMs`, al volver a la ventana (`focus`) y
 * al volver a la pestaña (`visibilitychange`). Usa `router.refresh()`, que vuelve a
 * pedir los server components (el mismo patrón que la Caja). Cuándo no recarga lo decide
 * `shouldSkipRefresh`. Es el único hook de refresco del panel: lo usan Hoy y, más
 * adelante, la pantalla de mantenimiento.
 */
export function useAutoRefresh({
  intervalMs = AUTO_REFRESH_INTERVAL_MS,
  paused = false,
}: UseAutoRefreshOptions = {}): void {
  const router = useRouter();

  useEffect(() => {
    if (paused) return;

    let lastRefreshAt = -Infinity;
    const refresh = () => {
      if (shouldSkipRefresh(document)) return;
      lastRefreshAt = Date.now();
      router.refresh();
    };
    // Volver a la ventana o a la pestaña: con una recarga alcanza aunque lleguen los dos avisos.
    const refreshOnReturn = () => {
      if (Date.now() - lastRefreshAt < RETURN_GAP_MS) return;
      refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshOnReturn();
    };

    const interval = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, paused, router]);
}
