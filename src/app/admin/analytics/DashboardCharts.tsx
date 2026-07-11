"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/format";
import type { MetricKey } from "@/lib/metric-glossary";
import InfoTooltip from "./InfoTooltip";

// Paleta categórica en orden fijo (no se cicla): cada entidad conserva su color.
const CATEGORICAL = [
  "#10b981", // emerald-500
  "#6366f1", // indigo-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#64748b", // slate-500
];
const BRAND = "#10b981";

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

const EXTRA_LABELS: Record<string, string> = {
  half_day: "Media estadía",
  minibar: "Minibar",
  damage: "Daños",
};

type OccupancyPoint = { date: string; occupied: number; available: number; rate: number };
type DailyPoint = { date: string; total: number };
type NamedTotal = { label: string; total: number };

type Props = {
  currency: string;
  dailyOccupancy: OccupancyPoint[];
  dailyCash: DailyPoint[];
  revenueByRoomType: { room_type: string; total: number }[];
  paymentMethods: { method: string; total: number }[];
  extraChargesByType: { charge_type: string; total: number }[];
};

// "2026-07-10" → "10/07"
function shortDay(dateKey: string): string {
  const [, mm, dd] = dateKey.split("-");
  return `${dd}/${mm}`;
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-56 text-slate-400 text-sm font-medium">
      Sin datos para el período seleccionado
    </div>
  );
}

function TooltipBox({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="bg-slate-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 pointer-events-none">
      <div className="font-bold mb-0.5">{title}</div>
      {lines.map((l) => (
        <div key={l} className="text-slate-200">
          {l}
        </div>
      ))}
    </div>
  );
}

const axisTick = { fontSize: 11, fill: "#94a3b8" };

// ── Ocupación diaria (área, serie única) ──
function OccupancyTrend({ data }: { data: OccupancyPoint[] }) {
  if (data.length === 0) return <EmptyState />;
  const chartData = data.map((d) => ({ ...d, label: shortDay(d.date) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="occGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={44}
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          cursor={{ stroke: "#cbd5e1", strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as OccupancyPoint & { label: string };
            return (
              <TooltipBox
                title={p.label}
                lines={[`Ocupación: ${p.rate.toFixed(1)}%`, `${p.occupied} de ${p.available} hab.`]}
              />
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="rate"
          stroke={BRAND}
          strokeWidth={2}
          fill="url(#occGradient)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Caja cobrada por día (barras) ──
function CashTrend({ data, currency }: { data: DailyPoint[]; currency: string }) {
  if (data.length === 0 || data.every((d) => d.total === 0)) return <EmptyState />;
  const chartData = data.map((d) => ({ ...d, label: shortDay(d.date) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 10, right: 12, left: -4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
        />
        <Tooltip
          cursor={{ fill: "rgba(16,185,129,0.08)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as DailyPoint & { label: string };
            return <TooltipBox title={p.label} lines={[formatMoney(p.total, currency)]} />;
          }}
        />
        <Bar dataKey="total" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Barras horizontales por categoría (ingreso por tipo / método de pago) ──
function HorizontalBars({
  data,
  currency,
  colored,
}: {
  data: NamedTotal[];
  currency: string;
  colored?: boolean;
}) {
  if (data.length === 0 || data.every((d) => d.total === 0)) return <EmptyState />;
  const height = Math.max(140, data.length * 44 + 20);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
        barCategoryGap="25%"
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
        <XAxis
          type="number"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 12, fill: "#475569" }}
          tickLine={false}
          axisLine={false}
          width={110}
        />
        <Tooltip
          cursor={{ fill: "rgba(100,116,139,0.08)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as NamedTotal;
            return <TooltipBox title={p.label} lines={[formatMoney(p.total, currency)]} />;
          }}
        />
        <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={colored ? CATEGORICAL[i % CATEGORICAL.length] : BRAND} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartCard({
  title,
  subtitle,
  metric,
  children,
}: {
  title: string;
  subtitle: string;
  metric: MetricKey;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 bg-slate-50/50">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5">
          {title}
          <InfoTooltip metric={metric} />
        </h3>
        <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function DashboardCharts({
  currency,
  dailyOccupancy,
  dailyCash,
  revenueByRoomType,
  paymentMethods,
  extraChargesByType,
}: Props) {
  const roomTypeData: NamedTotal[] = revenueByRoomType.map((r) => ({
    label: r.room_type,
    total: r.total,
  }));
  const methodData: NamedTotal[] = paymentMethods.map((p) => ({
    label: METHOD_LABELS[p.method] ?? p.method,
    total: p.total,
  }));
  const extraData: NamedTotal[] = extraChargesByType.map((e) => ({
    label: EXTRA_LABELS[e.charge_type] ?? e.charge_type,
    total: e.total,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ChartCard title="Ocupación por día" subtitle="% de habitaciones ocupadas (histórico del período)" metric="dailyOccupancy">
        <OccupancyTrend data={dailyOccupancy} />
      </ChartCard>

      <ChartCard title="Caja cobrada por día" subtitle="Pagos registrados por día (zona del hotel)" metric="dailyCash">
        <CashTrend data={dailyCash} currency={currency} />
      </ChartCard>

      <ChartCard title="Ingreso por tipo de habitación" subtitle="Alojamiento devengado en el período" metric="revenueByRoomType">
        <HorizontalBars data={roomTypeData} currency={currency} />
      </ChartCard>

      <ChartCard title="Cobros por método de pago" subtitle="Distribución de la caja cobrada" metric="paymentMethods">
        <HorizontalBars data={methodData} currency={currency} colored />
      </ChartCard>

      {extraData.length > 0 && (
        <ChartCard title="Ingresos extra" subtitle="Minibar, daños y media estadía" metric="extraCharges">
          <HorizontalBars data={extraData} currency={currency} colored />
        </ChartCard>
      )}
    </div>
  );
}
