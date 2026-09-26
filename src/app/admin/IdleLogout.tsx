"use client";

import { useEffect, useRef } from "react";
import { logout } from "@/app/login/actions";

// Cierre de sesión por inactividad para recepción. Se cierra la SESIÓN (no la caja: la caja
// es del hotel y sobrevive). Evita que otro opere con la sesión de un recepcionista que se fue.
const IDLE_MS = 30 * 60 * 1000;
const THROTTLE_MS = 5000;

export default function IdleLogout() {
  const timer = useRef<number | null>(null);
  const lastReset = useRef(0);

  useEffect(() => {
    const arm = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void logout();
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

    // Lo que hace una persona: mover el mouse o el dedo, tocar, hacer clic, la rueda, una
    // tecla. `scroll` NO: también lo dispara la pantalla sola, por ejemplo cuando Hoy se
    // pone al día cada 30 s y cambia el alto de algo arriba de la grilla; con eso la sesión
    // de una PC abandonada en Hoy no se cerraba nunca. Quien lee una lista la desplaza con la
    // rueda (`wheel`), el dedo (`touchmove`), el teclado (`keydown`) o arrastrando la barra
    // (`pointerdown`), así que ese uso sigue contando.
    const events: (keyof WindowEventMap)[] = [
      "pointermove",
      "pointerdown",
      "mousemove",
      "click",
      "wheel",
      "touchstart",
      "touchmove",
      "keydown",
    ];
    // capture: true porque desde que el panel scrollea en un div interno y no en la ventana,
    // la rueda y el dedo empiezan en un elemento de adentro y un cuadro puede cortar la
    // propagación; en captura la ventana los ve igual. Tiene que ser el MISMO
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
