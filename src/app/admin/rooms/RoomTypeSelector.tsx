"use client";

import { useMemo, useState } from "react";
import { Plus, Check, X } from "lucide-react";
import { sortRoomTypes } from "@/lib/rooms";

interface RoomTypeSelectorProps {
  value: string;
  roomTypes: string[];
  onChange: (value: string) => void;
  onAddCategory: (value: string) => void;
  label?: string;
}

export default function RoomTypeSelector({
  value,
  roomTypes,
  onChange,
  onAddCategory,
  label = "Categoria",
}: RoomTypeSelectorProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => sortRoomTypes(roomTypes), [roomTypes]);

  const resetCreateState = () => {
    setIsAdding(false);
    setNewCategory("");
    setError(null);
  };

  const handleAddCategory = () => {
    const normalizedValue = newCategory.trim();

    if (!normalizedValue) {
      setError("Ingresa un nombre de categoria.");
      return;
    }

    const alreadyExists = options.some(
      (roomType) => roomType.toLowerCase() === normalizedValue.toLowerCase()
    );

    if (alreadyExists) {
      setError("Esa categoria ya existe.");
      return;
    }

    onAddCategory(normalizedValue);
    onChange(normalizedValue);
    resetCreateState();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label className="block text-sm font-bold text-slate-700">{label}</label>
        <button
          type="button"
          onClick={() => {
            if (isAdding) {
              resetCreateState();
              return;
            }

            setIsAdding(true);
            setError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700 transition-colors"
        >
          {isAdding ? <X size={14} /> : <Plus size={14} />}
          {isAdding ? "Cancelar" : "Nueva categoria"}
        </button>
      </div>

      {isAdding && (
        <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => {
                setNewCategory(e.target.value);
                if (error) setError(null);
              }}
              className="w-full rounded-xl border border-brand-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition-all focus:border-brand-500 focus:ring focus:ring-brand-200"
              placeholder="Ej. Suite Premium"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 transition-colors"
            >
              <Check size={16} />
              Agregar
            </button>
          </div>
          {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
        </div>
      )}

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none transition-all focus:border-brand-500 focus:ring focus:ring-brand-200"
        required
      >
        <option value="" disabled>
          Selecciona una categoria
        </option>
        {options.map((roomType) => (
          <option key={roomType} value={roomType}>
            {roomType}
          </option>
        ))}
      </select>
    </div>
  );
}
