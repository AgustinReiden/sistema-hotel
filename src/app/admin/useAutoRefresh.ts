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
 * ¿Conviene NO recargar ahora? Sí cuando:
 * - la pestaña está oculta (nadie la mira: se pone al día al volver),
 * - hay un cuadro abierto con `aria-modal="true"`,
 * - el foco está en un campo (input, textarea, select o algo editable).
 *
 * `router.refresh()` conserva el estado del cliente, pero el cuadro que se está
 * completando podría mostrar un dato que cambió abajo de la persona. Mejor esperar.
 */
export function shouldSkipRefresh(doc: Document): boolean {
  if (doc.hidden) return true;
  if (doc.querySelector('[aria-modal="true"]')) return true;

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
 * pedir los server components sin perder lo que el cliente tiene en pantalla (el mismo
 * patrón que la Caja). Es el único hook de refresco del panel: lo usan Hoy y, más
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
