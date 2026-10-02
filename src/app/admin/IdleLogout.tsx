"use client";

import { useEffect, useRef } from "react";
import { logoutEverywhere } from "@/app/login/actions";

// Cierre de sesión por inactividad para recepción. Se cierra la SESIÓN (no la caja: la caja
// es del hotel y sobrevive). Evita que otro opere con la sesión de un recepcionista que se fue.
// La cierra en todos sus dispositivos, no solo en este (a diferencia de "Salir"): una sesión
// suya que siguiera abierta en otra PC o en el celular podría caer en la rendición forzada de
// la caja que abre la siguiente.
const IDLE_MS = 30 * 60 * 1000;
const THROTTLE_MS = 5000;

export default function IdleLogout() {
  const timer = useRef<number | null>(null);
  const lastReset = useRef(0);

  useEffect(() => {
    const arm = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void logoutEverywhere();
      }, IDLE_MS);
    };

    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset.current < THROTTLE_MS) return;
      lastReset.current = now;
      arm();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") arm();
    };

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "keydown",
      "touchstart",
      "scroll",
      "click",
    ];
    // capture: true porque desde que el panel scrollea en un div interno y no en la ventana,
    // el evento "scroll" no burbujea; sin esto, leer una lista con la rueda deja de contar
    // como actividad y la sesión se cierra sola a los 30 minutos. Tiene que ser el MISMO
    // objeto de opciones en el removeEventListener o el listener no se desregistra.
    const listenerOpts: AddEventListenerOptions = { passive: true, capture: true };
    events.forEach((e) => window.addEventListener(e, onActivity, listenerOpts));
    document.addEventListener("visibilitychange", onVisibility);
    arm();

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, onActivity, listenerOpts));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
