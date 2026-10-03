// Los avisos del admin (tabla `admin_alerts`, RLS solo admin) que muestra la campana.
// Sin "server-only": lo usan la campana (cliente) y sus tests.

/** Los kinds que hoy genera la base, con el rótulo que ve el dueño. */
export const ALERT_KIND_LABEL: Record<string, string> = {
  // mig 69: recepción pide mantener la tarifa vieja al cambiar de habitación.
  room_change_keep_old_tariff_request: "Tarifa para autorizar",
  // migs 46/67/68: la mucama marcó "estaba ocupada" en una pieza sin estadía.
  room_occupied_without_active_reservation: "Habitación usada sin estadía",
  // mig 78: lo cobrado supera el total de la estadía.
  reservation_overpayment: "Pago de más",
  // mig 71: se cerró la caja con una salida vencida.
  shift_close_overdue_reservation: "Salida vencida al cerrar la caja",
  // mig 44: limpieza registrada sin estadía la noche anterior (kind viejo).
  cleaning_without_active_reservation: "Limpieza sin estadía",
};

/** Para un kind que la campana no conoce: se muestra igual, con su mensaje. */
export const ALERT_KIND_GENERIC_LABEL = "Aviso";

export function alertKindLabel(kind: string): string {
  return ALERT_KIND_LABEL[kind] ?? ALERT_KIND_GENERIC_LABEL;
}

export type AlertActionKind = "tarifa" | "ocupada" | "leida";

/**
 * Qué botones lleva el aviso:
 *  - tarifa: "Autorizar tarifa anterior" y "Rechazar" (rpc_authorize/reject_old_tariff).
 *  - ocupada: "Regularizar en Hoy" o "Cerrar sin cargar" con nota obligatoria: la base
 *    no deja cerrarlo sin explicar por qué (mig 105), así que "Marcar leída" fallaba.
 *  - leida: el resto, incluido un kind desconocido.
 */
export function alertActionKind(kind: string): AlertActionKind {
  if (kind === "room_change_keep_old_tariff_request") return "tarifa";
  if (kind === "room_occupied_without_active_reservation") return "ocupada";
  return "leida";
}

/** `rpc_list_admin_alerts` trae como mucho 100 (LIMIT 100): de ahí para arriba, "99+". */
export function formatAlertsCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** Lo dispara "Ver avisos" (Hoy) para abrir la campana desde cualquier parte. */
export const OPEN_ALERTS_EVENT = "admin:abrir-avisos";
