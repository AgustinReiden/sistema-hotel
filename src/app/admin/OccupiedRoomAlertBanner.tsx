"use client";

import { useState } from "react";
import { DoorOpen } from "lucide-react";
import { toast } from "sonner";

import WalkInModal from "./WalkInModal";
import { regularizeOccupiedRoomAction } from "./actions";
import { occupancyCheckInDateKey } from "@/lib/arrivals";
import { formatHotelShortDateTime } from "@/lib/time";
import type { AssignWalkInPayload, AssociatedClient, RoomOccupancyAlert } from "@/lib/types";

type RoomPricing = { roomNumber: string; basePrice: number; halfDayPrice: number };

type Props = {
  alerts: RoomOccupancyAlert[];
  /** Precio y número por id de habitación, para precargar el modal. */
  pricingByRoomId: Record<number, RoomPricing>;
  associatedClients: AssociatedClient[];
  timezone: string;
};

/**
 * Aviso de "la pieza figura ocupada y no hay estadía cargada", en la Home.
 *
 * SIN GATE DE ADMIN, a diferencia del banner de mantenimiento que está al lado. El
 * que puede resolver esto es el que está en el mostrador cuando la mucama avisa, y
 * hasta ahora era justamente el único que no lo veía: la RLS de `admin_alerts` es
 * admin-only y el recepcionista sólo llegaba a un contador anónimo dentro del cierre
 * de caja. La ventana `rpc_list_room_occupancy_alerts` (mig 104) existe para esto.
 */
export default function OccupiedRoomAlertBanner({
  alerts,
  pricingByRoomId,
  associatedClients,
  timezone,
}: Props) {
  const [target, setTarget] = useState<RoomOccupancyAlert | null>(null);

  if (alerts.length === 0) return null;

  const pricing = target?.room_id != null ? pricingByRoomId[target.room_id] : undefined;

  const checkInDateFor = (alert: RoomOccupancyAlert) =>
    occupancyCheckInDateKey(alert.detected_at, timezone);

  const submitRegularization = async (data: AssignWalkInPayload) => {
    if (!target) return { success: false, error: "No hay ningún aviso abierto." };

    const result = await regularizeOccupiedRoomAction({
      alertId: target.alert_id,
      walkIn: {
        ...data,
        // El medio día no admite fecha retroactiva (la base lo rechaza): una siesta
        // de anoche no significa nada, así que ahí se carga como siempre.
        ...(data.stayType === "half_day" ? {} : { checkInDate: checkInDateFor(target) }),
      },
    });

    if (!result.success) return { success: false, error: result.error };

    setTarget(null);
    if (result.data?.alertPendiente) {
      toast.warning(
        "La estadía quedó cargada, pero el aviso no se pudo cerrar. Refrescá la pantalla e intentá de nuevo: no la vuelvas a cargar.",
        { duration: 12000 }
      );
    } else {
      toast.success("Estadía cargada. Cobrala en el check-out como cualquier otra.");
    }
    return { success: true };
  };

  return (
    <>
      <div className="mb-6 bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-sm">
            <DoorOpen size={20} />
          </div>
          <div>
            <p className="font-bold text-rose-900">
              {alerts.length === 1
                ? "Hay 1 habitación usada sin estadía cargada"
                : `Hay ${alerts.length} habitaciones usadas sin estadía cargada`}
            </p>
            <p className="text-sm text-rose-700">
              Limpieza las encontró ocupadas y el sistema no tiene a nadie ahí. Si no se carga,
              esa noche no se cobra.
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.alert_id}
              className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white border border-rose-200 rounded-xl px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800">
                  Habitación {a.room_number ?? "—"}
                </p>
                <p className="text-xs text-slate-500">
                  {a.reported_by_name ? `La marcó ${a.reported_by_name}` : "Marcada por limpieza"}{" "}
                  el {formatHotelShortDateTime(a.detected_at, timezone)} · se cargaría desde el{" "}
                  {checkInDateFor(a).split("-").reverse().join("/")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTarget(a)}
                disabled={a.room_id == null || !pricingByRoomId[a.room_id]}
                title={
                  a.room_id != null && pricingByRoomId[a.room_id]
                    ? undefined
                    : "Esa habitación ya no está activa: avisale al administrador."
                }
                className="shrink-0 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
              >
                Cargar la estadía
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* El mismo modal del walk-in de siempre: persona o empresa, noches o medio día,
          descuentos y libro de pasajeros. Lo único que cambia es desde cuándo se cobra. */}
      <WalkInModal
        key={target?.alert_id ?? "none"}
        isOpen={target !== null}
        onClose={() => setTarget(null)}
        onSubmit={submitRegularization}
        roomNumber={pricing?.roomNumber ?? target?.room_number ?? ""}
        basePrice={pricing?.basePrice ?? 0}
        halfDayPrice={pricing?.halfDayPrice ?? 0}
        associatedClients={associatedClients}
      />
    </>
  );
}
