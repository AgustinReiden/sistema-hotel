"use client";

import { hotelTimeKey } from "@/lib/time";
import { SESSION_CLOSED_NOTICE, useAutoRefresh } from "./useAutoRefresh";

/**
 * Qué hacer cuando la causa no es la sesión (internet cortado, el servidor que no contesta,
 * la PC sin red): revisar internet, sin recargar. F5 sin internet cambiaría Hoy por la
 * página de error de Chrome; esperando, Hoy se pone al día sola con el primer chequeo que
 * anda. Texto de Agustín (26/09).
 */
const NO_CONNECTION_HINT =
  "Fijate que haya internet. No hace falta recargar: se pone al día sola cuando vuelve.";

/**
 * Pone al día Hoy cada 30 segundos, al volver a la pestaña y al volver con Atrás, sin
 * interrumpir a quien está escribiendo. Existe para poder usar el hook desde una página que
 * es server component.
 *
 * Mientras anda no pinta nada. Si no se pudo poner al día en 3 chequeos seguidos, pinta
 * una línea chica, en el flujo, arriba del encabezado: "Hoy no se actualiza desde las
 * HH:MM." (la hora del hotel) y qué hacer: si el último chequeo recibió una redirección,
 * cómo volver a entrar; si no, que se fijen en internet y que no hace falta recargar. Corre
 * la pantalla una línea y no tapa nada. Se va sola con el primer chequeo que anda. Aparece,
 * se va o cambia recién cuando la pantalla lleva 2 s quieta (lo decide el hook): así no
 * corre la grilla justo cuando alguien va a tocar un botón.
 *
 * `renderedAt` es cuándo armó el servidor la página (`Date.now()`): la hora de la línea es
 * la de los datos que se ven, también cuando se vuelve a Hoy con Atrás y Next la saca de su
 * caché, y con eso el hook reconoce esa vuelta para ponerse al día enseguida (ver
 * `renderedAt` en `useAutoRefresh`).
 */
export default function AutoRefresh({
  timezone,
  renderedAt,
}: {
  timezone: string;
  renderedAt?: number;
}) {
  const trouble = useAutoRefresh({ renderedAt });
  if (!trouble) return null;

  // "HH:MM" en 24 hs y en la zona del hotel, no la de la PC. `formatHotelTime` no sirve:
  // según el navegador escribe "10:00 a. m.".
  const since = hotelTimeKey(trouble.since, timezone);
  return (
    <p
      role="status"
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-900 md:px-8 print:hidden"
    >
      <span>{`Hoy no se actualiza desde las ${since}.`}</span>{" "}
      <span>{trouble.reason === "redirect" ? SESSION_CLOSED_NOTICE : NO_CONNECTION_HINT}</span>
    </p>
  );
}
