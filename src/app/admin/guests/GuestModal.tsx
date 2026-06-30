"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Percent, UserRound, Wallet, X } from "lucide-react";
import { toast } from "sonner";

import { loadGuestRecordAction, updateGuestAction, type GuestRecordPayload } from "./actions";

type GuestModalProps = {
  guestId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

const inputClass =
  "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm";

const emptyForm: GuestRecordPayload = {
  fullName: "",
  documentType: "",
  documentId: "",
  phone: "",
  address: "",
  locality: "",
  nationality: "",
  profession: "",
  discountPercent: 0,
  cuentaCorrienteHabilitada: false,
};

export default function GuestModal({ guestId, onClose, onSaved }: GuestModalProps) {
  const [form, setForm] = useState<GuestRecordPayload>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!guestId) return;
    let active = true;
    setLoading(true);
    (async () => {
      const result = await loadGuestRecordAction(guestId);
      if (!active) return;
      if (result.success && result.data) {
        const g = result.data;
        setForm({
          fullName: g.full_name ?? "",
          documentType: g.document_type ?? "",
          documentId: g.document_id ?? "",
          phone: g.phone ?? "",
          address: g.address ?? "",
          locality: g.locality ?? "",
          nationality: g.nationality ?? "",
          profession: g.profession ?? "",
          discountPercent: g.discount_percent ?? 0,
          cuentaCorrienteHabilitada: g.cuenta_corriente_habilitada ?? false,
        });
      } else {
        toast.error(result.success ? "No se encontró el huésped." : result.error);
        onClose();
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [guestId, onClose]);

  if (!guestId) return null;

  const set = (patch: Partial<GuestRecordPayload>) => setForm((current) => ({ ...current, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim()) {
      toast.error("El nombre es obligatorio.");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await updateGuestAction(guestId, form);
      if (result.success) {
        toast.success("Huésped actualizado.");
        onSaved();
        onClose();
      } else {
        toast.error(result.error || "No se pudo actualizar.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-left max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800">
            <UserRound size={20} className="text-emerald-600" />
            Editar huésped
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center text-slate-500">
            <Loader2 size={20} className="animate-spin mr-2" /> Cargando…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nombre completo</label>
              <input
                type="text"
                required
                value={form.fullName}
                onChange={(e) => set({ fullName: e.target.value })}
                className={inputClass}
                placeholder="Ej. María López"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <CreditCard size={14} />
                    DNI o CUIT
                  </span>
                </label>
                <input
                  type="text"
                  value={form.documentId ?? ""}
                  onChange={(e) => set({ documentId: e.target.value })}
                  className={inputClass}
                  placeholder="Ej. 20-12345678-3"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Tipo de documento</label>
                <select
                  value={form.documentType ?? ""}
                  onChange={(e) => set({ documentType: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Sin especificar</option>
                  <option value="DNI">DNI</option>
                  <option value="CUIT">CUIT</option>
                  <option value="Pasaporte">Pasaporte</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Teléfono</label>
                <input
                  type="tel"
                  value={form.phone ?? ""}
                  onChange={(e) => set({ phone: e.target.value })}
                  className={inputClass}
                  placeholder="Opcional"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Percent size={14} />
                    Descuento (%)
                  </span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={form.discountPercent}
                  onChange={(e) => set({ discountPercent: Number(e.target.value) })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  <span className="flex items-center gap-1.5">
                    <Wallet size={14} />
                    Cuenta corriente
                  </span>
                </label>
                <select
                  value={form.cuentaCorrienteHabilitada ? "si" : "no"}
                  onChange={(e) => set({ cuentaCorrienteHabilitada: e.target.value === "si" })}
                  className={inputClass}
                >
                  <option value="no">No</option>
                  <option value="si">Sí — habilitado a fiar</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Localidad</label>
                <input
                  type="text"
                  value={form.locality ?? ""}
                  onChange={(e) => set({ locality: e.target.value })}
                  className={inputClass}
                  placeholder="Ej. Salta"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nacionalidad</label>
                <input
                  type="text"
                  value={form.nationality ?? ""}
                  onChange={(e) => set({ nationality: e.target.value })}
                  className={inputClass}
                  placeholder="Ej. Argentina"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Profesión</label>
                <input
                  type="text"
                  value={form.profession ?? ""}
                  onChange={(e) => set({ profession: e.target.value })}
                  className={inputClass}
                  placeholder="Opcional"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Dirección</label>
                <input
                  type="text"
                  value={form.address ?? ""}
                  onChange={(e) => set({ address: e.target.value })}
                  className={inputClass}
                  placeholder="Opcional"
                />
              </div>
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
                disabled={isSubmitting || !form.fullName.trim()}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-md shadow-emerald-600/20"
              >
                {isSubmitting ? "Guardando..." : "Guardar Cambios"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
