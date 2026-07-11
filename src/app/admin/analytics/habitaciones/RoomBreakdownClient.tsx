"use client";

// Tablero "Por habitación": destacados + gráfico con selector de métrica + tabla
// ordenable. Recibe las filas ya calculadas (server) y solo ordena/visualiza.

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, ChevronsUpDown, Crown, Percent, Sparkles } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { MetricKey } from "@/lib/metric-glossary";
import type { RoomBreakdownRow, RoomBreakdownTotals } from "@/lib/analytics";
import InfoTooltip from "../InfoTooltip";

const BRAND = "#10b981";
const axisTick = { fontSize: 11, fill: "#94a3b8" };

type Props = {
  rows: RoomBreakdownRow[];
  totals: RoomBreakdownTotals;
  currency: string;
};

type NumericKey =
  | "occupancyRate"
  | "roomNightsSold"
  | "lodgingRevenue"
  | "adr"
  | "revpar"
  | "reservations"
  | "cancellations"
  | "cleanings";
type SortKey = "roomNumber" | NumericKey;

type ChartMetric = "revpar" | "occupancyRate" | "lodgingRevenue" | "roomNightsSold";

type ColDef = {
  key: SortKey;
  label: string;
  metric?: MetricKey;
  align: "left" | "right";
  render: (r: RoomBreakdownRow) => React.ReactNode;
};

const CHART_OPTIONS: { key: ChartMetric; label: string; kind: "money" | "percent" | "int" }[] = [
  { key: "revpar", label: "RevPAR", kind: "money" },
  { key: "occupancyRate", label: "Ocupación", kind: "percent" },
  { key: "lodgingRevenue", label: "Ingreso", kind: "money" },
  { key: "roomNightsSold", label: "Noches", kind: "int" },
];

export default function RoomBreakdownClient({ rows, totals, currency }: Props) {
  const money = (n: number) => formatMoney(n, currency);
  const num = (n: number) => n.toLocaleString("es-AR");
  const pct = (n: number) => `${n.toFixed(0)}%`;

  const [sortKey, setSortKey] = useState<SortKey>("revpar");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revpar");

  const cols: ColDef[] = [
    { key: "roomNumber", label: "Habitación", align: "left", render: (r) => (
        <div className="flex flex-col">
          <span className="font-semibold text-slate-900">Hab. {r.roomNumber}</span>
          <span className="text-xs text-slate-400">{r.roomType}</span>
        </div>
      ) },
    { key: "occupancyRate", label: "Ocup.", metric: "roomOccupancy", align: "right", render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden hidden sm:block">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, r.occupancyRate)}%` }} />
          </div>
          <span className="tabular-nums font-medium text-slate-700 w-9 text-right">{pct(r.occupancyRate)}</span>
        </div>
      ) },
    { key: "roomNightsSold", label: "Noches", metric: "roomNights", align: "right", render: (r) => <span className="tabular-nums">{num(r.roomNightsSold)}</span> },
    { key: "lodgingRevenue", label: "Ingreso", metric: "roomRevenue", align: "right", render: (r) => <span className="tabular-nums font-semibold text-slate-900">{money(r.lodgingRevenue)}</span> },
    { key: "adr", label: "ADR", metric: "roomAdr", align: "right", render: (r) => <span className="tabular-nums">{money(r.adr)}</span> },
    { key: "revpar", label: "RevPAR", metric: "roomRevpar", align: "right", render: (r) => <span className="tabular-nums font-semibold text-slate-900">{money(r.revpar)}</span> },
    { key: "reservations", label: "Reservas", metric: "roomReservations", align: "right", render: (r) => <span className="tabular-nums">{num(r.reservations)}</span> },
    { key: "cancellations", label: "Cancel.", metric: "roomCancellations", align: "right", render: (r) => <span className={`tabular-nums ${r.cancellations > 0 ? "text-rose-600 font-medium" : "text-slate-400"}`}>{num(r.cancellations)}</span> },
    { key: "cleanings", label: "Limpiezas", metric: "roomCleanings", align: "right", render: (r) => <span className="tabular-nums text-slate-600">{num(r.cleanings)}</span> },
  ];

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "roomNumber") {
        cmp = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const chartData = useMemo(() => {
    return [...rows]
      .sort((a, b) => (b[chartMetric] as number) - (a[chartMetric] as number))
      .map((r) => ({ label: `Hab. ${r.roomNumber}`, value: r[chartMetric] as number }));
  }, [rows, chartMetric]);

  const chartKind = CHART_OPTIONS.find((o) => o.key === chartMetric)!.kind;
  const fmtChart = (v: number) =>
    chartKind === "money" ? money(v) : chartKind === "percent" ? pct(v) : num(v);
  const fmtAxis = (v: number) =>
    chartKind === "money" ? (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`) : chartKind === "percent" ? `${v}%` : `${v}`;

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "roomNumber" ? "asc" : "desc");
    }
  }

  // ── Destacados ──
  const withSales = rows.filter((r) => r.roomNightsSold > 0);
  const topRevpar = withSales.length ? withSales.reduce((a, b) => (b.revpar > a.revpar ? b : a)) : null;
  const topOccupancy = withSales.length ? withSales.reduce((a, b) => (b.occupancyRate > a.occupancyRate ? b : a)) : null;
  const idleRooms = rows.filter((r) => r.roomNightsSold === 0).length;

  const highlights = [
    {
      icon: Crown,
      label: "Mayor RevPAR",
      value: topRevpar ? `Hab. ${topRevpar.roomNumber}` : "—",
      sub: topRevpar ? money(topRevpar.revpar) : "sin ventas",
      tone: "text-amber-600",
    },
    {
      icon: Percent,
      label: "Mayor ocupación",
      value: topOccupancy ? `Hab. ${topOccupancy.roomNumber}` : "—",
      sub: topOccupancy ? pct(topOccupancy.occupancyRate) : "sin ventas",
      tone: "text-blue-600",
    },
    {
      icon: Sparkles,
      label: "Habitaciones sin ventas",
      value: num(idleRooms),
      sub: `de ${rows.length} activas`,
      tone: idleRooms > 0 ? "text-rose-600" : "text-emerald-600",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Destacados */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {highlights.map((h) => {
          const Icon = h.icon;
          return (
            <div key={h.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className={`p-2.5 rounded-lg bg-slate-50 ${h.tone}`}>
                <Icon size={20} />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{h.label}</div>
                <div className="text-lg font-bold text-slate-900 leading-tight">{h.value}</div>
                <div className="text-xs text-slate-400">{h.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gráfico con selector de métrica */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800">Ranking por habitación</h3>
            <p className="text-xs text-slate-400 mt-0.5">Habitaciones ordenadas por la métrica elegida</p>
          </div>
          <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1 self-start">
            {CHART_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setChartMetric(o.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  chartMetric === o.key ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          {chartData.every((d) => d.value === 0) ? (
            <div className="flex items-center justify-center h-56 text-slate-400 text-sm font-medium">
              Sin datos para el período seleccionado
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 34 + 20)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={fmtAxis} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: "#475569" }} tickLine={false} axisLine={false} width={68} />
                <Tooltip
                  cursor={{ fill: "rgba(16,185,129,0.08)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as { label: string; value: number };
                    return (
                      <div className="bg-slate-900 text-white text-xs rounded-lg shadow-xl px-3 py-2">
                        <div className="font-bold mb-0.5">{p.label}</div>
                        <div className="text-slate-200">{fmtChart(p.value)}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={26}>
                  {chartData.map((d) => (
                    <Cell key={d.label} fill={BRAND} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Tabla ordenable */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-base font-bold text-slate-800">Detalle por habitación</h3>
          <p className="text-xs text-slate-400 mt-0.5">Tocá una columna para ordenar. Pasá el mouse por ⓘ para ver cómo se calcula.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                {cols.map((c) => {
                  const active = c.key === sortKey;
                  const SortIcon = !active ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={c.key}
                      className={`px-4 py-3 font-semibold ${c.align === "right" ? "text-right" : "text-left"}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${c.align === "right" ? "flex-row-reverse" : ""}`}>
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={`inline-flex items-center gap-1 hover:text-slate-700 transition-colors ${active ? "text-brand-700" : ""}`}
                        >
                          {c.label}
                          <SortIcon size={13} className={active ? "text-brand-600" : "text-slate-300"} />
                        </button>
                        {c.metric && <InfoTooltip metric={c.metric} />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((r) => (
                <tr key={r.roomId} className="hover:bg-slate-50/50">
                  {cols.map((c) => (
                    <td key={c.key} className={`px-4 py-3 ${c.align === "right" ? "text-right" : "text-left"}`}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <td className="px-4 py-3 text-left">Total ({rows.length} hab.)</td>
                <td className="px-4 py-3 text-right tabular-nums">{pct(totals.occupancyRate)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{num(totals.roomNightsSold)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(totals.lodgingRevenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(totals.adr)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(totals.revpar)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{num(totals.reservations)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{num(totals.cancellations)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{num(totals.cleanings)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
