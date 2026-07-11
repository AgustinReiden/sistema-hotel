import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BedDouble } from "lucide-react";
import { getHotelSettings, getRoomBreakdownData } from "@/lib/data";
import { hotelDateKey } from "@/lib/time";
import DashboardNav from "../DashboardNav";
import { buildPresets, formatKey, resolveRange } from "../shared";
import RoomBreakdownClient from "./RoomBreakdownClient";

export const revalidate = 0;

type PageProps = { searchParams: Promise<{ from?: string; to?: string }> };

export default async function RoomsDashboardPage({ searchParams }: PageProps) {
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

  const data = await getRoomBreakdownData(fromKey, toKey);

  return (
    <div className="p-8 pb-20 overflow-y-auto w-full">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20">
            <BedDouble size={22} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Rendimiento por habitación</h1>
        </div>
        <p className="text-slate-500">
          {formatKey(data.range.from)} – {formatKey(data.range.to)} ({data.range.days} días) ·{" "}
          <span className="text-slate-400">{data.activeRooms} habitaciones activas</span>
        </p>
      </div>

      <DashboardNav activeTab="rooms" fromKey={fromKey} toKey={toKey} presets={presets} />

      {data.rooms.length === 0 ? (
        <p className="text-sm text-slate-400 py-12 text-center">No hay habitaciones activas.</p>
      ) : (
        <RoomBreakdownClient rows={data.rooms} totals={data.totals} currency={data.currency} />
      )}

      <p className="text-xs text-slate-400 mt-8 max-w-3xl">
        Cada habitación tiene una noche disponible por día del período, esté ocupada o no. El ingreso de
        alojamiento es devengado (neto de descuento, sin extras) y se prorratea por noche; ADR y RevPAR usan
        las fechas sobre las que se cotizó la tarifa. Las cancelaciones se cuentan por fecha de alta.
      </p>
    </div>
  );
}
