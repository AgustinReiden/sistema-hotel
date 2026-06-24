"use client";

import { useEffect } from "react";

export default function ScrollToResults() {
  useEffect(() => {
    const el = document.getElementById("habitaciones");
    if (!el) return;

    // Scroll suave al entrar a los resultados, y una correccion instantanea poco despues:
    // si el layout se acomoda (imagenes del hero/habitaciones, fuentes) el scroll suave
    // puede quedar "a medio camino", asi que reasentamos la posicion final.
    const scrollSmooth = () => el.scrollIntoView({ behavior: "smooth", block: "start" });
    const scrollSnap = () => el.scrollIntoView({ behavior: "auto", block: "start" });

    const raf = requestAnimationFrame(scrollSmooth);
    const correction = window.setTimeout(scrollSnap, 600);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(correction);
    };
  }, []);

  return null;
}
