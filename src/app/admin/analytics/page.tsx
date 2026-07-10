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
  Wallet,
  XCircle,
} from "lucide-react";
import { getHotelSettings, getManagementDashboardData, type KpiWithDelta } from "@/lib/data";
import { formatMoney } from "@/lib/format";
import { addDaysToDateKey } from "@/lib/analytics";
import { hotelDateKey } from "@/lib/time";
import DashboardCharts from "./DashboardCharts";

export const revalidate = 0;

type PageProps = { searchParams: Promise<{ from?: string; to?: string }> };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-07-10" → "10/07/2026" */
function formatKey(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

const CLEANING_LABELS: Record<string, string> = {
  checkout: "Post check-out",
  checkin_daily: "Diaria (ocupadas)",
  empty_maintenance: "Mantenimiento vacías",
  occupied_anomaly: "Ocupada sin reserva",
  otros: "Otras",
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
  let fromKey = params.from && DATE_KEY.test(params.from) ? params.from : addDaysToDateKey(todayKey, -29);
  let toKey = params.to && DATE_KEY.test(params.to) ? params.to : todayKey;
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];

  const data = await getManagementDashboardData(fromKey, toKey);
  const money = (n: number) => formatMoney(n, data.currency);
  const num = (n: number) => n.toLocaleString("es-AR");

  // ── Presets de rango ──
  const [ty, tm] = todayKey.split("-").map(Number);
  const monthStart = `${ty}-${pad(tm)}-01`;
  const prevMonthLast = new Date(Date.UTC(ty, tm - 1, 0));
  const pmY = prevMonthLast.getUTCFullYear();
  const pmM = prevMonthLast.getUTCMonth() + 1;
  const presets = [
    { label: "Hoy", from: todayKey, to: todayKey },
    { label: "7 días", from: addDaysToDateKey(todayKey, -6), to: todayKey },
    { label: "30 días", from: addDaysToDateKey(todayKey, -29), to: todayKey },
    { label: "Mes actual", from: monthStart, to: todayKey },
    { label: "Mes anterior", from: `${pmY}-${pad(pmM)}-01`, to: `${pmY}-${pad(pmM)}-${pad(prevMonthLast.getUTCDate())}` },
  ];

  const k = data.kpis;
  const heroCards = [
    { label: "Ingreso alojamiento", value: money(k.lodgingRevenue.current), delta: k.lodgingRevenue, good: "up" as const, icon: DollarSign, gradient: "from-emerald-500 to-emerald-600" },
    { label: "Ocupación", value: `${k.occupancyRate.current.toFixed(1)}%`, delta: k.occupancyRate, good: "up" as const, icon: TrendingUp, gradient: "from-blue-500 to-blue-600" },
    { label: "ADR (tarifa/noche)", value: money(k.adr.current), delta: k.adr, good: "up" as const, icon: BedDouble, gradient: "from-indigo-500 to-indigo-600" },
    { label: "RevPAR", value: money(k.revpar.current), delta: k.revpar, good: "up" as const, icon: BarChart3, gradient: "from-violet-500 to-violet-600" },
    { label: "Caja cobrada", value: money(k.totalPaymentsIncome.current), delta: k.totalPaymentsIncome, good: "up" as const, icon: Wallet, gradient: "from-teal-500 to-teal-600" },
    { label: "Por cobrar", value: money(data.accountsReceivable), delta: null, hint: "Saldo pendiente de reservas activas", icon: CircleDollarSign, gradient: "from-amber-500 to-orange-600" },
  ];

  const secondary = [
    { label: "Reservas nuevas", value: num(k.reservationsCreated.current), delta: k.reservationsCreated, good: "up" as const, icon: CalendarCheck },
    { label: "Tasa de cancelación", value: `${k.cancellationRate.current.toFixed(1)}%`, delta: k.cancellationRate, good: "down" as const, icon: XCircle },
    { label: "Estadía promedio", value: `${k.avgLengthOfStay.current.toFixed(1)} noches`, delta: k.avgLengthOfStay, good: "up" as const, icon: Moon },
    { label: "Anticipación (lead time)", value: `${k.avgLeadTimeDays.current.toFixed(1)} días`, delta: k.avgLeadTimeDays, good: "up" as const, icon: Clock },
  ];

  return (
    <div className="p-8 pb-20 overflow-y-auto w-full">
      {/* Header */}
      <div className="mb-6 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
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

        <form method="GET" className="flex items-end gap-2 shrink-0 flex-wrap">
          <div className="flex flex-col">
            <label htmlFor="from" className="text-xs font-semibold text-slate-500 mb-1">Desde</label>
            <input id="from" type="date" name="from" defaultValue={fromKey} className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none" />
          </div>
          <div className="flex flex-col">
            <label htmlFor="to" className="text-xs font-semibold text-slate-500 mb-1">Hasta</label>
            <input id="to" type="date" name="to" defaultValue={toKey} className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none" />
          </div>
          <button type="submit" className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors">Filtrar</button>
        </form>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2 mb-8">
        {presets.map((p) => {
          const active = p.from === fromKey && p.to === toKey;
          return (
            <a
              key={p.label}
              href={`/admin/analytics?from=${p.from}&to=${p.to}`}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                active
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-brand-400 hover:text-brand-700"
              }`}
            >
              {p.label}
            </a>
          );
        })}
      </div>

      {/* Hero KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
        {heroCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`bg-gradient-to-br ${c.gradient} rounded-2xl p-5 shadow-lg relative overflow-hidden text-white flex flex-col justify-between min-h-[148px]`}>
              <div className="absolute top-0 right-0 p-3 opacity-15"><Icon size={78} /></div>
              <div className="relative z-10">
                <div className="flex items-center gap-2 font-medium mb-1 text-sm opacity-90"><Icon size={16} />{c.label}</div>
                <h2 className="text-3xl font-bold tracking-tight">{c.value}</h2>
              </div>
              <div className="relative z-10 mt-3">
                {c.delta ? <DeltaPill delta={c.delta} good={c.good} /> : <span className="text-xs opacity-80">{c.hint}</span>}
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
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <Icon size={14} /> {s.label}
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
              <h3 className="text-base font-bold text-slate-800">Cuenta corriente</h3>
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
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Scale size={14} /> Diferencias de arqueo</div>
                <div className={`text-2xl font-bold mt-1 ${data.cashDiscrepancyTotal > 0 ? "text-rose-600" : "text-slate-900"}`}>{money(data.cashDiscrepancyTotal)}</div>
                <div className="text-xs text-slate-400 mt-0.5">Σ |diferencia| de turnos cerrados</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><AlertTriangle size={14} /> Alertas abiertas</div>
                <div className={`text-2xl font-bold mt-1 ${data.openAlerts > 0 ? "text-amber-600" : "text-slate-900"}`}>{num(data.openAlerts)}</div>
                <div className="text-xs text-slate-400 mt-0.5">Sin resolver (histórico)</div>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-2"><Sparkles size={14} /> Limpiezas del período</div>
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
        descuento, sin extras); la caja cobrada es la plata efectivamente ingresada.
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
