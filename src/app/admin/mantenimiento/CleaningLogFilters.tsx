"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Filter, X } from "lucide-react";

type RoomOption = { id: number; room_number: string };

type Props = {
  from: string;
  to: string;
  /** Todo el historial: sin límites de fecha. */
  isAll: boolean;
  /** Sin rango en la URL: rige el mes en curso. */
  isDefault: boolean;
  category: string;
  room: string;
  rooms: RoomOption[];
};

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Todas las categorías" },
  { value: "checkin_daily", label: "Con check-in (diaria)" },
  { value: "checkout", label: "Por check-out" },
  { value: "empty_maintenance", label: "Mantenimiento (vacía)" },
  { value: "occupied_anomaly", label: "Ocupada sin reserva" },
  { value: "no_key", label: "Sin llave" },
];

export default function CleaningLogFilters({
  from,
  to,
  isAll,
  isDefault,
  category,
  room,
  rooms,
}: Props) {
  const router = useRouter();
  const [desde, setDesde] = useState(from);
  const [hasta, setHasta] = useState(to);
  const [cat, setCat] = useState(category);
  const [hab, setHab] = useState(room);

  // Al filtrar se vuelve a la primera página. Sin rango en la URL rige el mes en curso.
  const go = (rango: Record<string, string>) => {
    const params = new URLSearchParams(rango);
    if (cat) params.set("category", cat);
    if (hab) params.set("room", hab);
    const qs = params.toString();
    router.push(qs ? `/admin/mantenimiento?${qs}` : "/admin/mantenimiento");
  };

  const apply = () => {
    const rango: Record<string, string> = {};
    if (desde) rango.from = desde;
    if (hasta) rango.to = hasta;
    go(rango);
  };

  const mesEnCurso = () => {
    setDesde("");
    setHasta("");
    go({});
  };

  const todoElHistorial = () => {
    setDesde("");
    setHasta("");
    go({ todo: "1" });
  };

  // "Limpiar" vuelve al mes en curso y saca también la categoría y la habitación.
  const clear = () => {
    setDesde("");
    setHasta("");
    setCat("");
    setHab("");
    router.push("/admin/mantenimiento");
  };

  const hasFilter = Boolean(!isDefault || isAll || category || room);
  const quickClass = (active: boolean) =>
    `px-3 py-2 rounded-lg border text-sm font-bold transition-colors ${
      active
        ? "bg-slate-800 border-slate-800 text-white"
        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
    }`;
  const selectClass =
    "px-3 py-2 rounded-lg border border-slate-200 focus:border-emerald-500 outline-none text-sm bg-white";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <button
        type="button"
        onClick={mesEnCurso}
        aria-pressed={isDefault}
        className={quickClass(isDefault)}
      >
        Mes en curso
      </button>
      <button
        type="button"
        onClick={todoElHistorial}
        aria-pressed={isAll}
        className={quickClass(isAll)}
      >
        Todo el historial
      </button>
      <div className="flex flex-col gap-1">
        <label htmlFor="from" className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Desde
        </label>
        <input
          id="from"
          type="date"
          value={desde}
          max={hasta || undefined}
          onChange={(e) => setDesde(e.target.value)}
          className={selectClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="to" className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Hasta
        </label>
        <input
          id="to"
          type="date"
          value={hasta}
          min={desde || undefined}
          onChange={(e) => setHasta(e.target.value)}
          className={selectClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="category" className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Categoría
        </label>
        <select
          id="category"
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className={selectClass}
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="room" className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Habitación
        </label>
        <select
          id="room"
          value={hab}
          onChange={(e) => setHab(e.target.value)}
          className={selectClass}
        >
          <option value="">Todas las habitaciones</option>
          {rooms.map((r) => (
            <option key={r.id} value={String(r.id)}>
              Hab. {r.room_number}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={apply}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm flex items-center gap-2 transition-colors"
      >
        <Filter size={15} />
        Aplicar
      </button>
      {hasFilter && (
        <button
          onClick={clear}
          className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold rounded-lg text-sm flex items-center gap-2 transition-colors"
        >
          <X size={15} />
          Limpiar
        </button>
      )}
    </div>
  );
}
