"use client";

import { hotelTimeKey } from "@/lib/time";
import { useAutoRefresh, type RefreshTrouble } from "./useAutoRefresh";

/**
 * Qué hacer cuando la pregunta al servidor no llegó (internet cortado, la PC sin red, sin
 * respuesta en 5 s): revisar internet, sin recargar. F5 sin internet cambiaría Hoy por la
 * página de error de Chrome; esperando, Hoy se pone al día sola con el primer chequeo que
 * anda. Texto de Agustín (26/09).
 */
const NO_CONNECTION_HINT =
  "Fijate que haya internet. No hace falta recargar: se pone al día sola cuando vuelve.";

/**
 * Qué hacer cuando el servidor contestó con un error (el 502 del hosting durante un deploy,
 * un 404): internet anda, así que no manda a revisarlo. Tampoco hace falta recargar.
 */
const SERVER_ERROR_HINT =
  "El sistema no responde. No hace falta recargar: se pone al día sola cuando vuelve.";

/** Lo que dice el enlace para volver a entrar (ver `SessionClosedNotice`). */
export const REENTER_LABEL = "Volver a entrar";

/**
 * Lo que dicen Hoy y la pantalla de error de `/admin` cuando el chequeo recibe una
 * redirección: la sesión se cerró o el sistema no responde (desde el navegador no se
 * distinguen). Trae el enlace para volver a entrar, que anda en la PC, en el celular y en
 * la tablet (no todos tienen F5). Es un enlace común y no el de Next: pide el panel entero,
 * como F5, y el proxy lleva a la pantalla de ingreso si la sesión no sirve. Si el que no
 * contesta es el sistema, tampoco anda: por eso "si sigue así".
 */
export function SessionClosedNotice() {
  return (
    <>
      Se cerró la sesión o el sistema no responde. Si sigue así, tocá{" "}
      <a href="/admin" className="font-bold underline">
        {REENTER_LABEL}
      </a>
      .
    </>
  );
}

/** Qué hacer, según cómo salió el último chequeo. */
function TroubleHint({ reason }: { reason: RefreshTrouble["reason"] }) {
  if (reason === "redirect") return <SessionClosedNotice />;
  return <>{reason === "server" ? SERVER_ERROR_HINT : NO_CONNECTION_HINT}</>;
}

/**
 * Pone al día Hoy cada 30 segundos, al volver a la pestaña y al volver con Atrás, sin
 * interrumpir a quien está escribiendo. Existe para poder usar el hook desde una página que
 * es server component.
 *
 * Mientras anda no pinta nada. Si no se pudo poner al día en 3 chequeos seguidos, pinta
 * una línea chica, en el flujo, arriba del encabezado: "Hoy no se actualiza desde las
 * HH:MM." (la hora del hotel) y qué hacer según el último chequeo: con una redirección,
 * cómo volver a entrar; si el servidor contestó con un error, que el sistema no responde y
 * que no hace falta recargar; si la pregunta no llegó, que se fijen en internet y que no
 * hace falta recargar. Corre la pantalla una línea y no tapa nada. Se va sola con el primer
 * chequeo que anda. Aparece, se va o cambia recién cuando la pantalla lleva 2 s quieta (lo
 * decide el hook): así no corre la grilla justo cuando alguien va a tocar un botón.
 *
 * `renderedAt` es cuándo armó el servidor la página (`Date.now()`): la hora de la línea es
 * la de los datos que se ven, también cuando se vuelve a Hoy con Atrás y Next la saca de su
 * caché, y con eso el hook reconoce esa vuelta para ponerse al día a tiempo (ver
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
      <span>
        <TroubleHint reason={trouble.reason} />
      </span>
    </p>
  );
}
