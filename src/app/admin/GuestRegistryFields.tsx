"use client";

import { useState } from "react";
import { ChevronDown, ClipboardList } from "lucide-react";

import type { GuestRegistryInput } from "@/lib/types";

type Props = {
  value: GuestRegistryInput;
  onChange: (patch: Partial<GuestRegistryInput>) => void;
  idPrefix: string;
};

const inputClass =
  "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all text-sm";

export default function GuestRegistryFields({ value, onChange, idPrefix }: Props) {
  const [open, setOpen] = useState(false);
  const filled = [
    value.guestProfession,
    value.guestAddress,
    value.guestLocality,
    value.guestNationality,
    value.guestDocType,
    value.guestBirthDate,
    value.guestVehicle,
  ].filter((v) => v && v.trim() !== "").length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 rounded-xl transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ClipboardList size={16} className="text-slate-400" />
          Datos de registro (opcional)
          {filled > 0 && (
            <span className="text-xs font-bold text-emerald-600">
              · {filled} cargado{filled > 1 ? "s" : ""}
            </span>
          )}
        </span>
        <ChevronDown
          size={18}
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-slate-100 pt-3">
          <div>
            <label htmlFor={`${idPrefix}-prof`} className="block text-xs font-semibold text-slate-600 mb-1">
              Profesión
            </label>
            <input
              id={`${idPrefix}-prof`}
              type="text"
              value={value.guestProfession ?? ""}
              onChange={(e) => onChange({ guestProfession: e.target.value })}
              className={inputClass}
              placeholder="Ej. Viajante"
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-loc`} className="block text-xs font-semibold text-slate-600 mb-1">
              Localidad
            </label>
            <input
              id={`${idPrefix}-loc`}
              type="text"
              value={value.guestLocality ?? ""}
              onChange={(e) => onChange({ guestLocality: e.target.value })}
              className={inputClass}
              placeholder="Ej. Salta"
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-addr`} className="block text-xs font-semibold text-slate-600 mb-1">
              Dirección
            </label>
            <input
              id={`${idPrefix}-addr`}
              type="text"
              value={value.guestAddress ?? ""}
              onChange={(e) => onChange({ guestAddress: e.target.value })}
              className={inputClass}
              placeholder="Ej. Catamarca 658"
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-nat`} className="block text-xs font-semibold text-slate-600 mb-1">
              Nacionalidad
            </label>
            <input
              id={`${idPrefix}-nat`}
              type="text"
              value={value.guestNationality ?? ""}
              onChange={(e) => onChange({ guestNationality: e.target.value })}
              className={inputClass}
              placeholder="Ej. Argentina"
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-doc`} className="block text-xs font-semibold text-slate-600 mb-1">
              Tipo de documento
            </label>
            <select
              id={`${idPrefix}-doc`}
              value={value.guestDocType ?? ""}
              onChange={(e) => onChange({ guestDocType: e.target.value || undefined })}
              className={inputClass}
            >
              <option value="">Sin especificar</option>
              <option value="DNI">DNI</option>
              <option value="CUIT">CUIT</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-birth`} className="block text-xs font-semibold text-slate-600 mb-1">
              Fecha de nacimiento
            </label>
            <input
              id={`${idPrefix}-birth`}
              type="date"
              value={value.guestBirthDate ?? ""}
              onChange={(e) => onChange({ guestBirthDate: e.target.value || undefined })}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-veh`} className="block text-xs font-semibold text-slate-600 mb-1">
              Movilidad (patente)
            </label>
            <input
              id={`${idPrefix}-veh`}
              type="text"
              value={value.guestVehicle ?? ""}
              onChange={(e) => onChange({ guestVehicle: e.target.value })}
              className={inputClass}
              placeholder="Opcional"
            />
          </div>
        </div>
      )}
    </div>
  );
}
