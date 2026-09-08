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
  HandCoins,
  Moon,
  Receipt,
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
  delta: KpiWithDelta | null;
  good: "up" | "down";
  hint?: string;
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
  const s = data.settlement;
  const totalToCollect = data.accountsReceivable + data.currentAccountDebt;

  // Fila principal: primero la plata (venta cerrada y en qué terminó), después el
  // rendimiento. Las tres primeras tarjetas son las patas de una misma cuenta.
  const heroCards: HeroCard[] = [
    { label: "Venta cerrada", value: money(s.sales), delta: k.closedSales, good: "up", icon: Receipt, gradient: "from-emerald-500 to-emerald-600", info: "closedSales" },
    { label: "Cobrado en dinero", value: money(s.collectedMoney), delta: k.closedCollectedMoney, good: "up", icon: Wallet, gradient: "from-teal-500 to-teal-600", info: "closedCollectedMoney" },
    { label: "Fiado a cuenta corriente", value: money(s.credit), delta: k.closedCredit, good: "down", icon: HandCoins, gradient: "from-amber-500 to-orange-600", info: "closedCredit" },
    { label: "Ocupación", value: `${k.occupancyRate.current.toFixed(1)}%`, delta: k.occupancyRate, good: "up", icon: TrendingUp, gradient: "from-blue-500 to-blue-600", info: "occupancyRate" },
    { label: "ADR (tarifa/noche)", value: money(k.adr.current), delta: k.adr, good: "up", icon: BedDouble, gradient: "from-indigo-500 to-indigo-600", info: "adr" },
    { label: "RevPAR", value: money(k.revpar.current), delta: k.revpar, good: "up", icon: BarChart3, gradient: "from-violet-500 to-violet-600", info: "revpar" },
  ];

  const secondary: SecondaryCard[] = [
    { label: "Ingreso alojamiento (devengado)", value: money(k.lodgingRevenue.current), delta: k.lodgingRevenue, good: "up", icon: DollarSign, info: "lodgingRevenue" },
    { label: "Caja cobrada del período", value: money(k.totalPaymentsIncome.current), delta: k.totalPaymentsIncome, good: "up", icon: Wallet, info: "totalPaymentsIncome" },
    { label: "Caja en dinero", value: money(k.totalPaymentsIncomeNoVale.current), delta: k.totalPaymentsIncomeNoVale, good: "up", icon: Wallet, info: "totalPaymentsIncomeNoVale" },
    { label: "Cobranzas de cta. cte.", value: money(data.accountFlow.collected), delta: null, good: "up", hint: "Pagos a cuenta del período", icon: HandCoins, info: "accountCollected" },
    { label: "Pasajeros-noche", value: num(k.guestNights.current), delta: k.guestNights, good: "up", icon: Users, info: "guestNights" },
    { label: "Prom. pax/noche", value: k.avgGuestsPerNight.current.toFixed(1), delta: k.avgGuestsPerNight, good: "up", icon: Users, info: "avgGuestsPerNight" },
    { label: "Reservas nuevas", value: num(k.reservationsCreated.current), delta: k.reservationsCreated, good: "up", icon: CalendarCheck, info: "reservationsCreated" },
    { label: "Tasa de cancelación", value: `${k.cancellationRate.current.toFixed(1)}%`, delta: k.cancellationRate, good: "down", icon: XCircle, info: "cancellationRate" },
    { label: "Estadía promedio", value: `${k.avgLengthOfStay.current.toFixed(1)} noches`, delta: k.avgLengthOfStay, good: "up", icon: Moon, info: "avgLengthOfStay" },
    { label: "Anticipación (lead time)", value: `${k.avgLeadTimeDays.current.toFixed(1)} días`, delta: k.avgLeadTimeDays, good: "up", icon: Clock, info: "avgLeadTimeDays" },
  ];

  // Las cuatro patas en las que termina toda venta cerrada. Suman exacto la venta.
  const settlementLegs = [
    { label: "Cobrado en dinero", value: s.collectedMoney, color: "bg-teal-500", text: "text-teal-700", note: "Efectivo, tarjetas, transferencia, MP" },
    { label: "Vale blanco", value: s.vale, color: "bg-slate-400", text: "text-slate-600", note: "Consumo interno: no entró plata" },
    { label: "Fiado a cta. cte.", value: s.credit, color: "bg-amber-500", text: "text-amber-700", note: "Se cobra después, fuera de caja" },
    { label: "Saldo impago", value: s.pending, color: "bg-rose-500", text: "text-rose-700", note: "Quedó sin cobrar al cerrar" },
  ].filter((leg) => leg.value !== 0);

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

      {/* Conciliación: la cuenta que cierra */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-10">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5">
              Cómo se cerró la venta del período
              <InfoTooltip metric="settlement" />
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {num(s.stays)} estadía{s.stays === 1 ? "" : "s"} con check-out entre {formatKey(data.range.from)} y{" "}
              {formatKey(data.range.to)} · alojamiento {money(s.lodging)} + extras {money(s.extras)}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-slate-900">{money(s.sales)}</div>
            <div className="text-xs text-slate-400">venta cerrada</div>
          </div>
        </div>

        <div className="p-5">
          {s.sales === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              No hubo estadías cerradas en el período seleccionado.
            </p>
          ) : (
            <>
              {/* Barra proporcional: de un vistazo, cuánto de la venta fue plata */}
              <div className="flex h-3 w-full rounded-full overflow-hidden bg-slate-100 mb-4">
                {settlementLegs.map((leg) => (
                  <div
                    key={leg.label}
                    className={leg.color}
                    style={{ width: `${(Math.abs(leg.value) / s.sales) * 100}%` }}
                    title={`${leg.label}: ${money(leg.value)}`}
                  />
                ))}
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {settlementLegs.map((leg) => (
                  <div key={leg.label} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <span className={`w-2.5 h-2.5 rounded-full ${leg.color}`} />
                      <span>{leg.label}</span>
                    </div>
                    <div className={`text-xl font-bold mt-1.5 ${leg.text}`}>{money(leg.value)}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {((leg.value / s.sales) * 100).toFixed(1)}% · {leg.note}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-slate-500 mt-4 font-medium">
                {money(s.collectedMoney)} en dinero + {money(s.vale)} vale blanco + {money(s.credit)} fiado +{" "}
                {money(s.pending)} impago = <span className="font-bold text-slate-800">{money(s.sales)}</span>
              </p>

              {s.unreconciled !== 0 && (
                <div className="mt-4 flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4">
                  <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-rose-900">
                      Descuadre de {money(Math.abs(s.unreconciled))}
                    </p>
                    <p className="text-xs text-rose-800 mt-0.5">
                      Hay estadías cuyo pagado no coincide con sus pagos ni con sus cargos a cuenta
                      corriente. Revisá los cobros del período antes de tomar decisiones con estos números.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tira secundaria */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
        {secondary.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <Icon size={14} /> <span>{c.label}</span>
                <InfoTooltip metric={c.info} />
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1.5">{c.value}</div>
              <div className="mt-1">
                {c.delta ? (
                  <DeltaText delta={c.delta} good={c.good} />
                ) : (
                  <span className="text-xs text-slate-400">{c.hint}</span>
                )}
              </div>
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

      {/* Estado de cuentas + Control */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lo que te deben, hoy */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5">
                Lo que te deben (hoy)
                <InfoTooltip metric="totalToCollect" />
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Foto de hoy, no del período elegido</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900">{money(totalToCollect)}</div>
              <div className="text-xs text-slate-400">total a cobrar</div>
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <CircleDollarSign size={14} /> <span>Reservas activas</span>
                  <InfoTooltip metric="accountsReceivable" />
                </div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(data.accountsReceivable)}</div>
                <div className="text-xs text-slate-400 mt-0.5">Saldo de confirmadas y alojados</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  <HandCoins size={14} /> <span>Cuenta corriente</span>
                  <InfoTooltip metric="currentAccountDebt" />
                </div>
                <div className="text-xl font-bold text-slate-900 mt-1">{money(data.currentAccountDebt)}</div>
                <div className="text-xs text-slate-400 mt-0.5">Fiado acumulado sin cobrar</div>
              </div>
            </div>

            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Principales deudores
            </div>
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

      <div className="text-xs text-slate-500 mt-8 max-w-3xl space-y-2">
        <p className="font-semibold text-slate-600">Tres formas de mirar la misma plata (no tienen por qué dar igual):</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-semibold">Venta cerrada</span>: estadías que terminaron en el período. Es la
            única que cierra exacto contra dinero + vale blanco + fiado + impago.
          </li>
          <li>
            <span className="font-semibold">Caja del período</span>: pagos con fecha dentro del período, aunque
            sean señas de estadías futuras o saldos de estadías viejas.
          </li>
          <li>
            <span className="font-semibold">Ingreso devengado</span>: noches dormidas dentro del período, estén
            cobradas o no. Es la base de ADR, RevPAR y ocupación.
          </li>
        </ul>
        <p>
          Reservas y cancelaciones se cuentan por fecha de alta. Lo que te deben es el estado de hoy, no del
          rango. Pasá el mouse por el ícono <span className="font-semibold">ⓘ</span> de cada métrica para ver
          cómo se calcula.
        </p>
      </div>
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
