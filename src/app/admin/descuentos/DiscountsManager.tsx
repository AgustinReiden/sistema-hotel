"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Pencil, Percent, Plus, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import GuestSelector from "../GuestSelector";
import AssociatedClientSelector from "../AssociatedClientSelector";
import { updateCompanyDiscountAction, updateGuestDiscountAction } from "../actions";
import type { AssociatedClient, DiscountedClient, GuestDirectoryEntry } from "@/lib/types";

type Props = {
  initialDiscounted: DiscountedClient[];
  companies: AssociatedClient[];
};

type AddTab = "person" | "company";

const pctInput =
  "w-24 pl-2 pr-6 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none";

async function persist(entry: { kind: "guest" | "company"; id: string; name: string; documentId: string | null; percent: number }) {
  if (entry.kind === "guest") {
    return updateGuestDiscountAction({
      id: entry.id,
      fullName: entry.name,
      documentId: entry.documentId,
      discountPercent: entry.percent,
    });
  }
  return updateCompanyDiscountAction({ id: entry.id, discountPercent: entry.percent });
}

function DiscountRow({ row }: { row: DiscountedClient }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.discount_percent));
  const [saving, setSaving] = useState(false);

  const save = async (percent: number) => {
    setSaving(true);
    try {
      const result = await persist({
        kind: row.kind,
        id: row.id,
        name: row.name,
        documentId: row.document_id,
        percent,
      });
      if (result.success) {
        toast.success(percent === 0 ? "Descuento quitado." : "Descuento guardado.");
        setEditing(false);
        router.refresh();
      } else {
        toast.error(result.error || "No se pudo guardar.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    const percent = Number(value.replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error("El descuento debe estar entre 0 y 100.");
      return;
    }
    save(percent);
  };

  return (
    <tr className="hover:bg-slate-50/50 transition-colors">
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          {row.kind === "company" ? (
            <Building2 size={16} className="text-slate-400 shrink-0" />
          ) : (
            <UserRound size={16} className="text-slate-400 shrink-0" />
          )}
          <span className="font-medium text-slate-900">{row.name}</span>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
          {row.kind === "company" ? "Empresa" : "Huésped"}
        </span>
      </td>
      <td className="px-6 py-4 text-sm text-slate-600">
        {row.document_id || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-6 py-4">
        {editing ? (
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
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") setEditing(false);
                }}
                className={pctInput}
              />
              <Percent size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="p-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              title="Guardar"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                setValue(String(row.discount_percent));
                setEditing(false);
              }}
              className="p-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
              title="Cancelar"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-bold text-emerald-700">
            <Percent size={12} />
            {row.discount_percent.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
          </span>
        )}
      </td>
      <td className="px-6 py-4 text-right">
        {!editing && (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="p-2 text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
              title="Editar descuento"
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              onClick={() => save(0)}
              disabled={saving}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
              title="Quitar descuento"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function DiscountsManager({ initialDiscounted, companies }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<AddTab>("person");
  const [guest, setGuest] = useState<{ id: string | null; name: string; dni: string | null } | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [percent, setPercent] = useState("10");
  const [saving, setSaving] = useState(false);

  const onGuestSelect = (entry: GuestDirectoryEntry) =>
    setGuest({ id: entry.id, name: entry.client_name, dni: entry.client_dni });

  const resetAdd = () => {
    setGuest(null);
    setCompanyId("");
    setPercent("10");
  };

  const handleAdd = async () => {
    const value = Number(percent.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      toast.error("El descuento debe estar entre 0 y 100.");
      return;
    }
    if (tab === "person" && !guest) {
      toast.error("Elegí un huésped del padrón.");
      return;
    }
    if (tab === "company" && !companyId) {
      toast.error("Elegí una empresa/convenio.");
      return;
    }

    setSaving(true);
    try {
      const result =
        tab === "person"
          ? await updateGuestDiscountAction({
              id: guest!.id,
              fullName: guest!.name,
              documentId: guest!.dni,
              discountPercent: value,
            })
          : await updateCompanyDiscountAction({ id: companyId, discountPercent: value });

      if (result.success) {
        toast.success("Descuento asignado.");
        resetAdd();
        router.refresh();
      } else {
        toast.error(result.error || "No se pudo asignar el descuento.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Asignar descuento */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <Plus size={16} className="text-emerald-600" />
          Asignar descuento
        </p>

        <div className="grid grid-cols-2 gap-3 max-w-md">
          <button
            type="button"
            onClick={() => setTab("person")}
            className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === "person" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            <UserRound size={15} className="inline mr-1.5 -mt-0.5" />
            Huésped
          </button>
          <button
            type="button"
            onClick={() => setTab("company")}
            className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === "company" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            <Building2 size={15} className="inline mr-1.5 -mt-0.5" />
            Empresa
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-end">
          <div>
            {tab === "person" ? (
              <>
                <GuestSelector onSelect={onGuestSelect} inputId="discountGuest" />
                {guest && (
                  <p className="mt-1.5 text-xs font-medium text-emerald-700">
                    Seleccionado: {guest.name}
                    {guest.dni ? ` · ${guest.dni}` : ""}
                  </p>
                )}
              </>
            ) : (
              <AssociatedClientSelector
                clients={companies}
                selectedId={companyId}
                onSelect={setCompanyId}
                inputId="discountCompany"
                label="Empresa / Convenio"
              />
            )}
          </div>

          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="discountPercent" className="block text-xs font-semibold text-slate-600 mb-1">
                Descuento
              </label>
              <div className="relative">
                <input
                  id="discountPercent"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  className={pctInput}
                />
                <Percent size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Guardando..." : "Asignar"}
            </button>
          </div>
        </div>
      </div>

      {/* Lista de descuentos vigentes */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
              <th className="px-6 py-4">Cliente</th>
              <th className="px-6 py-4">Tipo</th>
              <th className="px-6 py-4">DNI/CUIT</th>
              <th className="px-6 py-4">Descuento</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {initialDiscounted.map((row) => (
              <DiscountRow key={`${row.kind}-${row.id}`} row={row} />
            ))}
          </tbody>
        </table>
        {initialDiscounted.length === 0 && (
          <div className="p-8 text-center text-slate-500">
            Todavía no hay descuentos asignados. Agregá uno arriba.
          </div>
        )}
      </div>
    </div>
  );
}
