"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Package } from "lucide-react";
import { toast } from "sonner";

import { formatAmount } from "@/lib/format";
import { estadoPaquete } from "@/lib/remitos";
import { formatHotelDate } from "@/lib/time";
import type { RemitoPaqueteFactura } from "@/lib/types";
import { pedirPaqueteAction } from "./actions";

type Props = { facturas: RemitoPaqueteFactura[]; clienteElegido: boolean; nowMs: number };

/** PDF con los remitos firmados de cada consolidada del cliente (mig 124, lo arma n8n). */
export default function PaquetesSection({ facturas, clienteElegido, nowMs }: Props) {
  const router = useRouter();
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const hayArmando = facturas.some((f) => estadoPaquete(f, nowMs).armando);

  // Mientras n8n arma (tarda un minuto o dos), la lista se refresca sola.
  useEffect(() => {
    if (!hayArmando) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [hayArmando, router]);

  async function pedir(invoiceId: string) {
    setPidiendo(invoiceId);
    const r = await pedirPaqueteAction(invoiceId);
    setPidiendo(null);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success("Paquete pedido. En uno o dos minutos está listo.");
    router.refresh();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl" aria-label="Paquetes por factura">
      <h2 className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-700 flex items-center gap-2">
        <Package size={16} /> Paquetes por factura
      </h2>
      {!clienteElegido ? (
        <p className="px-4 py-3 text-sm text-slate-600">Elegí un cliente para ver sus facturas consolidadas y armar el PDF de remitos.</p>
      ) : facturas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-600">Este cliente no tiene facturas consolidadas vigentes.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {facturas.map((f) => {
            const e = estadoPaquete(f, nowMs);
            return (
              <li key={f.invoice_id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm">
                    <span className="font-mono font-semibold">{f.factura_texto}</span>
                    <span className="text-slate-600">
                      {f.cbte_fch ? ` · ${formatHotelDate(f.cbte_fch)}` : ""} · {formatAmount(f.imp_total)}
                    </span>
                  </p>
                  <p className="text-xs text-slate-700">{`${f.remitos_firmados} de ${f.remitos_total} firmados`}</p>
                  {f.constancia && (
                    <p className="text-xs text-amber-800">
                      {`Emitida sin ${f.constancia.faltantes} ${f.constancia.faltantes === 1 ? "remito" : "remitos"} — motivo: ${f.constancia.motivo}`}
                      {f.constancia.usuario ? ` — ${f.constancia.usuario}` : ""}, {formatHotelDate(f.constancia.created_at)}
                    </p>
                  )}
                  {e.texto && <p className="text-xs text-rose-700">{e.texto}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {f.paquete?.estado === "listo" && f.paquete.drive_link && (
                    <a
                      href={f.paquete.drive_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
                    >
                      <Download size={14} /> Descargar
                    </a>
                  )}
                  {e.armando && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                      <Loader2 size={14} className="animate-spin" /> Armando…
                    </span>
                  )}
                  {e.puedeArmar && (
                    <button
                      type="button"
                      disabled={pidiendo !== null}
                      onClick={() => void pedir(f.invoice_id)}
                      className="text-xs px-2 py-1 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {f.paquete ? "Volver a armar" : "Armar paquete"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
