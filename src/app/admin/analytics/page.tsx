import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  BedDouble,
  CalendarCheck,
  CircleDollarSign,
  Clock,
  DollarSign,
  Moon,
  Scale,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { getHotelSettings, getManagementDashboardData, type KpiWithDelta } from "@/lib/data";
import { formatMoney } from "@/lib/format";
import { hotelDateKey } from "@/lib/time";
import type { MetricKey } from "@/lib/metric-glossary";
import DashboardCharts from "./DashboardCharts";
import DashboardNav from "./DashboardNav";
import InfoTooltip from "./InfoTooltip";
import { buildPresets, formatKey, resolveRange } from "./shared";

export const revalidate = 0;

type PageProps = { searchParams: Promise<{ from?: string; to?: string }> };

const CLEANING_LABELS: Record<string, string> = {
  checkout: "Post check-out",
  checkin_daily: "Diaria (ocupadas)",
  empty_maintenance: "Mantenimiento vacías",
  occupied_anomaly: "Ocupada sin reserva",
  otros: "Otras",
};

type HeroCard = {
  label: string;
  value: string;
  delta: KpiWithDelta | null;
  good?: "up" | "down";
  hint?: string;
  icon: LucideIcon;
  gradient: string;
  info: MetricKey;
};

type SecondaryCard = {
  label: string;
  value: string;
  delta: KpiWithDelta;
  good: "up" | "down";
  icon: LucideIcon;
  info: MetricKey;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  // ── Guard admin ──
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/forbidden");

  // ── Rango (default: últimos 30 días en zona del hotel) ──
  const settings = await getHotelSettings();
  const tz = settings.timezone || "America/Argentina/Tucuman";
  const todayKey = hotelDateKey(new Date(), tz);

  const params = await searchParams;
  const { fromKey, toKey } = resolveRange(params, todayKey);
  const presets = buildPresets(todayKey);

  const data = await getManagementDashboardData(fromKey, toKey);
  const money = (n: number) => formatMoney(n, data.currency);
  const num = (n: number) => n.toLocaleString("es-AR");

  const k = data.kpis;
  const heroCards: HeroCard[] = [
    { label: "Ingreso alojamiento", value: money(k.lodgingRevenue.current), delta: k.lodgingRevenue, good: "up", icon: DollarSign, gradient: "from-emerald-500 to-emerald-600", info: "lodgingRevenue" },
    { label: "Ocupación", value: `${k.occupancyRate.current.toFixed(1)}%`, delta: k.occupancyRate, good: "up", icon: TrendingUp, gradient: "from-blue-500 to-blue-600", info: "occupancyRate" },
    { label: "ADR (tarifa/noche)", value: money(k.adr.current), delta: k.adr, good: "up", icon: BedDouble, gradient: "from-indigo-500 to-indigo-600", info: "adr" },
    { label: "RevPAR", value: money(k.revpar.current), delta: k.revpar, good: "up", icon: BarChart3, gradient: "from-violet-500 to-violet-600", info: "revpar" },
    { label: "Caja cobrada", value: money(k.totalPaymentsIncome.current), delta: k.totalPaymentsIncome, good: "up", icon: Wallet, gradient: "from-teal-500 to-teal-600", info: "totalPaymentsIncome" },
    { label: "Por cobrar", value: money(data.accountsReceivable), delta: null, hint: "Saldo pendiente de reservas activas", icon: CircleDollarSign, gradient: "from-amber-500 to-orange-600", info: "accountsReceivable" },
  ];

  const secondary: SecondaryCard[] = [
    { label: "Caja sin Vale Blanco", value: money(k.totalPaymentsIncomeNoVale.current), delta: k.totalPaymentsIncomeNoVale, good: "up", icon: Wallet, info: "totalPaymentsIncomeNoVale" },
    { label: "Pasajeros-noche", value: num(k.guestNights.current), delta: k.guestNights, good: "up", icon: Users, info: "guestNights" },
    { label: "Prom. pax/noche", value: k.avgGuestsPerNight.current.toFixed(1), delta: k.avgGuestsPerNight, good: "up", icon: Users, info: "avgGuestsPerNight" },
    { label: "Reservas nuevas", value: num(k.reservationsCreated.current), delta: k.reservationsCreated, good: "up", icon: CalendarCheck, info: "reservationsCreated" },
    { label: "Tasa de cancelación", value: `${k.cancellationRate.current.toFixed(1)}%`, delta: k.cancellationRate, good: "down", icon: XCircle, info: "cancellationRate" },
    { label: "Estadía promedio", value: `${k.avgLengthOfStay.current.toFixed(1)} noches`, delta: k.avgLengthOfStay, good: "up", icon: Moon, info: "avgLengthOfStay" },
    { label: "Anticipación (lead time)", value: `${k.avgLeadTimeDays.current.toFixed(1)} días`, delta: k.avgLeadTimeDays, good: "up", icon: Clock, info: "avgLeadTimeDays" },
  ];

  return (
    <div className="p-8 pb-20 overflow-y-auto w-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl shadow-lg shadow-emerald-500/20">
            <BarChart3 size={22} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Tablero Gerencial</h1>
        </div>
        <p className="text-slate-500">
          {formatKey(data.range.from)} – {formatKey(data.range.to)} ({data.range.days} días) ·{" "}
          <span className="text-slate-400">
            comparado vs. {formatKey(data.previousRange.from)} – {formatKey(data.previousRange.to)}
          </span>
        </p>
      </div>

      <DashboardNav activeTab="general" fromKey={fromKey} toKey={toKey} presets={presets} />

      {/* Hero KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
        {heroCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`bg-gradient-to-br ${c.gradient} rounded-2xl p-5 shadow-lg relative text-white flex flex-col justify-between min-h-[148px]`}>
              <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                <div className="absolute top-0 right-0 p-3 opacity-15"><Icon size={78} /></div>
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-1.5 font-medium mb-1 text-sm opacity-90">
                  <Icon size={16} />
                  <span>{c.label}</span>
                  <InfoTooltip metric={c.info} tone="light" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">{c.value}</h2>
              </div>
              <div className="relative z-10 mt-3">
                {c.delta ? <DeltaPill delta={c.delta} good={c.good ?? "up"} /> : <span className="text-xs opacity-80">{c.hint}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tira secundaria */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
        {secondary.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <Icon size={14} /> <span>{s.label}</span>
                <InfoTooltip metric={s.info} />
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1.5">{s.value}</div>
              <div className="mt-1"><DeltaText delta={s.delta} good={s.good} /></div>
            </div>
          );
        })}
      </div>

      {/* Gráficos */}
      <div className="mb-10">
        <DashboardCharts
          currency={data.currency}
          dailyOccupancy={data.dailyOccupancy}
          dailyCash={data.dailyCash}
          dailyGuestNights={data.dailyGuestNights}
          weekdaySeasonality={data.weekdaySeasonality}
          revenueByRoomType={data.revenueByRoomType}
          paymentMethods={data.paymentMethods}
          extraChargesByType={data.extraChargesByType}
        />
      </div>

      {/* Cobranzas + Control */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cobranzas / cuenta corriente */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5">
                Cuenta corriente
                <InfoTooltip metric="currentAccountDebt" />
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Deuda total y principales deudores (al día de hoy)</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900">{money(data.currentAccountDebt)}</div>
              <div className="text-xs text-slate-400">deuda total</div>
            </div>
          </div>
          <div className="p-5">
            {data.topDebtors.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">Sin deudores 🎉</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-slate-100">
                    <th className="text-left font-semibold pb-2">Cliente</th>
                    <th className="text-right font-semibold pb-2">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.topDebtors.map((d) => (
                    <tr key={d.name} className="hover:bg-slate-50/50">
                      <td className="py-2 text-slate-700 font-medium">{d.name}</td>
                      <td className="py-2 text-right font-bold text-slate-900">{money(d.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Control de caja y operación */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-base font-bold text-slate-800">Control y operación</h3>
            <p className="text-xs text-slate-400 mt-0.5">Arqueos, alertas y limpieza del período</p>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <Scale size={14} /> <span>Diferencias de arqueo</span>
                  <InfoTooltip metric="cashDiscrepancy" />
                </div>
                <div className={`text-2xl font-bold mt-1 ${data.cashDiscrepancyTotal > 0 ? "text-rose-600" : "text-slate-900"}`}>{money(data.cashDiscrepancyTotal)}</div>
                <div className="text-xs text-slate-400 mt-0.5">Σ |diferencia| de turnos cerrados</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <AlertTriangle size={14} /> <span>Alertas abiertas</span>
                  <InfoTooltip metric="openAlerts" />
                </div>
                <div className={`text-2xl font-bold mt-1 ${data.openAlerts > 0 ? "text-amber-600" : "text-slate-900"}`}>{num(data.openAlerts)}</div>
                <div className="text-xs text-slate-400 mt-0.5">Sin resolver (histórico)</div>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-2">
                <Sparkles size={14} /> <span>Limpiezas del período</span>
                <InfoTooltip metric="cleanings" />
              </div>
              {data.cleaningsByCategory.length === 0 ? (
                <p className="text-sm text-slate-400">Sin limpiezas registradas.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.cleaningsByCategory.map((c) => (
                    <span key={c.category} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-sm text-slate-700">
                      <span className="font-semibold text-slate-900">{c.count}</span>
                      {CLEANING_LABELS[c.category] ?? c.category}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-8 max-w-3xl">
        Ingresos y ocupación se miden por estadía; reservas y cancelaciones por fecha de alta; saldos y
        deuda son el estado actual (no acotados al rango). El ingreso de alojamiento es devengado (neto de
        descuento, sin extras); la caja cobrada es la plata efectivamente ingresada. Pasá el mouse por el
        ícono <span className="font-semibold">ⓘ</span> de cada métrica para ver cómo se calcula.
      </p>
    </div>
  );
}

// ── Deltas ──
function deltaParts(delta: KpiWithDelta, good: "up" | "down") {
  const pct = delta.deltaPct;
  if (pct === null || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct * 10) / 10;
  const flat = rounded === 0;
  const up = rounded > 0;
  const isGood = flat ? null : good === "up" ? up : !up;
  return { rounded, flat, up, isGood, arrow: flat ? "→" : up ? "▲" : "▼" };
}

function DeltaPill({ delta, good }: { delta: KpiWithDelta; good: "up" | "down" }) {
  const d = deltaParts(delta, good);
  if (!d) return <span className="text-xs opacity-80">sin base previa</span>;
  const bg = d.flat ? "bg-white/20" : d.isGood ? "bg-emerald-500/40" : "bg-rose-500/40";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold text-white ${bg} rounded-full px-2 py-0.5`}>
      {d.arrow} {Math.abs(d.rounded)}% <span className="opacity-80 font-medium">vs. anterior</span>
    </span>
  );
}

function DeltaText({ delta, good }: { delta: KpiWithDelta; good: "up" | "down" }) {
  const d = deltaParts(delta, good);
  if (!d) return <span className="text-xs text-slate-400">sin base previa</span>;
  const color = d.flat ? "text-slate-400" : d.isGood ? "text-emerald-600" : "text-rose-600";
  return (
    <span className={`text-xs font-bold ${color}`}>
      {d.arrow} {Math.abs(d.rounded)}% <span className="font-medium text-slate-400">vs. anterior</span>
    </span>
  );
}
