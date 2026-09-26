"use client";

import { hotelTimeKey } from "@/lib/time";
import { SESSION_CLOSED_NOTICE, useAutoRefresh } from "./useAutoRefresh";

/**
 * Pone al día Hoy cada 30 segundos y al volver a la pestaña, sin interrumpir a quien
 * está escribiendo. Existe para poder usar el hook desde una página que es server
 * component.
 *
 * Mientras anda no pinta nada. Si no se pudo poner al día en 3 chequeos seguidos, pinta
 * una línea chica, en el flujo, arriba del encabezado: "Hoy no se actualiza desde las
 * HH:MM." (la hora del hotel) y, si el último chequeo recibió una redirección, cómo volver
 * a entrar. Corre la pantalla una línea y no tapa nada. Se va sola con el primer chequeo
 * que anda.
 */
export default function AutoRefresh({ timezone }: { timezone: string }) {
  const trouble = useAutoRefresh();
  if (!trouble) return null;

  // "HH:MM" en 24 hs y en la zona del hotel, no la de la PC. `formatHotelTime` no sirve:
  // según el navegador escribe "10:00 a. m.".
  const since = hotelTimeKey(trouble.since, timezone);
  return (
    <p
      role="status"
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-900 md:px-8 print:hidden"
    >
      <span>{`Hoy no se actualiza desde las ${since}.`}</span>
      {trouble.reason === "redirect" && (
        <>
          {" "}
          <span>{SESSION_CLOSED_NOTICE}</span>
        </>
      )}
    </p>
  );
}
