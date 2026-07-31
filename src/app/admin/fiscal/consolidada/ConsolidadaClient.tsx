"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { isValidCuit } from "@/lib/arca/amounts";
import type {
  CcChargeToInvoiceRow,
  CtaCteAccount,
  CtaCteClientKind,
  InvoiceReceptorPrefill,
  ReceptorCondicionCuit,
} from "@/lib/types";
import { emitConsolidatedInvoiceAction, loadCcChargesAction } from "./actions";

type Props = {
  enabled: boolean;
  accounts: CtaCteAccount[];
  /** Datos de facturación por ficha, indexados `${kind}:${id}` (mig 81). */
  billingProfiles: Record<string, InvoiceReceptorPrefill>;
  preselectKind: CtaCteClientKind | null;
  preselectId: string | null;
};

function money(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function openInvoicePrint(invoiceId: string) {
  if (typeof window === "undefined") return;
  window.open(`/admin/factura/${invoiceId}?autoprint=1`, `factura-${invoiceId}`, "width=420,height=720");
}

const inputClass =
  "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all";

export default function ConsolidadaClient({
  enabled,
  accounts,
  billingProfiles,
  preselectKind,
  preselectId,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string>(
    preselectKind && preselectId ? `${preselectKind}:${preselectId}` : ""
  );
  const [rows, setRows] = useState<CcChargeToInvoiceRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [emitting, setEmitting] = useState(false);

  // Receptor: se precarga de la ficha y el admin puede corregirlo antes de emitir.
  const [razonSocial, setRazonSocial] = useState("");
  const [cuit, setCuit] = useState("");
  const [condicionIva, setCondicionIva] = useState<ReceptorCondicionCuit | "">("");
  const [domicilio, setDomicilio] = useState("");

  const [kind, id] = selectedKey ? (selectedKey.split(":") as [CtaCteClientKind, string]) : [null, null];
  const isCompany = kind === "company";
  const profile = selectedKey ? billingProfiles[selectedKey] ?? null : null;

  const loadRows = useCallback(async () => {
    if (!kind || !id) {
      setRows([]);
      setPicked(new Set());
      return;
    }
    setLoading(true);
    const result = await loadCcChargesAction(kind, id);
    setLoading(false);
    if (!result.success) {
      toast.error(result.error);
      setRows([]);
      setPicked(new Set());
      return;
    }
    setRows(result.data ?? []);
    // Por defecto se selecciona todo: el caso normal es "facturame todo lo pendiente".
    setPicked(new Set((result.data ?? []).map((r) => r.reservation_id)));
  }, [kind, id]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // Precargar los datos fiscales de la ficha elegida (empresa o huésped).
  useEffect(() => {
    setRazonSocial(profile?.razonSocial ?? "");
    setCuit(profile?.cuit ?? "");
    setCondicionIva(profile?.condicionIva ?? "");
    setDomicilio(profile?.domicilio ?? "");
  }, [profile]);

  const selectedRows = rows.filter((r) => picked.has(r.reservation_id));
  const total = selectedRows.reduce((sum, r) => sum + r.amount, 0);
  // La empresa siempre se factura con CUIT. Un huésped, sólo si su ficha tiene
  // condición IVA cargada (mig 81); si no, B con DNI, que es el default de siempre.
  const requiereCuit = isCompany || condicionIva !== "";
  const letra = !requiereCuit ? "B" : condicionIva === "exento" ? "B" : "A";

  const toggle = (reservationId: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(reservationId)) next.delete(reservationId);
      else next.add(reservationId);
      return next;
    });
  };

  const toggleAll = () => {
    setPicked((current) =>
      current.size === rows.length ? new Set() : new Set(rows.map((r) => r.reservation_id))
    );
  };

  const emit = async () => {
    if (!kind || !id) return;
    if (selectedRows.length === 0) {
      toast.error("Seleccioná al menos una estadía.");
      return;
    }
    if (requiereCuit) {
      if (!condicionIva) {
        toast.error("Elegí la condición frente al IVA.");
        return;
      }
      if (!isValidCuit(cuit.replace(/\D/g, ""))) {
        toast.error("El CUIT no es válido (11 dígitos con dígito verificador).");
        return;
      }
      if (!razonSocial.trim()) {
        toast.error("Ingresá la razón social.");
        return;
      }
      if (!domicilio.trim()) {
        toast.error("Ingresá el domicilio del receptor.");
        return;
      }
    }

    setEmitting(true);
    const result = await emitConsolidatedInvoiceAction({
      kind,
      clientId: id,
      reservationIds: selectedRows.map((r) => r.reservation_id),
      ...(requiereCuit
        ? {
            cuit: cuit.replace(/\D/g, ""),
            condicionIva: condicionIva as ReceptorCondicionCuit,
            razonSocial: razonSocial.trim(),
            domicilio: domicilio.trim(),
          }
        : {}),
    });
    setEmitting(false);

    if (!result.success) {
      toast.error(result.error);
      await loadRows();
      return;
    }

    const outcome = result.data;
    if (outcome?.status === "authorized" && outcome.invoiceId) {
      toast.success(`Factura ${letra} ${outcome.numero ?? ""} emitida (${outcome.count} estadías).`);
      openInvoicePrint(outcome.invoiceId);
    } else {
      toast.warning(outcome?.userMessage ?? "La factura quedó pendiente. Revisala en Facturación.");
    }
    await loadRows();
  };

  if (!enabled) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
        <p className="text-sm text-slate-500">
          La facturación electrónica no está habilitada. Activala en Ajustes → Facturación electrónica.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1) Cliente */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="consolidada-cliente">
          Cliente de cuenta corriente
        </label>
        <select
          id="consolidada-cliente"
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className={inputClass}
        >
          <option value="">Elegí un cliente…</option>
          {accounts.map((a) => (
            <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>
              {a.name} {a.kind === "company" ? "(empresa)" : "(huésped)"} — saldo ${money(a.balance)}
            </option>
          ))}
        </select>
      </section>

      {/* 2) Estadías sin facturar */}
      {selectedKey && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-800">Estadías sin facturar</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Se factura el cargo a cuenta corriente de cada estadía, no el total de la reserva.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadRows()}
              disabled={loading}
              className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors"
              title="Recargar"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="p-5">
            {loading ? (
              <p className="text-sm text-slate-400 text-center py-4">Cargando…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">
                Este cliente no tiene estadías pendientes de facturar 🎉
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs font-bold text-emerald-700 hover:text-emerald-800 mb-3"
                >
                  {picked.size === rows.length ? "Deseleccionar todo" : "Seleccionar todo"}
                </button>
                <ul className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <li key={r.reservation_id} className="py-2.5 flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={picked.has(r.reservation_id)}
                        onChange={() => toggle(r.reservation_id)}
                        className="w-4 h-4 accent-emerald-600 shrink-0"
                        aria-label={`Incluir estadía de habitación ${r.room_number ?? "?"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          Hab. {r.room_number ?? "—"} · {shortDate(r.fch_desde)} → {shortDate(r.fch_hasta)}
                          {r.passenger ? ` · ${r.passenger}` : ""}
                        </p>
                        {r.mixed_payment && (
                          <p className="text-[11px] text-amber-600 flex items-center gap-1 mt-0.5">
                            <AlertTriangle size={11} className="shrink-0" />
                            Pago mixto: se factura sólo el cargo a cuenta (${money(r.amount)} de $
                            {money(r.total_price)}).
                          </p>
                        )}
                      </div>
                      <span className="text-sm font-bold text-slate-700 shrink-0">${money(r.amount)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}

      {/* 3) Receptor + emisión */}
      {selectedKey && rows.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
          <h3 className="text-base font-bold text-slate-800">Datos del receptor</h3>

          {!isCompany && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-iva-guest">
                Condición frente al IVA
              </label>
              <select
                id="cons-iva-guest"
                value={condicionIva}
                onChange={(e) => setCondicionIva(e.target.value as ReceptorCondicionCuit | "")}
                className={`${inputClass} md:w-1/2`}
              >
                <option value="">Consumidor final — Factura B con DNI</option>
                <option value="responsable_inscripto">Responsable Inscripto</option>
                <option value="monotributo">Monotributo</option>
                <option value="exento">IVA Sujeto Exento</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Sale precargada de la ficha del huésped. Si la cambiás acá, queda guardada.
              </p>
            </div>
          )}

          {requiereCuit ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-razon">
                  Razón social
                </label>
                <input
                  id="cons-razon"
                  type="text"
                  value={razonSocial}
                  onChange={(e) => setRazonSocial(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-cuit">
                  CUIT
                </label>
                <input
                  id="cons-cuit"
                  type="text"
                  inputMode="numeric"
                  value={cuit}
                  onChange={(e) => setCuit(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="11 dígitos"
                  className={inputClass}
                />
              </div>
              {/* El huésped ya eligió su condición arriba; acá sólo va para empresas. */}
              {isCompany && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-iva">
                    Condición frente al IVA
                  </label>
                  <select
                    id="cons-iva"
                    value={condicionIva}
                    onChange={(e) => setCondicionIva(e.target.value as ReceptorCondicionCuit | "")}
                    className={inputClass}
                  >
                    <option value="">Elegí…</option>
                    <option value="responsable_inscripto">Responsable Inscripto</option>
                    <option value="monotributo">Monotributo</option>
                    <option value="exento">IVA Sujeto Exento</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="cons-domicilio">
                  Domicilio
                </label>
                <input
                  id="cons-domicilio"
                  type="text"
                  value={domicilio}
                  onChange={(e) => setDomicilio(e.target.value)}
                  className={inputClass}
                />
              </div>
              <p className="md:col-span-2 text-[11px] text-slate-500">
                Se precargan de la ficha. Lo que completes acá queda guardado en la ficha.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Se emite <strong>Factura B</strong> con el DNI de la ficha del huésped. Si el DNI está
              mal, corregilo en Huéspedes antes de emitir.
            </p>
          )}

          <div className="border-t border-slate-100 pt-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-800">
                {selectedRows.length} estadía{selectedRows.length === 1 ? "" : "s"} · Total $
                {money(total)}
              </p>
              <p className="text-xs text-slate-400">
                Se emitirá una <strong>Factura {letra}</strong> con fecha de hoy, por el período{" "}
                {selectedRows.length > 0
                  ? `${shortDate(selectedRows[0].fch_desde)} → ${shortDate(
                      selectedRows[selectedRows.length - 1].fch_hasta
                    )}`
                  : "—"}
                .
              </p>
            </div>
            <button
              type="button"
              onClick={() => void emit()}
              disabled={emitting || selectedRows.length === 0}
              className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-colors flex items-center gap-2"
            >
              {emitting ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
              Emitir factura consolidada
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
