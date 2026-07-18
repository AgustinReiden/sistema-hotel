"use client";

import { useState } from "react";
import { ArrowLeft, Building2, FileText, Loader2, User, X } from "lucide-react";
import { toast } from "sonner";

import { emitInvoiceForReservationAction } from "./fiscal/actions";
import { isValidCuit } from "@/lib/arca/amounts";
import type { EmitInvoiceOutcome, InvoiceReceptorInput } from "@/lib/types";

export type InvoicePromptData = {
  reservationId: string;
  clientName: string | null;
  total: number;
  /** Prefill para Factura A (empresa asociada o CUIT ya cargado en la reserva). */
  aPrefill: {
    razonSocial: string;
    cuit: string;
    condicionIva: "responsable_inscripto" | "monotributo" | "";
    domicilio: string;
  };
  /** true si es empresa con CUIT válido → sugerir A por defecto. */
  suggestA: boolean;
};

type Props = {
  data: InvoicePromptData | null;
  onClose: () => void;
  /** Empezar en la elección A/B (para /admin/fiscal, donde ya apretaron "Emitir"). */
  startAtTipo?: boolean;
};

type Step = "ask" | "tipo" | "formA";

function formatMoney(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function openInvoicePrint(invoiceId: string) {
  if (typeof window === "undefined") return;
  window.open(
    `/admin/factura/${invoiceId}?autoprint=1`,
    `factura-${invoiceId}`,
    "width=420,height=720"
  );
}

/**
 * Prompt post check-out "¿Emitir factura?". El playero aprieta SÍ → elige el tipo:
 * B (consumidor final, usa el DNI de la reserva) o A (empresa / Responsable
 * Inscripto: se cargan/confirman CUIT + condición IVA + razón social, precargados
 * si la reserva es de una empresa de la ficha). Si ARCA no responde, la factura
 * queda pendiente en /admin/fiscal — el check-out ya está hecho y no se traba.
 */
/**
 * El estado se inicializa desde `data` en el montaje; el padre pasa `key` (el
 * reservationId) para que se remonte fresco cada vez que abre un prompt nuevo.
 */
export default function InvoicePromptModal({ data, onClose, startAtTipo = false }: Props) {
  const [step, setStep] = useState<Step>(startAtTipo ? "tipo" : "ask");
  const [emitting, setEmitting] = useState(false);
  const [form, setForm] = useState(() => ({
    razonSocial: data?.aPrefill.razonSocial ?? "",
    cuit: data?.aPrefill.cuit ?? "",
    condicionIva: (data?.aPrefill.condicionIva ?? "") as "responsable_inscripto" | "monotributo" | "",
    domicilio: data?.aPrefill.domicilio ?? "",
  }));

  if (!data) return null;

  const handleOutcome = (outcome: EmitInvoiceOutcome) => {
    if (outcome.status === "authorized") {
      // Cubre tanto la emisión nueva como el caso "ya estaba facturada" (reimprime).
      toast.success(outcome.userMessage);
      if (outcome.invoiceId) openInvoicePrint(outcome.invoiceId);
    } else if (outcome.status === "rejected") {
      toast.error(outcome.userMessage, {
        description: "Revisá los datos en Facturación → Pendientes y con error.",
        duration: 9000,
      });
    } else {
      toast.warning(outcome.userMessage, { duration: 9000 });
    }
    onClose();
  };

  const emit = async (receptor: InvoiceReceptorInput) => {
    if (emitting) return; // anti doble click
    setEmitting(true);
    const result = await emitInvoiceForReservationAction(data.reservationId, receptor);
    setEmitting(false);

    if (!result.success) {
      toast.error(result.error);
      onClose();
      return;
    }
    handleOutcome(result.data!);
  };

  const submitFormA = () => {
    const cuitDigits = form.cuit.replace(/\D/g, "");
    if (!form.razonSocial.trim()) {
      toast.error("Ingresá la razón social del receptor.");
      return;
    }
    if (!isValidCuit(cuitDigits)) {
      toast.error("El CUIT no es válido (11 dígitos con dígito verificador).");
      return;
    }
    if (form.condicionIva !== "responsable_inscripto" && form.condicionIva !== "monotributo") {
      toast.error("Elegí la condición frente al IVA.");
      return;
    }
    if (!form.domicilio.trim()) {
      toast.error("Ingresá el domicilio del receptor.");
      return;
    }
    emit({
      tipo: "A",
      cuit: cuitDigits,
      condicionIva: form.condicionIva,
      razonSocial: form.razonSocial.trim(),
      domicilio: form.domicilio.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm text-left">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                {step === "formA" ? "Datos para Factura A" : "¿Emitir factura?"}
              </h2>
              <p className="text-slate-500 text-sm font-medium">
                {data.clientName ?? "Huésped"} — ${formatMoney(data.total)}
              </p>
            </div>
          </div>
          {!emitting && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={24} />
            </button>
          )}
        </div>

        <div className="p-6">
          {emitting ? (
            <div className="flex flex-col items-center justify-center gap-3 py-6 text-slate-600">
              <Loader2 className="animate-spin" size={28} />
              <p className="text-sm font-semibold">Emitiendo factura en ARCA…</p>
              <p className="text-xs text-slate-400">No cierres esta ventana.</p>
            </div>
          ) : step === "ask" ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setStep("tipo")}
                  className="py-6 bg-emerald-600 hover:bg-emerald-700 text-white text-2xl font-black rounded-2xl transition-colors"
                >
                  SÍ
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="py-6 border-2 border-slate-200 text-slate-600 hover:bg-slate-50 text-2xl font-black rounded-2xl transition-colors"
                >
                  NO
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-4 text-center">
                Si elegís NO, podés emitirla igual desde Facturación mientras dure tu turno.
              </p>
            </>
          ) : step === "tipo" ? (
            <>
              <p className="text-sm font-semibold text-slate-600 mb-4 text-center">
                ¿Qué comprobante?
              </p>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => emit({ tipo: "B" })}
                  className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-colors ${
                    data.suggestA
                      ? "border-slate-200 hover:bg-slate-50"
                      : "border-emerald-500 bg-emerald-50 hover:bg-emerald-100"
                  }`}
                >
                  <User size={22} className="text-slate-500 shrink-0" />
                  <div>
                    <p className="font-bold text-slate-800">Factura B</p>
                    <p className="text-xs text-slate-500">Consumidor final (usa el DNI de la reserva).</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("formA")}
                  className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-colors ${
                    data.suggestA
                      ? "border-emerald-500 bg-emerald-50 hover:bg-emerald-100"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <Building2 size={22} className="text-slate-500 shrink-0" />
                  <div>
                    <p className="font-bold text-slate-800">Factura A</p>
                    <p className="text-xs text-slate-500">
                      Empresa o Responsable Inscripto (con CUIT).
                    </p>
                  </div>
                </button>
              </div>
              <button
                type="button"
                onClick={() => (startAtTipo ? onClose() : setStep("ask"))}
                className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600"
              >
                <ArrowLeft size={14} /> {startAtTipo ? "Cancelar" : "Volver"}
              </button>
            </>
          ) : (
            // step === "formA"
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="fa-razon">
                  Razón social
                </label>
                <input
                  id="fa-razon"
                  type="text"
                  value={form.razonSocial}
                  onChange={(e) => setForm((f) => ({ ...f, razonSocial: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="Ej. Transportes del Norte S.A."
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="fa-cuit">
                  CUIT
                </label>
                <input
                  id="fa-cuit"
                  type="text"
                  inputMode="numeric"
                  value={form.cuit}
                  onChange={(e) => setForm((f) => ({ ...f, cuit: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="30-12345678-9"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="fa-cond">
                  Condición frente al IVA
                </label>
                <select
                  id="fa-cond"
                  value={form.condicionIva}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      condicionIva: e.target.value as typeof f.condicionIva,
                    }))
                  }
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                >
                  <option value="">Elegí…</option>
                  <option value="responsable_inscripto">Responsable Inscripto</option>
                  <option value="monotributo">Monotributo</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="fa-domicilio">
                  Domicilio
                </label>
                <input
                  id="fa-domicilio"
                  type="text"
                  value={form.domicilio}
                  onChange={(e) => setForm((f) => ({ ...f, domicilio: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                  placeholder="Av. San Martín 1234, Taco Pozo"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep("tipo")}
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeft size={16} /> Volver
                </button>
                <button
                  type="button"
                  onClick={submitFormA}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors shadow-md shadow-emerald-600/20"
                >
                  Emitir Factura A
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
