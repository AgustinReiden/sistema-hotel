"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Percent, X } from "lucide-react";
import { toast } from "sonner";

import { updateGuestDiscountAction } from "../actions";
import type { GuestDirectoryEntry } from "@/lib/types";

/**
 * Descuento personal del huesped, editable inline desde el directorio. Se aplica solo cuando
 * el huesped se elige del padron al crear una reserva.
 */
export default function GuestDiscountCell({ entry }: { entry: GuestDirectoryEntry }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(entry.discount_percent ?? 0));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const percent = Number(value.replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error("El descuento debe estar entre 0 y 100.");
      return;
    }
    setSaving(true);
    try {
      const result = await updateGuestDiscountAction({
        id: entry.id,
        fullName: entry.client_name,
        documentId: entry.client_dni,
        discountPercent: percent,
      });
      if (result.success) {
        toast.success("Descuento guardado.");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error || "No se pudo guardar el descuento.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <input
            type="number"
            min={0}
            max={100}
            step="0.5"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-20 pl-2 pr-6 py-1 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
          />
          <Percent size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="p-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          title="Guardar"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(String(entry.discount_percent ?? 0));
            setEditing(false);
          }}
          className="p-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
          title="Cancelar"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1.5"
      title="Editar descuento"
    >
      {entry.discount_percent > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
          <Percent size={11} />
          {entry.discount_percent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
        </span>
      ) : (
        <span className="text-slate-300 text-sm">—</span>
      )}
      <Pencil size={12} className="text-slate-300 group-hover:text-slate-500" />
    </button>
  );
}
