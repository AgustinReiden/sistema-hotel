"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, DoorOpen, XCircle } from "lucide-react";
import { toast } from "sonner";

import WalkInModal from "./WalkInModal";
import { closeOccupancyAlertAction, regularizeOccupiedRoomAction } from "./actions";
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
  /** Decidir si la pieza se cobra es del admin; ver el aviso, de todo el staff. */
  isAdmin: boolean;
};

/**
 * Aviso de "la pieza figura ocupada y no hay estadía cargada", en la Home.
 *
 * QUIÉN VE Y QUIÉN DECIDE, que no es lo mismo. Lo ve todo el staff, sin gate: el
 * que está en el mostrador cuando la mucama avisa es el recepcionista, y hasta
 * ahora era justamente el único que no lo veía, porque la RLS de `admin_alerts` es
 * admin-only. La ventana `rpc_list_room_occupancy_alerts` existe para eso.
 *
 * Pero la decisión de cobrar es del admin (mig 106). Cargar la estadía significa
 * elegir a nombre de quién, por cuántas noches y a qué tarifa, sobre un uso que ya
 * pasó y del que nadie sabe quién fue. Eso no se resuelve en el mostrador. Al
 * recepcionista le queda ver el aviso y ver en qué terminó, que es lo que necesita
 * para saber si esa pieza se cobró.
 *
 * Si el pasajero TODAVÍA está en la habitación, nada de esto hace falta: se carga
 * el walk-in de siempre desde la tarjeta de la pieza.
 *
 * SI LA ESTADÍA ENTRÓ Y EL AVISO NO SE CERRÓ (`alertPendiente`), la fila cambia
 * "Cargar la estadía" por "Cerrar el aviso", que reintenta SOLO el cierre contra la
 * reserva que devolvió la carga. Esa reserva se guarda en el estado de este
 * componente y NO se busca en la base, a propósito:
 *  - Es la única de la que se SABE que es la de este aviso. Buscar "la que está
 *    adentro en esa pieza desde la noche anterior" es adivinar, y la RPC no ataja
 *    el error: acepta cualquier estadía en curso de esa habitación. Si se adivina
 *    mal, el aviso queda como "se cargó la estadía" sobre un uso que nadie cobró,
 *    que es justo lo que la lista de resueltas existe para no decir.
 *  - El medio día se carga con la fecha de hoy (no admite retroactiva): por fecha
 *    no se encuentra.
 *  - El reintento es en el momento, con el aviso a la vista, y el estado sobrevive
 *    al `revalidatePath` de la acción (Next renueva los props sin desmontar).
 * Lo que no sobrevive es un F5 o irse de la Home, y por eso el toast ya no dice
 * "refrescá". Si igual pasa, volver a cargarla no la duplica mientras la primera
 * siga adentro (`reservations_no_active_overlap` rechaza dos estadías en la misma
 * pieza y horario), y el aviso se cierra desde Mantenimiento con una nota.
 */
export default function OccupiedRoomAlertBanner({
  alerts,
  pricingByRoomId,
  associatedClients,
  timezone,
  isAdmin,
}: Props) {
  const [target, setTarget] = useState<RoomOccupancyAlert | null>(null);
  // Aviso -> estadía que ya se cargó y quedó sin cerrar. Ver el comentario de arriba.
  const [pendientes, setPendientes] = useState<Record<number, string>>({});
  const [closingId, setClosingId] = useState<number | null>(null);

  const abiertas = useMemo(() => alerts.filter((a) => a.resolved_at === null), [alerts]);
  const cerradas = useMemo(() => alerts.filter((a) => a.resolved_at !== null), [alerts]);

  if (alerts.length === 0) return null;

  const pricing = target?.room_id != null ? pricingByRoomId[target.room_id] : undefined;

  const checkInDateFor = (alert: RoomOccupancyAlert) =>
    occupancyCheckInDateKey(alert.detected_at, timezone);

  const submitRegularization = async (data: AssignWalkInPayload) => {
    if (!target) return { success: false, error: "No hay ningún aviso abierto." };
    const alertId = target.alert_id;

    const result = await regularizeOccupiedRoomAction({
      alertId,
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
      const { reservationId } = result.data;
      setPendientes((prev) => ({ ...prev, [alertId]: reservationId }));
      toast.warning(
        "La estadía quedó cargada, pero el aviso no se pudo cerrar. Tocá «Cerrar el aviso» para intentar de nuevo: no la vuelvas a cargar.",
        { duration: 12000 }
      );
    } else {
      toast.success("Estadía cargada. Cobrala en el check-out como cualquier otra.");
    }
    return { success: true };
  };

  const closeAlert = async (alertId: number, reservationId: string) => {
    setClosingId(alertId);
    try {
      const result = await closeOccupancyAlertAction(alertId, reservationId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setPendientes((prev) => {
        const next = { ...prev };
        delete next[alertId];
        return next;
      });
      toast.success("Aviso cerrado. La estadía ya estaba cargada: cobrala en el check-out.");
    } catch {
      toast.error("No se pudo cerrar el aviso. La estadía sigue cargada: probá de nuevo.");
    } finally {
      setClosingId(null);
    }
  };

  return (
    <>
      {abiertas.length > 0 && (
        <div className="mb-6 bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <DoorOpen size={20} />
            </div>
            <div>
              <p className="font-bold text-rose-900">
                {abiertas.length === 1
                  ? "Hay 1 habitación usada sin estadía cargada"
                  : `Hay ${abiertas.length} habitaciones usadas sin estadía cargada`}
              </p>
              <p className="text-sm text-rose-700">
                {isAdmin
                  ? "Limpieza las encontró ocupadas y el sistema no tiene a nadie ahí. Si no se carga, esa noche no se cobra."
                  : "Limpieza las encontró ocupadas y el sistema no tiene a nadie ahí. Lo resuelve el administrador; acá vas a ver en qué termina."}
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {abiertas.map((a) => {
              const pendiente = isAdmin ? pendientes[a.alert_id] : undefined;
              return (
                <li
                  key={a.alert_id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white border border-rose-200 rounded-xl px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800">
                      Habitación {a.room_number ?? "—"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.reported_by_name
                        ? `La marcó ${a.reported_by_name}`
                        : "Marcada por limpieza"}{" "}
                      el {formatHotelShortDateTime(a.detected_at, timezone)}
                      {isAdmin && !pendiente && (
                        <> · se cargaría desde el {checkInDateFor(a).split("-").reverse().join("/")}</>
                      )}
                    </p>
                    {pendiente && (
                      <p className="text-xs font-bold text-amber-700 mt-0.5">
                        La estadía ya está cargada; falta cerrar el aviso. No la vuelvas a cargar.
                      </p>
                    )}
                  </div>
                  {pendiente ? (
                    <button
                      type="button"
                      onClick={() => closeAlert(a.alert_id, pendiente)}
                      disabled={closingId !== null}
                      className="shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
                    >
                      {closingId === a.alert_id ? "Cerrando…" : "Cerrar el aviso"}
                    </button>
                  ) : isAdmin ? (
                    <button
                      type="button"
                      onClick={() => setTarget(a)}
                      disabled={a.room_id == null || !pricingByRoomId[a.room_id]}
                      title={
                        a.room_id != null && pricingByRoomId[a.room_id]
                          ? undefined
                          : "Esa habitación ya no está activa."
                      }
                      className="shrink-0 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm transition-colors"
                    >
                      Cargar la estadía
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs font-bold text-rose-700 bg-rose-100 rounded-lg px-3 py-1.5">
                      Lo resuelve el administrador
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* En qué terminaron las de los últimos dos días. Sin esto el aviso
          desaparecía sin decir nada y nadie se enteraba de si esa pieza se cobró. */}
      {cerradas.length > 0 && (
        <div className="mb-6 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
            Habitaciones usadas sin estadía · resueltas hace poco
          </p>
          <ul className="space-y-1.5">
            {cerradas.map((a) => {
              const cobrada = a.decision === "regularizada";
              return (
                <li key={a.alert_id} className="flex items-start gap-2 text-sm">
                  {cobrada ? (
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle size={16} className="text-slate-400 shrink-0 mt-0.5" />
                  )}
                  <span className="text-slate-700">
                    <strong>Hab. {a.room_number ?? "—"}</strong>:{" "}
                    {cobrada ? "se cargó la estadía" : "se cerró sin cobrar"}
                    {a.resolved_by_name && <> · {a.resolved_by_name}</>}
                    {a.resolved_notes && (
                      <span className="text-slate-500"> — «{a.resolved_notes}»</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
