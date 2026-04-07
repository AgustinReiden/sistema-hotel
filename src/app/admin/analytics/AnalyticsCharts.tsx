"use client";

import { useState } from "react";
import type {
  DailyIncome,
  RoomTypeOccupancy,
  PaymentMethodBreakdown,
  StatusBreakdown,
} from "@/lib/data";

// ── Color palettes ──
const CHART_COLORS = [
  "#10b981", // emerald-500
  "#6366f1", // indigo-500
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
];

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  confirmed: "#6366f1",
  checked_in: "#10b981",
  checked_out: "#64748b",
  cancelled: "#ef4444",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendientes",
  confirmed: "Confirmadas",
  checked_in: "Hospedados",
  checked_out: "Finalizadas",
  cancelled: "Canceladas",
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  credit_card: "T. Crédito",
  debit_card: "T. Débito",
  bank_transfer: "Transferencia",
  mercado_pago: "Mercado Pago",
  vale_blanco: "Vale Blanco",
  cuenta_corriente: "Cta. Corriente",
  other: "Otro",
};

// ── Tooltip state ──
type TooltipInfo = { x: number; y: number; content: string } | null;

function Tooltip({ info }: { info: TooltipInfo }) {
  if (!info) return null;
  return (
    <div
      className="absolute z-50 bg-slate-900 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xl pointer-events-none whitespace-nowrap"
      style={{ left: info.x, top: info.y - 36 }}
    >
      {info.content}
    </div>
  );
}

// ═══════════════════════════════════════
// ── Bar Chart: Daily Income
// ═══════════════════════════════════════
function DailyIncomeChart({ data }: { data: DailyIncome[] }) {
  const [tooltip, setTooltip] = useState<TooltipInfo>(null);

  if (data.length === 0) return <EmptyState />;

  const maxVal = Math.max(...data.map((d) => d.total), 1);
  const chartH = 200;
  const barGap = 4;
  const barW = Math.max(
    12,
    Math.min(48, (600 - barGap * data.length) / data.length)
  );
  const chartW = data.length * (barW + barGap) + 40;

  return (
    <div className="relative overflow-x-auto">
      <svg
        width={Math.max(chartW, 300)}
        height={chartH + 40}
        className="mx-auto"
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
          <g key={pct}>
            <line
              x1={35}
              y1={chartH - chartH * pct}
              x2={chartW}
              y2={chartH - chartH * pct}
              stroke="#e2e8f0"
              strokeDasharray="4"
            />
            <text
              x={30}
              y={chartH - chartH * pct + 4}
              textAnchor="end"
              className="fill-slate-400 text-[10px]"
            >
              {Math.round(maxVal * pct).toLocaleString()}
            </text>
          </g>
        ))}

        {/* Bars */}
        {data.map((d, i) => {
          const barH = (d.total / maxVal) * chartH;
          const x = 40 + i * (barW + barGap);
          const y = chartH - barH;
          const dayLabel = d.date.slice(5); // MM-DD

          return (
            <g
              key={d.date}
              onMouseEnter={(e) => {
                const rect = (
                  e.currentTarget.closest("svg") as SVGSVGElement
                ).getBoundingClientRect();
                setTooltip({
                  x: x + barW / 2 - rect.left + rect.left,
                  y: y,
                  content: `${d.date}: $${d.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
              className="cursor-pointer"
            >
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={4}
                className="fill-emerald-500 hover:fill-emerald-400 transition-colors"
              />
              <text
                x={x + barW / 2}
                y={chartH + 14}
                textAnchor="middle"
                className="fill-slate-500 text-[9px]"
              >
                {dayLabel}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip info={tooltip} />
    </div>
  );
}

// ═══════════════════════════════════════
// ── Donut Chart (reusable)
// ═══════════════════════════════════════
function DonutChart({
  data,
  colorMap,
  labelMap,
}: {
  data: { key: string; value: number }[];
  colorMap?: Record<string, string>;
  labelMap?: Record<string, string>;
}) {
  const [tooltip, setTooltip] = useState<TooltipInfo>(null);

  if (data.length === 0) return <EmptyState />;

  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = 100;
  const cy = 100;
  const r = 80;
  const innerR = 50;

  const arcs = data.reduce<
    Array<{ key: string; value: number; pct: number; angle: number; start: number; color: string }>
  >((acc, d, i) => {
    const previousArc = acc[acc.length - 1];
    const start = previousArc ? previousArc.start + previousArc.angle : -90;
    const pct = total > 0 ? d.value / total : 0;
    const angle = pct * 360;
    acc.push({
      ...d,
      pct,
      angle,
      start,
      color: colorMap?.[d.key] ?? CHART_COLORS[i % CHART_COLORS.length],
    });
    return acc;
  }, []);

  function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  return (
    <div className="flex items-center gap-6 flex-wrap justify-center">
      <div className="relative">
        <svg width={200} height={200}>
          {arcs.map((arc) => {
            if (arc.angle < 0.5) return null;
            const outerStart = polarToCartesian(cx, cy, r, arc.start);
            const innerStart = polarToCartesian(cx, cy, innerR, arc.start);
            const outerEnd = polarToCartesian(cx, cy, r, arc.start + arc.angle);
            const innerEnd = polarToCartesian(cx, cy, innerR, arc.start + arc.angle);
            const largeArc = arc.angle > 180 ? 1 : 0;

            const path = [
              `M ${outerEnd.x} ${outerEnd.y}`,
              `A ${r} ${r} 0 ${largeArc} 0 ${outerStart.x} ${outerStart.y}`,
              `L ${innerStart.x} ${innerStart.y}`,
              `A ${innerR} ${innerR} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
              "Z",
            ].join(" ");

            return (
              <path
                key={arc.key}
                d={path}
                fill={arc.color}
                className="hover:opacity-80 transition-opacity cursor-pointer"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTooltip({
                    x: rect.x + rect.width / 2,
                    y: rect.y,
                    content: `${labelMap?.[arc.key] ?? arc.key}: ${arc.value} (${(arc.pct * 100).toFixed(1)}%)`,
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}
          {/* Center text */}
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            className="fill-slate-800 text-xl font-bold"
          >
            {total}
          </text>
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            className="fill-slate-400 text-[10px]"
          >
            Total
          </text>
        </svg>
        <Tooltip info={tooltip} />
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-2">
        {arcs.map((arc) => (
          <div key={arc.key} className="flex items-center gap-2 text-sm">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: arc.color }}
            />
            <span className="text-slate-600 font-medium">
              {labelMap?.[arc.key] ?? arc.key}
            </span>
            <span className="text-slate-400 ml-auto font-semibold">
              {arc.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// ── Horizontal Bar Chart: Payment Methods
// ═══════════════════════════════════════
function HorizontalBarChart({ data }: { data: PaymentMethodBreakdown[] }) {
  if (data.length === 0) return <EmptyState />;

  const maxVal = Math.max(...data.map((d) => d.total), 1);

  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const pct = (d.total / maxVal) * 100;
        const label = METHOD_LABELS[d.method] ?? d.method;
        return (
          <div key={d.method}>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium text-slate-700">{label}</span>
              <span className="font-bold text-slate-800">
                ${d.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-40 text-slate-400 text-sm font-medium">
      Sin datos para el período seleccionado
    </div>
  );
}

// ═══════════════════════════════════════
// ── Main export
// ═══════════════════════════════════════
type AnalyticsChartsProps = {
  dailyIncome: DailyIncome[];
  roomTypeOccupancy: RoomTypeOccupancy[];
  paymentMethods: PaymentMethodBreakdown[];
  statusBreakdown: StatusBreakdown[];
};

export default function AnalyticsCharts({
  dailyIncome,
  roomTypeOccupancy,
  paymentMethods,
  statusBreakdown,
}: AnalyticsChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Daily Income */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800">Ingresos por Día</h3>
          <p className="text-xs text-slate-400 mt-0.5">Pagos registrados en el período</p>
        </div>
        <div className="p-6">
          <DailyIncomeChart data={dailyIncome} />
        </div>
      </div>

      {/* Room Type Occupancy */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800">Ocupación por Tipo</h3>
          <p className="text-xs text-slate-400 mt-0.5">Reservas activas por tipo de habitación</p>
        </div>
        <div className="p-6">
          <DonutChart
            data={roomTypeOccupancy.map((r) => ({
              key: r.room_type,
              value: r.count,
            }))}
          />
        </div>
      </div>

      {/* Payment Methods */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800">Métodos de Pago</h3>
          <p className="text-xs text-slate-400 mt-0.5">Distribución de ingresos por método</p>
        </div>
        <div className="p-6">
          <HorizontalBarChart data={paymentMethods} />
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800">Estados de Reservas</h3>
          <p className="text-xs text-slate-400 mt-0.5">Distribución de reservas por estado</p>
        </div>
        <div className="p-6">
          <DonutChart
            data={statusBreakdown.map((s) => ({
              key: s.status,
              value: s.count,
            }))}
            colorMap={STATUS_COLORS}
            labelMap={STATUS_LABELS}
          />
        </div>
      </div>
    </div>
  );
}
