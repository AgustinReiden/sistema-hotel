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
 * Presets para facturación: razonan por mes, no por "últimos N días" (a diferencia
 * de buildPresets, pensado para los tableros de ocupación). El preset "Todo" no vive
 * acá: lo agrega el componente que lo use, porque no es un rango de fechas real.
 */
export function buildBillingPresets(todayKey: string): RangePreset[] {
  const [ty, tm] = todayKey.split("-").map(Number);
  const monthStart = `${ty}-${pad(tm)}-01`;
  const prevMonthLast = new Date(Date.UTC(ty, tm - 1, 0));
  const pmY = prevMonthLast.getUTCFullYear();
  const pmM = prevMonthLast.getUTCMonth() + 1;
  const yearStart = `${ty}-01-01`;
  return [
    { label: "Este mes", from: monthStart, to: todayKey },
    {
      label: "Mes anterior",
      from: `${pmY}-${pad(pmM)}-01`,
      to: `${pmY}-${pad(pmM)}-${pad(prevMonthLast.getUTCDate())}`,
    },
    { label: "Últimos 90 días", from: addDaysToDateKey(todayKey, -89), to: todayKey },
    { label: "Este año", from: yearStart, to: todayKey },
  ];
}
