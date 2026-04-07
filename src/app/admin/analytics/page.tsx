import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  BarChart3,
  TrendingUp,
  CalendarCheck,
  DollarSign,
  XCircle,
  LogIn,
} from "lucide-react";
import { getAnalyticsData } from "@/lib/data";
import AnalyticsCharts from "./AnalyticsCharts";

export const revalidate = 0;

type AnalyticsPageProps = {
  searchParams: Promise<{ from?: string; to?: string }>;
};

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  // ── Admin guard ──
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/forbidden");

  // ── Date range defaults: last 30 days ──
  const params = await searchParams;
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const toDate = params.to || today.toISOString().split("T")[0];
  const fromDate = params.from || thirtyDaysAgo.toISOString().split("T")[0];

  const data = await getAnalyticsData(fromDate, toDate);

  const kpis = [
    {
      label: "Tasa de Ocupación",
      value: `${data.occupancyRate.toFixed(1)}%`,
      description: "Habitaciones ocupadas ahora vs total activas",
      icon: TrendingUp,
      gradient: "from-emerald-500 to-emerald-600",
      iconBg: "text-emerald-100",
    },
    {
      label: "Ingresos del Período",
      value: `$${data.totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      description: "Total cobrado en el rango seleccionado",
      icon: DollarSign,
      gradient: "from-blue-500 to-blue-600",
      iconBg: "text-blue-100",
    },
    {
      label: "Reservas Totales",
      value: data.totalReservations.toString(),
      description: "Reservas creadas en el período",
      icon: CalendarCheck,
      gradient: "from-indigo-500 to-indigo-600",
      iconBg: "text-indigo-100",
    },
    {
      label: "Ticket Promedio",
      value: `$${data.averageTicket.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      description: "Precio promedio por reserva (excl. canceladas)",
      icon: BarChart3,
      gradient: "from-violet-500 to-violet-600",
      iconBg: "text-violet-100",
    },
    {
      label: "Check-ins",
      value: data.totalCheckIns.toString(),
      description: "Check-ins efectuados en el período",
      icon: LogIn,
      gradient: "from-teal-500 to-teal-600",
      iconBg: "text-teal-100",
    },
    {
      label: "Cancelaciones",
      value: data.totalCancellations.toString(),
      description: "Reservas canceladas en el período",
      icon: XCircle,
      gradient: "from-rose-500 to-rose-600",
      iconBg: "text-rose-100",
    },
  ];

  return (
    <div className="p-8 pb-20 overflow-y-auto w-full">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl shadow-lg shadow-emerald-500/20">
              <BarChart3 size={22} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900">
              Panel de Análisis
            </h1>
          </div>
          <p className="text-slate-500">
            Métricas clave para la toma de decisiones del negocio.
          </p>
        </div>

        <form method="GET" className="flex items-center gap-2 shrink-0 flex-wrap">
          <label
            htmlFor="analytics-from"
            className="text-sm font-semibold text-slate-600 whitespace-nowrap"
          >
            Desde:
          </label>
          <input
            id="analytics-from"
            type="date"
            name="from"
            defaultValue={fromDate}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
          />
          <label
            htmlFor="analytics-to"
            className="text-sm font-semibold text-slate-600 whitespace-nowrap"
          >
            Hasta:
          </label>
          <input
            id="analytics-to"
            type="date"
            name="to"
            defaultValue={toDate}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
          >
            Filtrar
          </button>
          {(params.from || params.to) && (
            <a
              href="/admin/analytics"
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 underline"
            >
              Últimos 30 días
            </a>
          )}
        </form>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={`bg-gradient-to-br ${kpi.gradient} rounded-2xl p-6 shadow-lg relative overflow-hidden text-white flex flex-col justify-between`}
            >
              <div className="absolute top-0 right-0 p-4 opacity-15">
                <Icon size={90} />
              </div>
              <div className="relative z-10">
                <div
                  className={`flex items-center gap-2 ${kpi.iconBg} font-medium mb-1 text-sm`}
                >
                  <Icon size={16} />
                  {kpi.label}
                </div>
                <h2 className="text-3xl font-bold tracking-tight">
                  {kpi.value}
                </h2>
              </div>
              <div className="relative z-10 mt-4 text-sm opacity-80">
                {kpi.description}
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <AnalyticsCharts
        dailyIncome={data.dailyIncome}
        roomTypeOccupancy={data.roomTypeOccupancy}
        paymentMethods={data.paymentMethods}
        statusBreakdown={data.statusBreakdown}
      />
    </div>
  );
}
