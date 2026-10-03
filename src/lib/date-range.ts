// Helpers de rango/presets de fecha compartidos por los tableros y por facturación.
// Módulo plano (sin "use client" ni "server-only"): pura aritmética de claves de día.

import { addDaysToDateKey } from "@/lib/time";

export const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-07-10" → "10/07/2026" */
export function formatKey(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/** Resuelve el rango desde el querystring; default = últimos 30 días. Ordena si viene invertido. */
export function resolveRange(
  params: { from?: string; to?: string },
  todayKey: string
): { fromKey: string; toKey: string } {
  let fromKey = params.from && DATE_KEY.test(params.from) ? params.from : addDaysToDateKey(todayKey, -29);
  let toKey = params.to && DATE_KEY.test(params.to) ? params.to : todayKey;
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
  return { fromKey, toKey };
}

export type CleaningRange = {
  /** Límites en claves de día del hotel; null cuando se pide todo el historial. */
  fromKey: string | null;
  toKey: string | null;
  isAll: boolean;
  /** true cuando no vino nada en la URL y rige el mes en curso. */
  isDefault: boolean;
  /** Rótulo para mostrar el período: lo que ve el dueño al lado de los números. */
  label: string;
};

/**
 * Período de la pantalla de Limpiezas. Sin parámetros: del 1° del mes a hoy. `todo=1`:
 * todo el historial (el rótulo lo dice, para que nadie lea un acumulado como si fuera
 * del mes). Con desde/hasta válidos: ese rango. Si solo viene una punta, la otra sale
 * de hoy (desde) o del 1° del mes de la fecha (hasta). Fechas inválidas = mes en curso.
 */
export function resolveCleaningRange(
  params: { from?: string; to?: string; todo?: string },
  todayKey: string
): CleaningRange {
  if (params.todo === "1") {
    return { fromKey: null, toKey: null, isAll: true, isDefault: false, label: "Todo el historial" };
  }
  const validFrom = params.from && isRealDateKey(params.from) ? params.from : null;
  const validTo = params.to && isRealDateKey(params.to) ? params.to : null;
  const monthStartOf = (key: string) => `${key.slice(0, 7)}-01`;

  if (!validFrom && !validTo) {
    const fromKey = monthStartOf(todayKey);
    return {
      fromKey,
      toKey: todayKey,
      isAll: false,
      isDefault: true,
      label: `Mes en curso: ${formatKey(fromKey)} al ${formatKey(todayKey)}`,
    };
  }

  let fromKey = validFrom ?? monthStartOf(validTo as string);
  let toKey = validTo ?? (validFrom && validFrom > todayKey ? validFrom : todayKey);
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
  return {
    fromKey,
    toKey,
    isAll: false,
    isDefault: false,
    label: `Del ${formatKey(fromKey)} al ${formatKey(toKey)}`,
  };
}

/** "2026-09-31" cumple el formato pero no existe: se descarta. */
function isRealDateKey(key: string): boolean {
  if (!DATE_KEY.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export type RangePreset = { label: string; from: string; to: string };

/** Presets de rango relativos a hoy (en zona del hotel). */
export function buildPresets(todayKey: string): RangePreset[] {
  const [ty, tm] = todayKey.split("-").map(Number);
  const monthStart = `${ty}-${pad(tm)}-01`;
  const prevMonthLast = new Date(Date.UTC(ty, tm - 1, 0));
  const pmY = prevMonthLast.getUTCFullYear();
  const pmM = prevMonthLast.getUTCMonth() + 1;
  return [
    { label: "Hoy", from: todayKey, to: todayKey },
    { label: "7 días", from: addDaysToDateKey(todayKey, -6), to: todayKey },
    { label: "30 días", from: addDaysToDateKey(todayKey, -29), to: todayKey },
    { label: "Mes actual", from: monthStart, to: todayKey },
    {
      label: "Mes anterior",
      from: `${pmY}-${pad(pmM)}-01`,
      to: `${pmY}-${pad(pmM)}-${pad(prevMonthLast.getUTCDate())}`,
    },
  ];
}

/**
 * Ancla de "desde siempre" para facturación. Es una fecha y no un `null` porque
 * `rpc_list_billing_control` exige rango (22023 si le llega NULL). Anterior a
 * cualquier dato cargado en este sistema, así que en la práctica no recorta nada.
 */
export const BILLING_EPOCH = "2020-01-01";

const BILLING_LAST_10_DAYS_LABEL = "Últimos 10 días";

/**
 * Adónde lleva un marcador viejo a "Sin facturar" (`/admin/fiscal?view=sin_facturar`):
 * a Por facturar con el atajo "Últimos 10 días" elegido y solo lo pendiente (lo que
 * falta más lo que espera la consolidada, que es lo que cuenta el número rojo del menú).
 */
export function sinFacturarRedirectHref(todayKey: string): string {
  const params = new URLSearchParams({
    desde: addDaysToDateKey(todayKey, -9),
    hasta: todayKey,
    estado: "pendiente",
  });
  return `/admin/fiscal/control?${params.toString()}`;
}

/**
 * Presets para facturación: razonan por mes, no por "últimos N días" (a diferencia
 * de buildPresets, pensado para los tableros de ocupación).
 *
 * "Desde siempre" existe porque el default de la pantalla es el mes en curso: sin
 * este preset, una estadía sin facturar de hace cuatro meses no aparecía en ningún
 * lado y había que tipear la fecha a mano sabiendo que estaba.
 */
export function buildBillingPresets(todayKey: string): RangePreset[] {
  const [ty, tm] = todayKey.split("-").map(Number);
  const monthStart = `${ty}-${pad(tm)}-01`;
  const prevMonthLast = new Date(Date.UTC(ty, tm - 1, 0));
  const pmY = prevMonthLast.getUTCFullYear();
  const pmM = prevMonthLast.getUTCMonth() + 1;
  const yearStart = `${ty}-01-01`;
  return [
    // Hoy y los 9 días anteriores, días del hotel: es lo que usaba el dueño en la solapa
    // "Sin facturar" de /admin/fiscal, que ya no existe.
    { label: BILLING_LAST_10_DAYS_LABEL, from: addDaysToDateKey(todayKey, -9), to: todayKey },
    { label: "Este mes", from: monthStart, to: todayKey },
    {
      label: "Mes anterior",
      from: `${pmY}-${pad(pmM)}-01`,
      to: `${pmY}-${pad(pmM)}-${pad(prevMonthLast.getUTCDate())}`,
    },
    { label: "Últimos 90 días", from: addDaysToDateKey(todayKey, -89), to: todayKey },
    { label: "Este año", from: yearStart, to: todayKey },
    { label: "Desde siempre", from: BILLING_EPOCH, to: todayKey },
  ];
}
