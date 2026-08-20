"use client";

import { useState } from "react";
import { Building2, CreditCard, LogIn, Phone, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import CompanyPassengerSelector from "./CompanyPassengerSelector";
import GuestRegistryFields from "./GuestRegistryFields";
import type { CheckInPassengerInput, CompanyPassenger, GuestRegistryInput } from "@/lib/types";

type CompanyCheckInModalProps = {
  onClose: () => void;
  onConfirm: (passenger: CheckInPassengerInput) => void;
  /** Empresa/convenio de la reserva: acota la busqueda de pasajeros a su lista. */
  companyId: string;
  companyName: string;
  roomNumber: string;
  /** Si la reserva ya traia un pasajero cargado, se precarga para confirmarlo o corregirlo. */
  initialPassenger?: { name: string; dni: string } | null;
  isSubmitting?: boolean;
};

const inputClass =
  "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all";

/**
 * Check-in de una reserva de empresa: pide quien se hospeda de verdad. La reserva se
 * cargo a nombre de la empresa porque al reservar todavia no sabia a quien mandaba
 * (los preventistas rotan), asi que el humano se identifica recien aca (mig 88).
 *
 * Se monta al abrirlo (el padre lo renderiza condicionalmente): el estado arranca del
 * pasajero precargado y no hay efecto que pise lo que la recepcion va tipeando.
 */
export default function CompanyCheckInModal({
  onClose,
  onConfirm,
  companyId,
  companyName,
  roomNumber,
  initialPassenger = null,
  isSubmitting = false,
}: CompanyCheckInModalProps) {
  const [companyPassengerId, setCompanyPassengerId] = useState<string | null>(null);
  const [passengerName, setPassengerName] = useState(initialPassenger?.name ?? "");
  const [passengerDni, setPassengerDni] = useState(initialPassenger?.dni ?? "");
  const [passengerPhone, setPassengerPhone] = useState("");
  const [registry, setRegistry] = useState<GuestRegistryInput>({});

  const handleSelect = (p: CompanyPassenger) => {
    setCompanyPassengerId(p.id);
    setPassengerName(p.full_name);
    setPassengerDni(p.document_id ?? "");
    setPassengerPhone(p.phone ?? "");
  };

  const complete = Boolean(passengerName.trim()) && Boolean(passengerDni.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete) {
      toast.error("Cargá el nombre y el DNI del pasajero que entra.");
      return;
    }
    onConfirm({
      companyPassengerId: companyPassengerId ?? undefined,
      passengerName: passengerName.trim(),
      passengerDni: passengerDni.trim(),
      passengerPhone: passengerPhone.trim() || undefined,
      ...registry,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-left max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Check-in · Hab. {roomNumber}</h2>
            <p className="text-sm text-slate-500">¿Quién se hospeda?</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 flex items-center gap-2 text-sm">
            <Building2 size={16} className="text-sky-600 shrink-0" />
            <span className="font-semibold text-slate-800 truncate">{companyName}</span>
            <span className="ml-auto shrink-0 text-xs font-semibold text-slate-500">
              Reserva de la empresa
            </span>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
              Pasajero que entra <span className="text-red-500">*</span>
            </p>

            <CompanyPassengerSelector
              key={companyId}
              companyId={companyId}
              onSelect={handleSelect}
              inputId="checkInPassengerSearch"
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="checkInPassengerName" className="block text-xs font-semibold text-slate-600 mb-1">
                  <span className="flex items-center gap-1.5">
                    <UserRound size={13} />
                    Nombre y apellido <span className="text-red-500">*</span>
                  </span>
                </label>
                <input
                  id="checkInPassengerName"
                  type="text"
                  value={passengerName}
                  onChange={(e) => {
                    setPassengerName(e.target.value);
                    setCompanyPassengerId(null);
                  }}
                  className={inputClass}
                  placeholder="Ej. Juan Pérez"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="checkInPassengerDni" className="block text-xs font-semibold text-slate-600 mb-1">
                  <span className="flex items-center gap-1.5">
                    <CreditCard size={13} />
                    DNI o CUIT <span className="text-red-500">*</span>
                  </span>
                </label>
                <input
                  id="checkInPassengerDni"
                  type="text"
                  value={passengerDni}
                  onChange={(e) => {
                    setPassengerDni(e.target.value);
                    setCompanyPassengerId(null);
                  }}
                  className={inputClass}
                  placeholder="Ej. 30123456"
                  autoComplete="off"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="checkInPassengerPhone" className="block text-xs font-semibold text-slate-600 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Phone size={13} />
                    Teléfono
                  </span>
                </label>
                <input
                  id="checkInPassengerPhone"
                  type="tel"
                  value={passengerPhone}
                  onChange={(e) => setPassengerPhone(e.target.value)}
                  className={inputClass}
                  placeholder="Opcional"
                  autoComplete="off"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              {companyPassengerId
                ? "Pasajero de la empresa seleccionado."
                : "Si no figura en la empresa, se agrega solo a su lista al confirmar."}
            </p>
          </div>

          <GuestRegistryFields
            value={registry}
            onChange={(patch) => setRegistry((current) => ({ ...current, ...patch }))}
            idPrefix="checkin"
          />

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
              disabled={isSubmitting || !complete}
              className="flex-1 px-4 py-2.5 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:hover:bg-green-600 transition-colors shadow-md shadow-green-600/20 flex items-center justify-center gap-2"
            >
              <LogIn size={16} />
              {isSubmitting ? "Registrando…" : "Hacer Check-In"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
