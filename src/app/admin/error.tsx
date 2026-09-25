"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, WifiOff } from "lucide-react";
import { AUTO_REFRESH_INTERVAL_MS, probeServer, useAutoRefresh } from "./useAutoRefresh";

/**
 * true desde que "Reintentar" manda a recargar hasta que se sabe cómo salió. Vive fuera
 * del cartel porque, si la recarga vuelve a fallar, Next arma el cartel de nuevo desde
 * cero: el cartel nuevo lo lee al aparecer para decir que sigue sin andar. Lo apaga el
 * cartel que se va (el viejo si volvió a fallar; este mismo si la pantalla volvió).
 */
let manualRetryInFlight = false;

/**
 * Pantalla de error de todo `/admin`: aparece cuando, en una recarga (por ejemplo, la de
 * Hoy cada 30 s), falla una consulta de la página, en lugar de la pantalla genérica de
 * Next, en inglés. Reemplaza solo la página: el layout de `/admin` sigue montado, con el
 * menú y el cierre de sesión por inactividad.
 *
 * No cubre a Supabase caído entero. Ahí lo primero que falla es la lectura de la sesión o
 * del rol en el middleware (`src/lib/supabase/middleware.ts`), que manda a `/login` o a
 * `/forbidden` antes de llegar a la página, fuera del panel. Este cartel sale cuando la
 * sesión y el rol se leyeron bien y después falla una consulta de la página.
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
  // Cómo salió el último toque de "Reintentar": sin conexión (no recargó) o volvió a fallar.
  const [notice, setNotice] = useState<"offline" | "failed" | null>(() =>
    manualRetryInFlight ? "failed" : null
  );
  // La pregunta al servidor del botón, para cortarla si el cartel se va mientras espera.
  const probeRef = useRef<ReturnType<typeof probeServer> | null>(null);

  useEffect(() => {
    console.error("[admin] no se pudo actualizar la pantalla:", error);
  }, [error]);

  useEffect(
    () => () => {
      probeRef.current?.cancel();
      probeRef.current = null;
      manualRetryInFlight = false;
    },
    []
  );

  // Pide la pantalla de nuevo al servidor y la vuelve a pintar, en una sola transición:
  // si sale bien, este cartel se va; si vuelve a fallar, Next arma uno nuevo. Es lo mismo
  // que hace el `retry` que Next 16.3 le pasa a este archivo.
  const reload = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  // El botón pregunta antes si el servidor contesta, igual que el reintento automático. Sin
  // conexión, `router.refresh()` falla y Next recarga la página entera: Chrome cambiaría
  // este cartel por su página de "Sin conexión" y se irían el menú y el reintento.
  const retryFromButton = () => {
    if (isPending) return;
    setNotice(null);
    startTransition(async () => {
      let answers = false;
      if (navigator.onLine !== false) {
        const current = probeServer();
        probeRef.current = current;
        answers = await current.answers;
        if (probeRef.current === current) probeRef.current = null;
      }
      if (!answers) {
        setNotice("offline");
        return;
      }
      manualRetryInFlight = true;
      reload();
    });
  };

  // Reintenta sola cada 30 s y al volver a la pestaña, con las mismas pausas que Hoy:
  // pestaña oculta, sin red o sin respuesta del servidor (así una recarga sin conexión no
  // cambia este cartel por la página de error de Chrome), un cuadro abierto o un campo
  // con el foco.
  useAutoRefresh({ onRefresh: reload });

  return (
    <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
      <div
        role="alert"
        className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8 max-w-md w-full space-y-5"
      >
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
            <WifiOff size={22} aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold text-slate-800">No se pudo actualizar la pantalla.</h1>
            <p className="text-sm text-slate-600">Revisá la conexión y tocá Reintentar.</p>
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

        {notice && !isPending && (
          <p role="status" className="text-sm font-medium text-amber-700 text-center">
            {notice === "offline"
              ? "Todavía no hay conexión. Lo vuelve a intentar sola."
              : "Sigue sin andar. Probá de nuevo en un rato."}
          </p>
        )}
      </div>
    </div>
  );
}
