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

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "keydown",
      "touchstart",
      "scroll",
      "click",
    ];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    arm();

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
