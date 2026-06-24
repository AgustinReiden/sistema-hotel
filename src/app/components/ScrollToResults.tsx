"use client";

import { useEffect } from "react";

export default function ScrollToResults() {
  useEffect(() => {
    // Apuntamos a las tarjetas (#resultados) para que se vea el boton "Reservar",
    // no al encabezado de la seccion. Fallback a la seccion completa por las dudas.
    const el =
      document.getElementById("resultados") ?? document.getElementById("habitaciones");
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
