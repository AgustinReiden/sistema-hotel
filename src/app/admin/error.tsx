"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, WifiOff } from "lucide-react";
import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh } from "./useAutoRefresh";

/**
 * Pantalla de error de todo `/admin`: aparece cuando falla una recarga (por ejemplo, la de
 * Hoy cada 30 s con Supabase caído un momento) en lugar de la pantalla genérica de Next,
 * en inglés. Reemplaza solo la página: el layout de `/admin` sigue montado, con el menú y
 * el cierre de sesión por inactividad.
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

  useEffect(() => {
    console.error("[admin] no se pudo actualizar la pantalla:", error);
  }, [error]);

  // Pide la pantalla de nuevo al servidor y la vuelve a pintar, en una sola transición:
  // mientras llega, queda este cartel; si vuelve a fallar, vuelve este cartel. Es lo mismo
  // que hace el `retry` que Next 16.3 le pasa a este archivo.
  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  // Reintenta sola cada 30 s y al volver a la pestaña, con las mismas pausas que Hoy:
  // pestaña oculta, sin red o sin respuesta del servidor (así una recarga sin conexión no
  // cambia este cartel por la página de error de Chrome), un cuadro abierto o un campo
  // con el foco.
  useAutoRefresh({ onRefresh: retry });

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
          onClick={retry}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-700 hover:bg-brand-800 text-white font-bold rounded-xl transition-colors"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Reintentar
        </button>
      </div>
    </div>
  );
}
