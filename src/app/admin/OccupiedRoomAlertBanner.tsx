"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CheckCircle2, DoorOpen, XCircle } from "lucide-react";
import { toast } from "sonner";

import WalkInModal from "./WalkInModal";
import {
  closeOccupancyAlertAction,
  handleLoadReservationForEdit,
  regularizeOccupiedRoomAction,
} from "./actions";
import { occupancyCheckInDateKey } from "@/lib/arrivals";
import { formatAmount } from "@/lib/format";
import { formatHotelShortDateTime } from "@/lib/time";
import type { AssignWalkInPayload, AssociatedClient, RoomOccupancyAlert } from "@/lib/types";

type RoomPricing = { roomNumber: string; basePrice: number; halfDayPrice: number };

/** Aviso -> estadía que ya se cargó y quedó sin cerrar. */
type Pendientes = Record<number, string>;

/**
 * Dónde se guarda, en la pestaña, la estadía que falta asociar a cada aviso: un objeto
 * `{ [id del aviso]: id de la estadía }`. sessionStorage y no el estado del componente
 * solo, porque el estado se pierde cuando la pantalla se vuelve a armar de cero: una
 * recarga de Hoy que termina en la pantalla de error (`admin/error.tsx` reemplaza la
 * página y, al volver, la monta de nuevo), un deploy (Next recarga la página entera) o un
 * F5. sessionStorage sobrevive a las tres en la misma pestaña y se borra sola al cerrarla.
 */
const PENDIENTES_KEY = "hotelsync:avisos-ocupada-sin-cerrar";

/**
 * Dónde se guardan, en la pestaña, los avisos cuya estadía ya se cargó pero no sirve para
 * cerrarlos (ya salió o cambió de habitación, ver `ESTADIA_YA_NO_SIRVE_CODE`): una lista de
 * ids de aviso, sin la estadía. Así, al volver a armarse, la fila no vuelve a ofrecer
 * "Cerrar el aviso" (fallaría siempre igual) ni "Cargar la estadía" (la cobraría dos veces).
 */
const SIN_CIERRE_KEY = "hotelsync:avisos-ocupada-cargada-sin-cierre";

/**
 * Dónde se guardan, en la pestaña, los avisos cuya estadía guardada se canceló después de
 * cobrar algo (ver `estadiaCanceladaConCobro`): `{ [id del aviso]: lo cobrado }`. Así, al
 * volver a armarse, la fila sigue avisando cuánto se cobró antes de ofrecer cargarla de nuevo.
 */
const CANCELADA_CON_COBRO_KEY = "hotelsync:avisos-ocupada-cancelada-con-cobro";

/** Quién está mostrando lo guardado, para avisarle cuando cambia. */
const pendientesListeners = new Set<() => void>();

function subscribePendientes(listener: () => void) {
  pendientesListeners.add(listener);
  return () => {
    pendientesListeners.delete(listener);
  };
}

/**
 * Lo guardado con esa clave, tal cual (un texto: React lo compara por valor). null si no hay
 * o no anda.
 */
function leerGuardado(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function leerPendientesGuardados(): string | null {
  return leerGuardado(PENDIENTES_KEY);
}

function leerSinCierreGuardados(): string | null {
  return leerGuardado(SIN_CIERRE_KEY);
}

function leerCanceladasGuardadas(): string | null {
  return leerGuardado(CANCELADA_CON_COBRO_KEY);
}

/**
 * Guarda `value` con esa clave (null la borra) y avisa a quien lo muestra. Si la pestaña no
 * deja guardar, no pasa nada: el estado del componente lo sigue mostrando, como antes, hasta
 * que se vuelva a armar.
 */
function escribirGuardado(key: string, value: string | null) {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    return;
  }
  pendientesListeners.forEach((listener) => listener());
}

/** Lo guardado, ya leído. Lo que no tiene la forma esperada se ignora. */
function parsePendientes(raw: string | null): Pendientes {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
    const pendientes: Pendientes = {};
    for (const [alertId, reservationId] of Object.entries(data)) {
      const id = Number(alertId);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (typeof reservationId !== "string" || reservationId.length === 0) continue;
      pendientes[id] = reservationId;
    }
    return pendientes;
  } catch {
    return {};
  }
}

/** Cambia la estadía guardada para un aviso (null la olvida). */
function guardarPendiente(alertId: number, reservationId: string | null) {
  const pendientes = parsePendientes(leerPendientesGuardados());
  if (reservationId === null) {
    if (!(alertId in pendientes)) return;
    delete pendientes[alertId];
  } else {
    pendientes[alertId] = reservationId;
  }
  escribirGuardado(
    PENDIENTES_KEY,
    Object.keys(pendientes).length === 0 ? null : JSON.stringify(pendientes)
  );
}

/** Los avisos guardados como "cargada, no se cierra desde acá". Lo roto se ignora. */
function parseSinCierre(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((id): id is number => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

/** Marca (o desmarca) un aviso como "cargada, no se cierra desde acá". */
function guardarSinCierre(alertId: number, sinCierre: boolean) {
  const ids = parseSinCierre(leerSinCierreGuardados());
  if (ids.includes(alertId) === sinCierre) return;
  const siguientes = sinCierre ? [...ids, alertId] : ids.filter((id) => id !== alertId);
  escribirGuardado(SIN_CIERRE_KEY, siguientes.length === 0 ? null : JSON.stringify(siguientes));
}

/** Aviso -> lo cobrado en la estadía guardada que se canceló. */
type CanceladasConCobro = Record<number, number>;

/** Los avisos guardados como "se canceló con plata cobrada". Lo roto se ignora. */
function parseCanceladasConCobro(raw: string | null): CanceladasConCobro {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
    const canceladas: CanceladasConCobro = {};
    for (const [alertId, cobrado] of Object.entries(data)) {
      const id = Number(alertId);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (typeof cobrado !== "number" || !Number.isFinite(cobrado) || cobrado <= 0) continue;
      canceladas[id] = cobrado;
    }
    return canceladas;
  } catch {
    return {};
  }
}

/** Guarda lo cobrado en la estadía cancelada de un aviso (null lo olvida). */
function guardarCanceladaConCobro(alertId: number, cobrado: number | null) {
  const canceladas = parseCanceladasConCobro(leerCanceladasGuardadas());
  if (cobrado === null) {
    if (!(alertId in canceladas)) return;
    delete canceladas[alertId];
  } else {
    canceladas[alertId] = cobrado;
  }
  escribirGuardado(
    CANCELADA_CON_COBRO_KEY,
    Object.keys(canceladas).length === 0 ? null : JSON.stringify(canceladas)
  );
}

/**
 * El código con el que la base rechaza el cierre porque la estadía guardada ya no sirve
 * para cerrarlo (`rpc_regularize_occupied_room`, mig 106): no está con el huésped adentro
 * (salió, o se canceló) o es de otra habitación (la cambiaron). Reintentar no lo arregla.
 * El código no dice cuál: salió o cambió de habitación es una estadía cargada, que se
 * cobra; cancelada, no. Lo dice el estado de la estadía (`estadiaCancelada`).
 */
const ESTADIA_YA_NO_SIRVE_CODE = "22023";

/**
 * Lo que se dice cuando la estadía salió o cambió de habitación: por qué no se cierra, que
 * no la vuelvan a cargar y qué hacer. Cerrar el aviso sin estadía pide una nota (mig 105) y
 * hoy ninguna pantalla la pide: lo cierra quien administra el sistema.
 */
const ESTADIA_YA_NO_SIRVE =
  "Esa estadía ya salió o cambió de habitación, así que no sirve para cerrar este aviso. Ya está cargada: no la vuelvas a cargar. Este aviso todavía no se puede cerrar desde el panel: dejalo así, no hace falta que hagas nada más.";

/**
 * Lo que se dice cuando la estadía se canceló (por ejemplo, desde la tarjeta, para
 * corregirla) sin nada cobrado: no sirve para cerrar el aviso, y esa noche no quedó cargada.
 * La fila vuelve a ofrecer "Cargar la estadía", como antes de cargarla.
 */
const ESTADIA_CANCELADA =
  "Esa estadía está cancelada, así que no sirve para cerrar este aviso. Si esa noche hay que cobrarla, cargala de nuevo con «Cargar la estadía».";

/**
 * Lo que se dice cuando la estadía se canceló después de cobrar algo: una seña o un pago a
 * cuenta (la cancelación baja el total a lo pagado) o un check-out con cobro o a cuenta
 * corriente (una cancelada que ya había salido conserva todo, mig 102). Esa plata sigue en
 * los libros: cargar la noche entera de nuevo la cobraría dos veces. No se invita a cargarla:
 * se dice cuánto se cobró y que la revisen antes. "Cargar la estadía" sigue, porque decidir
 * el cobro es del admin (mig 106) y puede faltar cobrar una parte.
 */
function estadiaCanceladaConCobro(cobrado: number): string {
  return `Esa estadía está cancelada, así que no sirve para cerrar este aviso, pero antes de cancelarse se cobraron ${formatAmount(cobrado)} (en caja o a cuenta corriente) y siguen registrados. Antes de volver a cargarla, revisala en Huéspedes, tocando «Ver cancelados» (buscá la de esta habitación): si cargás la noche entera, lo ya cobrado se cobra dos veces.`;
}

/**
 * Lo que se dice si no se pudo ver en qué quedó la estadía: no se afirma que esté cargada
 * ni que no, y la fila sigue ofreciendo "Cerrar el aviso" para volver a intentarlo.
 */
const ESTADIA_SIN_ESTADO =
  "No se pudo cerrar el aviso ni ver en qué quedó esa estadía. Probá de nuevo con «Cerrar el aviso».";

/**
 * ¿La estadía guardada está cancelada, y cuánto se había cobrado (`paid_amount`: pagos más
 * cargos a cuenta corriente, mig 89)? Se pregunta cuando la base rechaza el cierre con
 * `ESTADIA_YA_NO_SIRVE_CODE`. null si no se pudo leer.
 */
async function estadoDeLaEstadia(
  reservationId: string
): Promise<{ cancelada: boolean; cobrado: number } | null> {
  try {
    const result = await handleLoadReservationForEdit(reservationId);
    if (!result.success || !result.data) return null;
    const cobrado = Number(result.data.paid_amount);
    return {
      cancelada: result.data.status === "cancelled",
      cobrado: Number.isFinite(cobrado) && cobrado > 0 ? cobrado : 0,
    };
  } catch {
    return null;
  }
}

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
 * componente y en la pestaña (sessionStorage, `PENDIENTES_KEY`), y NO se busca en la
 * base, a propósito:
 *  - Es la única de la que se SABE que es la de este aviso. Buscar "la que está
 *    adentro en esa pieza desde la noche anterior" es adivinar, y la RPC no ataja
 *    el error: acepta cualquier estadía en curso de esa habitación. Si se adivina
 *    mal, el aviso queda como "se cargó la estadía" sobre un uso que nadie cobró,
 *    que es justo lo que la lista de resueltas existe para no decir.
 *  - El medio día se carga con la fecha de hoy (no admite retroactiva): por fecha
 *    no se encuentra.
 *  - El reintento es en el momento, con el aviso a la vista, y el estado sobrevive
 *    al `revalidatePath` de la acción (Next renueva los props sin desmontar).
 * El estado solo no sobrevive a que la pantalla se vuelva a armar de cero: una recarga
 * de Hoy (cada 30 s) que termina en la pantalla de error, un deploy, un F5 o irse de la
 * Home. Por eso también va a la pestaña (pedido de Agustín del 26/09): al volver, la
 * fila sigue diciendo "Cerrar el aviso" con la misma estadía. Se borra cuando el aviso
 * se cierra, desde acá o porque llega resuelto; no cuando la lista viene vacía (la Home
 * la deja vacía si no pudo leer los avisos). En otra pestaña o en otra PC no está; si
 * igual la vuelven a cargar, no la duplica mientras la primera siga adentro
 * (`reservations_no_active_overlap` rechaza dos estadías en la misma pieza y horario).
 *
 * SI LA ESTADÍA GUARDADA YA SALIÓ O CAMBIÓ DE HABITACIÓN, la base rechaza el cierre
 * (`ESTADIA_YA_NO_SIRVE_CODE`, y el estado de la estadía no es "cancelada") y reintentar no
 * lo arregla. La estadía guardada se descarta
 * (no hay con qué volver a intentarlo: sin eso, cada vez que la pantalla se vuelve a armar
 * la fila ofrecería de nuevo un "Cerrar el aviso" que falla siempre igual) y el aviso queda
 * marcado en la pestaña como "cargada, no se cierra desde acá" (`SIN_CIERRE_KEY`): la fila
 * dice por qué, que no la vuelvan a cargar y qué hacer, y no ofrece ningún botón. Tampoco
 * "Cargar la estadía": ya está cargada, y volver a cargarla la cobraría dos veces. Cerrar el
 * aviso sin cargar la estadía pide una nota (mig 105), y ninguna pantalla la pide todavía:
 * ese camino queda pendiente, fuera de esta pantalla. La marca se olvida cuando el aviso
 * llega resuelto, como la estadía guardada.
 *
 * SI LA ESTADÍA GUARDADA SE CANCELÓ (por ejemplo, desde la tarjeta, para corregirla), la
 * base rechaza el cierre con el mismo código, pero la estadía ya no cuenta como cargada:
 * decir "ya está cargada" sería mentira y podría dejar la pieza sin cobrar. Por eso, ante ese
 * código se lee el estado de la estadía (`handleLoadReservationForEdit`, la acción que ya usa
 * "Editar"): cancelada, se descarta y la fila vuelve a ofrecer "Cargar la estadía"; si no se
 * pudo leer, no se afirma nada y queda guardada para reintentar. Una cancelada puede haber
 * cobrado algo antes (una seña, un pago a cuenta, un check-out con cobro o a cuenta
 * corriente), y esa plata queda en los libros: si `paid_amount` es mayor que cero, la fila
 * dice cuánto se cobró y que la revisen antes de volver a cargarla
 * (`estadiaCanceladaConCobro`, guardado en la pestaña con `CANCELADA_CON_COBRO_KEY`), en vez
 * de invitar a cargarla. Se olvida cuando se vuelve a cargar la estadía o el aviso llega
 * resuelto.
 *
 * Se eligió guardar y no frenar la recarga de Hoy mientras haya uno sin cerrar: frenarla
 * dejaría Hoy sin ponerse al día (y sin la línea que lo avisa) todo el tiempo que el
 * cierre siga fallando, y no cubre un deploy, un F5 ni irse de la Home.
 */
export default function OccupiedRoomAlertBanner({
  alerts,
  pricingByRoomId,
  associatedClients,
  timezone,
  isAdmin,
}: Props) {
  const [target, setTarget] = useState<RoomOccupancyAlert | null>(null);
  // Aviso -> estadía que ya se cargó y quedó sin cerrar. Ver el comentario de arriba. Lo
  // de la pestaña (en el servidor no hay: la fila se pinta sin eso y se completa al
  // hidratar) más lo de esta pantalla, que alcanza si la pestaña no deja guardar.
  const guardados = useSyncExternalStore(
    subscribePendientes,
    leerPendientesGuardados,
    () => null
  );
  const [enPantalla, setEnPantalla] = useState<Pendientes>({});
  const pendientes = useMemo(
    () => ({ ...parsePendientes(guardados), ...enPantalla }),
    [guardados, enPantalla]
  );
  const [closingId, setClosingId] = useState<number | null>(null);
  // Avisos cuya estadía ya se cargó pero no sirve para cerrarlos (ver arriba): sin botón.
  // Lo de la pestaña más lo de esta pantalla, como la estadía guardada.
  const sinCierreGuardados = useSyncExternalStore(
    subscribePendientes,
    leerSinCierreGuardados,
    () => null
  );
  const [sinCierreEnPantalla, setSinCierreEnPantalla] = useState<number[]>([]);
  const sinCierre = useMemo(
    () => new Set([...parseSinCierre(sinCierreGuardados), ...sinCierreEnPantalla]),
    [sinCierreGuardados, sinCierreEnPantalla]
  );
  // Avisos cuya estadía guardada se canceló con plata cobrada (ver arriba): la fila dice
  // cuánto. Lo de la pestaña más lo de esta pantalla, como la estadía guardada.
  const canceladasGuardadas = useSyncExternalStore(
    subscribePendientes,
    leerCanceladasGuardadas,
    () => null
  );
  const [canceladasEnPantalla, setCanceladasEnPantalla] = useState<CanceladasConCobro>({});
  const canceladasConCobro = useMemo(
    () => ({ ...parseCanceladasConCobro(canceladasGuardadas), ...canceladasEnPantalla }),
    [canceladasGuardadas, canceladasEnPantalla]
  );

  const abiertas = useMemo(() => alerts.filter((a) => a.resolved_at === null), [alerts]);
  const cerradas = useMemo(() => alerts.filter((a) => a.resolved_at !== null), [alerts]);

  // Un aviso que llega resuelto (lo cerró otro admin, o el cierre de acá se hizo pero la
  // respuesta no llegó) ya no tiene nada que asociar: se olvida de la pestaña.
  useEffect(() => {
    for (const a of cerradas) {
      guardarPendiente(a.alert_id, null);
      guardarSinCierre(a.alert_id, false);
      guardarCanceladaConCobro(a.alert_id, null);
    }
  }, [cerradas]);

  if (alerts.length === 0) return null;

  const pricing = target?.room_id != null ? pricingByRoomId[target.room_id] : undefined;

  const checkInDateFor = (alert: RoomOccupancyAlert) =>
    occupancyCheckInDateKey(alert.detected_at, timezone);

  // Lo cobrado en la estadía cancelada de ese aviso, en pantalla y en la pestaña (null lo
  // olvida).
  const marcarCanceladaConCobro = (alertId: number, cobrado: number | null) => {
    setCanceladasEnPantalla((prev) => {
      if (cobrado !== null) return { ...prev, [alertId]: cobrado };
      if (!(alertId in prev)) return prev;
      const next = { ...prev };
      delete next[alertId];
      return next;
    });
    guardarCanceladaConCobro(alertId, cobrado);
  };

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
    // Ya se decidió cómo cargarla: el aviso de lo cobrado en la cancelada deja de hacer falta.
    marcarCanceladaConCobro(alertId, null);
    if (result.data?.alertPendiente) {
      const { reservationId } = result.data;
      setEnPantalla((prev) => ({ ...prev, [alertId]: reservationId }));
      guardarPendiente(alertId, reservationId);
      toast.warning(
        "La estadía quedó cargada, pero el aviso no se pudo cerrar. Tocá «Cerrar el aviso» para intentar de nuevo: no la vuelvas a cargar.",
        { duration: 12000 }
      );
    } else {
      toast.success("Estadía cargada. Cobrala en el check-out como cualquier otra.");
    }
    return { success: true };
  };

  // La estadía que faltaba asociar a ese aviso deja de estar, en pantalla y en la pestaña.
  const olvidarPendiente = (alertId: number) => {
    setEnPantalla((prev) => {
      const next = { ...prev };
      delete next[alertId];
      return next;
    });
    guardarPendiente(alertId, null);
  };

  const closeAlert = async (alertId: number, reservationId: string) => {
    setClosingId(alertId);
    try {
      const result = await closeOccupancyAlertAction(alertId, reservationId);
      if (!result.success) {
        if (result.code === ESTADIA_YA_NO_SIRVE_CODE) {
          const estado = await estadoDeLaEstadia(reservationId);
          if (estado === null) {
            // Sin saber si salió o se canceló no se afirma nada: queda guardada y el botón
            // sigue para volver a intentarlo.
            toast.error(ESTADIA_SIN_ESTADO);
            return;
          }
          // Sale del bucle: la estadía guardada ya no sirve para cerrarlo, se descarta.
          olvidarPendiente(alertId);
          if (estado.cancelada) {
            // Ya no cuenta como cargada: la fila vuelve a ofrecer "Cargar la estadía". Si se
            // había cobrado algo, antes dice cuánto (esa plata quedó en los libros).
            if (estado.cobrado > 0) {
              marcarCanceladaConCobro(alertId, estado.cobrado);
              toast.error(estadiaCanceladaConCobro(estado.cobrado), { duration: 12000 });
            } else {
              marcarCanceladaConCobro(alertId, null);
              toast.error(ESTADIA_CANCELADA, { duration: 12000 });
            }
            return;
          }
          // Salió o cambió de habitación: el aviso queda como "cargada, no se cierra desde
          // acá" (ni reintentar ni volver a cargarla).
          setSinCierreEnPantalla((prev) => (prev.includes(alertId) ? prev : [...prev, alertId]));
          guardarSinCierre(alertId, true);
          toast.error(ESTADIA_YA_NO_SIRVE, { duration: 12000 });
          return;
        }
        toast.error(result.error);
        return;
      }
      olvidarPendiente(alertId);
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
              // Cargada pero sin estadía que sirva para cerrarlo: ni reintentar ni volver a cargar.
              const noSeCierraDesdeAca = isAdmin && sinCierre.has(a.alert_id);
              const pendiente =
                isAdmin && !noSeCierraDesdeAca ? pendientes[a.alert_id] : undefined;
              // La estadía guardada se canceló después de cobrar algo: antes de ofrecer
              // cargarla de nuevo, la fila dice cuánto se cobró.
              const cobradoEnCancelada =
                isAdmin && !noSeCierraDesdeAca && !pendiente
                  ? canceladasConCobro[a.alert_id]
                  : undefined;
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
                      {isAdmin && !pendiente && !noSeCierraDesdeAca && (
                        <> · se cargaría desde el {checkInDateFor(a).split("-").reverse().join("/")}</>
                      )}
                    </p>
                    {(pendiente || noSeCierraDesdeAca) && (
                      <p className="text-xs font-bold text-amber-700 mt-0.5">
                        {noSeCierraDesdeAca
                          ? ESTADIA_YA_NO_SIRVE
                          : "La estadía ya está cargada; falta cerrar el aviso. No la vuelvas a cargar."}
                      </p>
                    )}
                    {cobradoEnCancelada !== undefined && (
                      <p className="text-xs font-bold text-amber-700 mt-0.5">
                        {estadiaCanceladaConCobro(cobradoEnCancelada)}
                      </p>
                    )}
                  </div>
                  {noSeCierraDesdeAca ? (
                    <span className="shrink-0 text-xs font-bold text-amber-800 bg-amber-100 rounded-lg px-3 py-1.5">
                      Ya está cargada
                    </span>
                  ) : pendiente ? (
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
