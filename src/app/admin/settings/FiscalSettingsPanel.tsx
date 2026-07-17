"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  XCircle,
} from "lucide-react";

import {
  arcaHealthAction,
  updateFiscalSettingsAction,
  type ArcaHealthReport,
} from "../fiscal/actions";
import type { FiscalSettings } from "@/lib/types";

function HealthRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
      ) : (
        <XCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
      )}
      <span>
        <span className="font-semibold text-slate-700">{label}:</span>{" "}
        <span className="text-slate-500">{detail}</span>
      </span>
    </li>
  );
}

export default function FiscalSettingsPanel({ settings }: { settings: FiscalSettings | null }) {
  const [isPending, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);
  const [health, setHealth] = useState<ArcaHealthReport | null>(null);
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateFiscalSettingsAction(formData);
      if (result.success) {
        toast.success("Configuración fiscal guardada.");
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setHealth(null);
    const result = await arcaHealthAction();
    setTesting(false);
    if (result.success) {
      setHealth(result.data!);
    } else {
      toast.error(result.error);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 max-w-4xl bg-white p-8 rounded-xl border border-slate-200 shadow-sm mt-8"
    >
      <div className="flex items-center justify-between border-b pb-2">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <FileText size={18} className="text-slate-500" />
          Facturación electrónica (ARCA)
        </h3>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 accent-emerald-600"
          />
          Habilitada
        </label>
      </div>

      {enabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            Con la facturación habilitada, el check-out va a ofrecer &quot;¿Emitir factura?&quot; a
            recepción. En ambiente <span className="font-bold">homologación</span> los comprobantes
            son de prueba (sin valor fiscal); en <span className="font-bold">producción</span> son
            facturas reales.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Ambiente</label>
          <select
            name="environment"
            defaultValue={settings?.environment ?? "homologacion"}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm"
          >
            <option value="homologacion">Homologación (pruebas, sin valor fiscal)</option>
            <option value="produccion">Producción (facturas reales)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">CUIT (11 dígitos)</label>
          <input
            name="cuit"
            defaultValue={settings?.cuit ?? ""}
            placeholder="30123456789"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Razón social</label>
          <input
            name="razon_social"
            defaultValue={settings?.razon_social ?? ""}
            placeholder="Hotel El Refugio S.R.L."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Domicilio comercial</label>
          <input
            name="domicilio_fiscal"
            defaultValue={settings?.domicilio_fiscal ?? ""}
            placeholder="Ruta 16 492 - Taco Pozo, Chaco"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            El que va impreso en la factura (el del punto de venta / establecimiento).
          </p>
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Ingresos Brutos</label>
          <input
            name="iibb"
            defaultValue={settings?.iibb ?? ""}
            placeholder="Nº de IIBB o Exento"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">Inicio de actividades</label>
          <input
            type="date"
            name="inicio_actividades"
            defaultValue={settings?.inicio_actividades ?? ""}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1">
            Punto de venta (modalidad Web Services)
          </label>
          <input
            type="number"
            name="punto_venta"
            min={1}
            max={99998}
            defaultValue={settings?.punto_venta ?? ""}
            placeholder="3"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Exclusivo para la app. Se da de alta en el portal de ARCA con clave fiscal.
          </p>
        </div>
      </div>

      <div className="text-[11px] text-slate-400">
        El certificado digital y la clave interna NO se cargan acá: viven como variables de entorno
        del servidor (ARCA_CERT_B64, ARCA_KEY_B64, ARCA_INTERNAL_KEY). Al guardar, la clave interna
        del servidor se sincroniza sola.
      </div>

      <div className="flex gap-3 justify-end border-t pt-4">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="px-5 py-2.5 border border-slate-300 text-slate-700 font-bold rounded-xl hover:bg-slate-50 disabled:opacity-70 transition-colors flex items-center gap-2"
        >
          {testing ? <Loader2 className="animate-spin" size={16} /> : <Activity size={16} />}
          Probar conexión ARCA
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white font-bold rounded-xl transition-colors flex items-center gap-2"
        >
          {isPending && <Loader2 className="animate-spin" size={16} />}
          Guardar configuración fiscal
        </button>
      </div>

      {health && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            Diagnóstico de conexión
          </p>
          <ul className="space-y-1.5">
            <HealthRow
              ok={health.configured}
              label="Certificado en el servidor"
              detail={
                health.configured
                  ? `${health.certSubject ?? ""}${
                      health.certExpiresAt
                        ? ` — vence ${new Date(health.certExpiresAt).toLocaleDateString("es-AR")}`
                        : ""
                    }${health.certExpiresSoon ? " ⚠ vence en menos de 30 días" : ""}`
                  : "faltan ARCA_CERT_B64 / ARCA_KEY_B64 / ARCA_INTERNAL_KEY"
              }
            />
            <HealthRow ok={health.dummy.ok} label="Servidores de ARCA (FEDummy)" detail={health.dummy.detail} />
            <HealthRow ok={health.wsaa.ok} label="Autenticación (WSAA)" detail={health.wsaa.detail} />
            <HealthRow
              ok={health.lastAuthorized.ok}
              label="Punto de venta (último autorizado)"
              detail={health.lastAuthorized.detail}
            />
          </ul>
        </div>
      )}
    </form>
  );
}
