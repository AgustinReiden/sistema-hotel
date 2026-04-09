"use client";

import { useEffect, useState } from "react";
import { CreditCard, Percent, Phone, StickyNote, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import type { AssociatedClient } from "@/lib/types";

type AssociatedClientModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    displayName: string;
    documentId: string;
    phone?: string;
    discountPercent: number;
    notes?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  initialClient?: AssociatedClient | null;
  title: string;
};

type FormState = {
  displayName: string;
  documentId: string;
  phone: string;
  discountPercent: string;
  notes: string;
};

function buildInitialState(initialClient?: AssociatedClient | null): FormState {
  return {
    displayName: initialClient?.display_name ?? "",
    documentId: initialClient?.document_id ?? "",
    phone: initialClient?.phone ?? "",
    discountPercent:
      initialClient?.discount_percent !== undefined
        ? initialClient.discount_percent.toString()
        : "0",
    notes: initialClient?.notes ?? "",
  };
}

export default function AssociatedClientModal({
  isOpen,
  onClose,
  onSubmit,
  initialClient,
  title,
}: AssociatedClientModalProps) {
  const [form, setForm] = useState<FormState>(() => buildInitialState(initialClient));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(buildInitialState(initialClient));
  }, [isOpen, initialClient]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const result = await onSubmit({
        displayName: form.displayName.trim(),
        documentId: form.documentId.trim(),
        phone: form.phone.trim() || undefined,
        discountPercent: Number(form.discountPercent),
        notes: form.notes.trim() || undefined,
      });

      if (result.success) {
        toast.success(
          initialClient ? "Asociado actualizado correctamente." : "Asociado creado correctamente."
        );
        onClose();
      } else {
        toast.error(result.error || "No se pudo guardar el asociado.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-left max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="associated-display-name">
                <span className="flex items-center gap-1.5">
                  <UserRound size={14} />
                  Nombre del Asociado
                </span>
              </label>
              <input
                id="associated-display-name"
                type="text"
                required
                value={form.displayName}
                onChange={(e) => setForm((current) => ({ ...current, displayName: e.target.value }))}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Ej. Transportes del Norte"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="associated-document-id">
                <span className="flex items-center gap-1.5">
                  <CreditCard size={14} />
                  DNI o CUIT
                </span>
              </label>
              <input
                id="associated-document-id"
                type="text"
                required
                value={form.documentId}
                onChange={(e) => setForm((current) => ({ ...current, documentId: e.target.value }))}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Ej. 30-12345678-9"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="associated-phone">
                <span className="flex items-center gap-1.5">
                  <Phone size={14} />
                  Teléfono
                </span>
              </label>
              <input
                id="associated-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Opcional"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="associated-discount">
                <span className="flex items-center gap-1.5">
                  <Percent size={14} />
                  Descuento (%)
                </span>
              </label>
              <input
                id="associated-discount"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                value={form.discountPercent}
                onChange={(e) => setForm((current) => ({ ...current, discountPercent: e.target.value }))}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                placeholder="Ej. 10"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1.5" htmlFor="associated-notes">
                <span className="flex items-center gap-1.5">
                  <StickyNote size={14} />
                  Notas
                </span>
              </label>
              <textarea
                id="associated-notes"
                rows={4}
                value={form.notes}
                onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all resize-none"
                placeholder="Opcional. Ej. Convenio corporativo para estancias frecuentes."
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            El descuento se congelará en cada reserva o check-in al momento de seleccionar este asociado.
          </div>

          <div className="pt-4 border-t border-slate-100 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !form.displayName.trim() || !form.documentId.trim()}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors shadow-md shadow-emerald-600/20"
            >
              {isSubmitting ? "Guardando..." : initialClient ? "Guardar Cambios" : "Crear Asociado"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
