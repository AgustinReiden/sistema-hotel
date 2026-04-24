"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import LogoutButton from "../admin/LogoutButton";

export default function MaintenanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Maintenance] render error:", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 max-w-lg w-full space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
            <AlertTriangle size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">
              No pudimos cargar tu tablero
            </h1>
            <p className="text-sm text-slate-500">
              Tuvimos un problema al abrir el panel de mantenimiento.
            </p>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 font-mono break-words">
          {error.message || "Error desconocido"}
          {error.digest && (
            <div className="mt-1 text-slate-400">digest: {error.digest}</div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => reset()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-colors"
          >
            <RefreshCw size={16} />
            Reintentar
          </button>
          <div className="flex-1">
            <LogoutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
