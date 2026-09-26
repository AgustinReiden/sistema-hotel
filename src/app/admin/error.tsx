"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  AUTO_REFRESH_INTERVAL_MS,
  probeServer,
  SESSION_CLOSED_NOTICE,
  useAutoRefresh,
  type ProbeResult,
} from "./useAutoRefresh";

/**
 * Cuándo (`Date.now()`) "Reintentar" mandó a recargar, con la conexión y la sesión ya
 * comprobadas; null si no hay un toque pendiente. Vive fuera del cartel porque, si la
 * recarga vuelve a fallar, Next arma el cartel de nuevo desde cero: el cartel nuevo la lee
 * al aparecer para decir que la conexión anda pero la pantalla no carga.
 *
 * El cartel viejo no la puede apagar al irse: `admin/loading.tsx` está dentro de este
 * cartel, así que al reintentar Next lo cambia por "Cargando…" mientras llega la respuesta,
 * y el cartel nuevo aparece recién después (segundos, si una consulta tarda en fallar). La
 * apaga el cartel nuevo al aparecer. Si la pantalla volvió, no aparece ninguno: por eso la
 * marca vale solo `MANUAL_RETRY_WINDOW_MS` desde el toque.
 */
let manualRetryAt: number | null = null;

/**
 * Hasta cuánto después del toque un cartel nuevo se toma como el resultado de ese toque.
 * Cubre una consulta que tarda en fallar. Si la pantalla volvió, el error siguiente llega
 * con la recarga de Hoy, 30 s después de que volvió: ya queda afuera.
 */
const MANUAL_RETRY_WINDOW_MS = AUTO_REFRESH_INTERVAL_MS;

/** ¿Este cartel es el resultado de un toque a "Reintentar" que llegó a recargar? */
function comesFromManualRetry(): boolean {
  return manualRetryAt !== null && Date.now() - manualRetryAt < MANUAL_RETRY_WINDOW_MS;
}

/**
 * Pantalla de error de todo `/admin`: aparece cuando, en una recarga (por ejemplo, la de
 * Hoy cada 30 s), falla una consulta de la página, en lugar de la pantalla genérica de
 * Next, en inglés. Reemplaza solo la página: el layout de `/admin` sigue montado, con el
 * menú y el cierre de sesión por inactividad.
 *
 * Sale cuando la sesión y el rol se leyeron bien y después falla una consulta de la página.
 * A Supabase caído entero no lo muestra este cartel: ahí el chequeo previo (`probeServer`,
 * que pasa por el proxy) ve la redirección a `/login` o a `/forbidden` y la recarga no sale,
 * así que Hoy (o este cartel) queda en pantalla, dentro del panel. Lo mismo con la sesión
 * cerrada desde otro dispositivo. Hoy lo avisa a los 3 chequeos fallidos (`AutoRefresh`);
 * este cartel, al tocar "Reintentar".
 *
 * No muestra el mensaje técnico del error: puede traer datos. Va a la consola, con el
 * digest para buscarlo en los registros del servidor.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  // true mientras se reintenta (la pregunta al servidor y la recarga): el botón lo muestra.
  const [isPending, startTransition] = useTransition();
  // Cómo salió el último toque de "Reintentar": sin conexión (no recargó), con la sesión
  // cerrada o el sistema sin contestar (el chequeo recibió una redirección: no recargó) o
  // recargó y la pantalla volvió a fallar.
  const [notice, setNotice] = useState<"offline" | "session" | "failed" | null>(() =>
    comesFromManualRetry() ? "failed" : null
  );
  // La pregunta al servidor del botón, para cortarla si el cartel se va mientras espera.
  const probeRef = useRef<ReturnType<typeof probeServer> | null>(null);

  useEffect(() => {
    console.error("[admin] no se pudo actualizar la pantalla:", error);
  }, [error]);

  // Este cartel ya leyó la marca del toque: el que venga después no la vuelve a usar.
  useEffect(() => {
    manualRetryAt = null;
  }, []);

  useEffect(
    () => () => {
      probeRef.current?.cancel();
      probeRef.current = null;
    },
    []
  );

  // Pide la pantalla de nuevo al servidor y la vuelve a pintar, en una sola transición.
  // Es lo mismo que hace el `retry` que Next 16.3 le pasa a este archivo. Mientras llega la
  // respuesta, Next cambia este cartel por "Cargando…" (`admin/loading.tsx`): si sale bien,
  // vuelve la pantalla; si vuelve a fallar, Next arma un cartel nuevo.
  const reload = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  // El botón pasa por el mismo chequeo que el reintento automático (`/admin/ping`, por el
  // proxy). Sin conexión, `router.refresh()` falla y Next recarga la página entera: Chrome
  // cambiaría este cartel por su página de "Sin conexión" y se irían el menú y el reintento.
  // Y sin sesión o sin Supabase, la recarga terminaría en `/login` o en `/forbidden`: ahí
  // el aviso no dice "sin conexión" (internet anda) sino cómo volver a entrar ("Salir" en
  // otro dispositivo cierra la sesión en todos).
  const retryFromButton = () => {
    if (isPending) return;
    setNotice(null);
    startTransition(async () => {
      let result: ProbeResult = "failed";
      if (navigator.onLine !== false) {
        const current = probeServer();
        probeRef.current = current;
        result = await current.result;
        if (probeRef.current === current) probeRef.current = null;
      }
      if (result !== "ok") {
        setNotice(result === "redirect" ? "session" : "offline");
        return;
      }
      manualRetryAt = Date.now();
      reload();
    });
  };

  // Reintenta sola cada 30 s y al volver a la pestaña, con las mismas pausas que Hoy:
  // pestaña oculta, sin red o si el chequeo da que no (así una recarga sin conexión no
  // cambia este cartel por la página de error de Chrome), un cuadro abierto, un campo con
  // el foco o alguien usando la pantalla (espera a que quede quieta 2 s). Cada reintento
  // cambia el cartel por "Cargando…" hasta que vuelve la respuesta (ver `reload`).
  useAutoRefresh({ onRefresh: reload });

  return (
    <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
      <div
        role="alert"
        className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8 max-w-md w-full space-y-5"
      >
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
            <AlertTriangle size={22} aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-slate-800">No se pudo cargar la pantalla.</h1>
            {/* La causa puede ser la conexión o una consulta que falla: dice qué hacer en los dos casos. */}
            <p className="text-sm text-slate-600">
              Fijate que haya internet y tocá Reintentar. Si sigue igual, avisale al encargado.
            </p>
            <p className="text-xs text-slate-400">
              La pantalla lo vuelve a intentar sola cada {AUTO_REFRESH_INTERVAL_MS / 1000} segundos.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={retryFromButton}
          disabled={isPending}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-70 disabled:cursor-wait text-white font-bold rounded-xl transition-colors"
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={isPending ? "animate-spin" : undefined}
          />
          {isPending ? "Reintentando…" : "Reintentar"}
        </button>

        {/* "failed": el chequeo dio bien (conexión, sesión y rol) y la recarga igual falló. */}
        {notice && !isPending && (
          <p role="status" className="text-sm font-medium text-amber-700 text-center">
            {notice === "offline"
              ? `Sigue sin conexión. Se vuelve a intentar sola en ${AUTO_REFRESH_INTERVAL_MS / 1000} s.`
              : notice === "session"
                ? SESSION_CLOSED_NOTICE
                : "La conexión anda, pero la pantalla no carga. Avisale al encargado."}
          </p>
        )}
      </div>
    </div>
  );
}
