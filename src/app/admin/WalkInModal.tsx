"use client";

import { useEffect, useState } from "react";
import { CreditCard, Percent, Phone, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import AssociatedClientSelector from "./AssociatedClientSelector";
import { calculateWalkInPriceBreakdown } from "@/lib/pricing";
import type { AssignWalkInPayload, AssociatedClient } from "@/lib/types";

type WalkInModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AssignWalkInPayload) => Promise<{ success: boolean; error?: string }>;
  roomNumber: string;
  basePrice?: number;
  associatedClients: AssociatedClient[];
};

type CustomerMode = "manual" | "associated";

export default function WalkInModal({
  isOpen,
  onClose,
  onSubmit,
  roomNumber,
  basePrice = 0,
  associatedClients,
}: WalkInModalProps) {
  const [customerMode, setCustomerMode] = useState<CustomerMode>("manual");
  const [clientName, setClientName] = useState("");
  const [associatedClientId, setAssociatedClientId] = useState("");
  const [nights, setNights] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCustomerMode("manual");
    setClientName("");
    setAssociatedClientId("");
    setNights(1);
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedAssociatedClient =
    associatedClients.find((client) => client.id === associatedClientId) ?? null;
  const pricing =
    customerMode === "associated" && selectedAssociatedClient && basePrice > 0
      ? calculateWalkInPriceBreakdown({
          basePrice,
          nights,
          discountPercent: selectedAssociatedClient.discount_percent,
        })
      : customerMode === "manual" && basePrice > 0
        ? calculateWalkInPriceBreakdown({ basePrice, nights })
        : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nights < 1) return;
    if (customerMode === "manual" && !clientName.trim()) return;
    if (customerMode === "associated" && !associatedClientId) {
      toast.error("Selecciona un asociado para continuar.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: AssignWalkInPayload =
        customerMode === "manual"
          ? {
              customerMode: "manual",
              roomId: 0,
              clientName: clientName.trim(),
              nights,
            }
          : {
              customerMode: "associated",
              roomId: 0,
              associatedClientId,
              nights,
            };

      const result = await onSubmit(payload);
      if (result.success) {
        toast.success("Habitación asignada correctamente.");
        onClose();
      } else {
        toast.error(result.error || "Ocurrió un error.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-left max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800">Asignar Habitación {roomNumber}</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">Tipo de cliente</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCustomerMode("manual")}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  customerMode === "manual"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="font-semibold text-slate-800">Cliente ocasional</p>
                <p className="text-sm text-slate-500">Check-in rápido manual como hasta ahora.</p>
              </button>
              <button
                type="button"
                onClick={() => setCustomerMode("associated")}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  customerMode === "associated"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="font-semibold text-slate-800">Asociado</p>
                <p className="text-sm text-slate-500">Usa el padrón y aplica el descuento al total.</p>
              </button>
            </div>
          </div>

          {customerMode === "manual" ? (
            <div>
              <label htmlFor="clientName" className="block text-sm font-semibold text-slate-700 mb-1.5">
                Nombre del Huésped
              </label>
              <input
                id="clientName"
                type="text"
                required
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Ej. Juan Pérez"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <AssociatedClientSelector
                clients={associatedClients}
                selectedId={associatedClientId}
                onSelect={setAssociatedClientId}
                inputId="walkinAssociatedClient"
                label="Asociado"
              />

              {selectedAssociatedClient ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                      Nombre
                    </p>
                    <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <UserRound size={14} className="text-slate-400" />
                      {selectedAssociatedClient.display_name}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                      DNI/CUIT
                    </p>
                    <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <CreditCard size={14} className="text-slate-400" />
                      {selectedAssociatedClient.document_id}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                      Teléfono
                    </p>
                    <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Phone size={14} className="text-slate-400" />
                      {selectedAssociatedClient.phone || "Sin dato"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Selecciona un asociado activo para usar sus datos y descuento en este check-in.
                </div>
              )}
            </div>
          )}

          <div>
            <label htmlFor="nights" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Cantidad de Noches
            </label>
            <input
              id="nights"
              type="number"
              min="1"
              required
              value={nights}
              onChange={(e) => setNights(parseInt(e.target.value, 10) || 1)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
            />
          </div>

          {pricing && (
            <div
              className={`rounded-xl border p-4 ${
                customerMode === "associated"
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-slate-50 border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">
                    Total estimado
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {pricing.nights} noche{pricing.nights !== 1 ? "s" : ""}
                    {" × "}
                    ${basePrice.toLocaleString("es-AR")}
                  </p>
                </div>
                <div className="text-right">
                  {customerMode === "associated" && selectedAssociatedClient && (
                    <p className="text-xs font-semibold text-emerald-700 mb-1">
                      Descuento {selectedAssociatedClient.discount_percent.toLocaleString("es-AR", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}
                      %: -$
                      {pricing.discountAmount.toLocaleString("es-AR", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  )}
                  <p className="text-2xl font-bold text-emerald-700">
                    ${pricing.finalTotalPrice.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {customerMode === "associated" && (
                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-700">
                  <Percent size={12} />
                  Se guardará el descuento y los datos actuales del asociado en esta reserva.
                </div>
              )}
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={
                isSubmitting ||
                (customerMode === "manual" ? !clientName.trim() : !associatedClientId)
              }
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors shadow-md shadow-emerald-600/20"
            >
              {isSubmitting ? "Asignando..." : "Asignar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
