// Lógica pura de agregación para el Tablero Gerencial (BI). Sin `server-only` ni
// Supabase: solo aritmética sobre filas ya traídas, para poder testearla con Vitest.
//
// Reglas hoteleras que fija este módulo:
//  - La NOCHE pertenece a su día de inicio; el día de check-out NO es una noche.
//    Nº de noches de una estadía = díasEntre(inicio, salida). Intervalo = [inicio, salida).
//  - Ingreso de ALOJAMIENTO neto (sin extras) = base_total_price − discount_amount
//    (ver src/lib/pricing.ts: extras = total_price − (base − descuento)).
//  - ADR / RevPAR usan la tarifa `priced` (fechas target, sobre las que se cotizó).
//    La ocupación diaria del gráfico usa la ocupación `physical` (fechas reales).
//  - Todo lo temporal se resuelve en la zona del hotel con los helpers de ./time,
//    nunca en UTC del navegador/servidor (evita el bug de "pago de las 23:00").

import type { ReservationStatus } from "./types";
import { hotelDateKey } from "./time";
import { localToISO } from "./format";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ───────────────────────────── Claves de día "YYYY-MM-DD" ─────────────────────────────
// La aritmética se hace en espacio de medianoche UTC sobre claves YA normalizadas
// (mismo truco que countHotelNights): es inmune a la zona horaria y al DST.

function keyToUtcMs(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Suma (o resta) días a una clave "YYYY-MM-DD" y devuelve otra clave. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Días calendario entre dos claves (endKey − startKey). Negativo si end < start. */
export function daysBetweenKeys(startKey: string, endKey: string): number {
  return Math.round((keyToUtcMs(endKey) - keyToUtcMs(startKey)) / 86_400_000);
}

/** Cantidad de días del rango, ambos extremos incluidos. */
export function countDaysInclusive(startKey: string, endKey: string): number {
  return daysBetweenKeys(startKey, endKey) + 1;
}

/** Todas las claves de día del rango [start, end] (inclusive), para rellenar series. */
export function eachHotelDayKey(startKey: string, endKey: string): string[] {
  const days: string[] = [];
  let cur = startKey;
  while (cur <= endKey) {
    days.push(cur);
    cur = addDaysToDateKey(cur, 1);
  }
  return days;
}

// Las claves "YYYY-MM-DD" ordenan lexicográficamente igual que cronológicamente.
const maxKey = (a: string, b: string) => (a >= b ? a : b);
const minKey = (a: string, b: string) => (a <= b ? a : b);

// ───────────────────────────── Rango del hotel → UTC ─────────────────────────────

/**
 * Límites UTC [inicio, finExclusivo) de un rango de días locales del hotel.
 * finExclusivo = medianoche del día SIGUIENTE a endKey, para incluir todo endKey.
 * Reemplaza el bucketing/límites en UTC del getAnalyticsData viejo.
 */
export function hotelRangeToUtc(
  startKey: string,
  endKey: string,
  tz: string
): { startUtc: string; endUtcExclusive: string } {
  return {
    startUtc: localToISO(startKey, "00:00", tz),
    endUtcExclusive: localToISO(addDaysToDateKey(endKey, 1), "00:00", tz),
  };
}

/** Rango previo contiguo de igual longitud, terminando el día anterior a startKey. */
export function previousPeriodRange(
  startKey: string,
  endKey: string
): { start: string; end: string } {
  const days = countDaysInclusive(startKey, endKey);
  const prevEnd = addDaysToDateKey(startKey, -1);
  const prevStart = addDaysToDateKey(prevEnd, -(days - 1));
  return { start: prevStart, end: prevEnd };
}

// ───────────────────────────── Room-nights y ocupación ─────────────────────────────

/** Reserva con lo mínimo para calcular noches/ingreso de alojamiento. */
export type NightlyReservation = {
  status: ReservationStatus;
  checkInTarget: string;
  checkOutTarget: string;
  actualCheckIn: string | null;
  actualCheckOut: string | null;
  baseTotalPrice: number;
  discountAmount: number;
  roomId: number;
  roomType: string;
  createdAt: string;
  /** Cantidad de pasajeros de la reserva (reservations.guest_count, mínimo 1). */
  guestCount: number;
};

/** Reserva para el cohorte "creadas en el período" (pickup / cancelaciones). */
export type CreatedReservation = { status: ReservationStatus; createdAt: string };

/** Un pago para bucketing por día / por método. */
export type PaymentPoint = { amount: number; method: string; createdAt: string };

/**
 * Métodos de `payments` que NO son plata que entra:
 *  - vale_blanco: consumo interno del hotel.
 *  - cuenta_corriente: fiado. El check-out a cta cte no genera pago, así que una
 *    fila así es un cobro mal cargado; contarla como caja infla los ingresos y
 *    esconde la deuda. Se la trata como fiado hasta que se corrija el dato.
 */
export const NON_CASH_METHODS = new Set(["vale_blanco", "cuenta_corriente"]);

export type OccupancyBasis = "physical" | "priced";

/**
 * Intervalo de ocupación [inicio, salida) como claves de día del hotel.
 *  - physical: fechas reales (actual_*), con fallback a target si aún no ocurrieron.
 *  - priced:   fechas target (sobre las que se cotizó la tarifa).
 */
export function occupancyInterval(
  r: NightlyReservation,
  basis: OccupancyBasis,
  tz: string
): { startKey: string; endKey: string } {
  const start =
    basis === "physical" ? r.actualCheckIn ?? r.checkInTarget : r.checkInTarget;
  const end =
    basis === "physical" ? r.actualCheckOut ?? r.checkOutTarget : r.checkOutTarget;
  return { startKey: hotelDateKey(start, tz), endKey: hotelDateKey(end, tz) };
}

/**
 * Noches de una estadía que caen dentro del rango [rangeStart, rangeEnd] (inclusive),
 * con clamp a los bordes. Las canceladas y las de 0 noches devuelven 0.
 */
export function reservationRoomNightsInRange(
  r: NightlyReservation,
  rangeStartKey: string,
  rangeEndKey: string,
  basis: OccupancyBasis,
  tz: string
): number {
  if (r.status === "cancelled") return 0;
  const { startKey, endKey } = occupancyInterval(r, basis, tz);
  if (daysBetweenKeys(startKey, endKey) <= 0) return 0; // same-day / media estadía
  // Ocupación es [startKey, endKey); el rango como noches es [rangeStart, rangeEnd+1).
  const overlapStart = maxKey(startKey, rangeStartKey);
  const overlapEnd = minKey(endKey, addDaysToDateKey(rangeEndKey, 1));
  return Math.max(0, daysBetweenKeys(overlapStart, overlapEnd));
}

/** Tarifa de alojamiento por noche (neta de descuento, sin extras). */
export function perNightLodging(
  baseTotalPrice: number,
  discountAmount: number,
  pricedNights: number
): number {
  return (baseTotalPrice - discountAmount) / Math.max(1, pricedNights);
}

export function computeOccupancyRate(sold: number, available: number): number {
  return available > 0 ? (sold / available) * 100 : 0;
}

export function computeAdr(lodgingRevenue: number, roomNightsSold: number): number {
  return roomNightsSold > 0 ? lodgingRevenue / roomNightsSold : 0;
}

export function computeRevpar(lodgingRevenue: number, availableRoomNights: number): number {
  return availableRoomNights > 0 ? lodgingRevenue / availableRoomNights : 0;
}

/** Variación porcentual actual vs. previo. null si el previo es 0 (no hay base). */
export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export type DailyOccupancy = {
  date: string;
  occupied: number;
  available: number;
  rate: number;
};

/**
 * Ocupación física por día del rango: cuántas habitaciones estuvieron ocupadas cada día.
 * Dos reservas solapando el mismo día → occupied = 2. El día de check-out no cuenta.
 */
export function buildOccupancyHistogram(
  reservations: NightlyReservation[],
  rangeStartKey: string,
  rangeEndKey: string,
  activeRooms: number,
  tz: string
): DailyOccupancy[] {
  const map = new Map<string, number>();
  for (const key of eachHotelDayKey(rangeStartKey, rangeEndKey)) map.set(key, 0);

  for (const r of reservations) {
    if (r.status === "cancelled") continue;
    const { startKey, endKey } = occupancyInterval(r, "physical", tz);
    if (daysBetweenKeys(startKey, endKey) <= 0) continue;
    let cur = maxKey(startKey, rangeStartKey);
    const stop = minKey(endKey, addDaysToDateKey(rangeEndKey, 1)); // exclusivo
    while (cur < stop) {
      const prev = map.get(cur);
      if (prev !== undefined) map.set(cur, prev + 1);
      cur = addDaysToDateKey(cur, 1);
    }
  }

  return eachHotelDayKey(rangeStartKey, rangeEndKey).map((date) => {
    const occupied = map.get(date) ?? 0;
    return { date, occupied, available: activeRooms, rate: computeOccupancyRate(occupied, activeRooms) };
  });
}

export type DailyTotal = { date: string; total: number };

/**
 * Suma un conjunto de puntos {iso, value} por día del hotel, rellenando días vacíos.
 * Bucketea con hotelDateKey (zona del hotel): un pago de las 23:00 cae en su día real.
 */
export function buildDailyTotals(
  points: { iso: string; value: number }[],
  rangeStartKey: string,
  rangeEndKey: string,
  tz: string
): DailyTotal[] {
  const map = new Map<string, number>();
  for (const key of eachHotelDayKey(rangeStartKey, rangeEndKey)) map.set(key, 0);
  for (const p of points) {
    const key = hotelDateKey(p.iso, tz);
    const prev = map.get(key);
    if (prev !== undefined) map.set(key, prev + p.value);
  }
  return eachHotelDayKey(rangeStartKey, rangeEndKey).map((date) => ({
    date,
    total: round2(map.get(date) ?? 0),
  }));
}

/** Ingreso de alojamiento (devengado) por tipo de habitación en el rango. */
export function buildRevenueByRoomType(
  reservations: NightlyReservation[],
  rangeStartKey: string,
  rangeEndKey: string,
  tz: string
): { room_type: string; total: number }[] {
  const map = new Map<string, number>();
  for (const r of reservations) {
    const nights = reservationRoomNightsInRange(r, rangeStartKey, rangeEndKey, "priced", tz);
    if (nights <= 0) continue;
    const priced = occupancyInterval(r, "priced", tz);
    const fullNights = daysBetweenKeys(priced.startKey, priced.endKey);
    const revenue = perNightLodging(r.baseTotalPrice, r.discountAmount, fullNights) * nights;
    map.set(r.roomType, (map.get(r.roomType) ?? 0) + revenue);
  }
  return Array.from(map.entries())
    .map(([room_type, total]) => ({ room_type, total: round2(total) }))
    .sort((a, b) => b.total - a.total);
}

// ───────────────────────────── KPIs de un período ─────────────────────────────

export type WindowKpis = {
  lodgingRevenue: number;
  totalPaymentsIncome: number;
  /**
   * Caja cobrada dejando solo plata de verdad: sin vale blanco (consumo interno) y
   * sin los pagos marcados `cuenta_corriente` (son fiado, no cobranza).
   */
  totalPaymentsIncomeNoVale: number;
  roomNightsSold: number;
  availableRoomNights: number;
  occupancyRate: number;
  adr: number;
  revpar: number;
  /** Pasajeros-noche del período (base física: gente que realmente durmió). */
  guestNights: number;
  /** Promedio de pasajeros por habitación ocupada por noche. */
  avgGuestsPerNight: number;
  reservationsCreated: number;
  cancellations: number;
  cancellationRate: number;
  avgLengthOfStay: number;
  avgLeadTimeDays: number;
};

/**
 * Todos los KPIs escalares de un sub-período. Recibe los arrays de la ventana unión
 * (actual + previo) y filtra internamente por el sub-rango, así se llama 2× (actual y
 * previo) sobre los mismos datos y queda testeable sin Supabase.
 */
export function computeWindowKpis(input: {
  reservationsOverlap: NightlyReservation[];
  reservationsCreated: CreatedReservation[];
  payments: PaymentPoint[];
  rangeStartKey: string;
  rangeEndKey: string;
  activeRooms: number;
  tz: string;
}): WindowKpis {
  const { reservationsOverlap, reservationsCreated, payments, rangeStartKey, rangeEndKey, activeRooms, tz } = input;

  const keyInRange = (iso: string) => {
    const k = hotelDateKey(iso, tz);
    return k >= rangeStartKey && k <= rangeEndKey;
  };

  let lodgingRevenue = 0;
  let roomNightsSold = 0;
  let guestNights = 0;
  let physicalRoomNights = 0;
  let losSum = 0;
  let losCount = 0;
  let leadSum = 0;
  let leadCount = 0;

  for (const r of reservationsOverlap) {
    if (r.status === "cancelled") continue;
    const priced = occupancyInterval(r, "priced", tz);
    const fullNights = daysBetweenKeys(priced.startKey, priced.endKey);
    if (fullNights <= 0) continue; // media estadía / siesta: sin room-nights

    const nightsInRange = reservationRoomNightsInRange(r, rangeStartKey, rangeEndKey, "priced", tz);
    if (nightsInRange > 0) {
      roomNightsSold += nightsInRange;
      lodgingRevenue += perNightLodging(r.baseTotalPrice, r.discountAmount, fullNights) * nightsInRange;
    }

    // Pasajeros-noche: base física (gente que realmente durmió), consistente con
    // el histograma de ocupación del gráfico.
    const physNights = reservationRoomNightsInRange(r, rangeStartKey, rangeEndKey, "physical", tz);
    if (physNights > 0) {
      physicalRoomNights += physNights;
      guestNights += physNights * Math.max(1, r.guestCount);
    }

    // Estadía promedio (LOS): estadías cuyo ingreso real (physical) cae en el rango.
    const phys = occupancyInterval(r, "physical", tz);
    if (phys.startKey >= rangeStartKey && phys.startKey <= rangeEndKey) {
      losSum += Math.max(1, daysBetweenKeys(phys.startKey, phys.endKey));
      losCount += 1;
    }
    // Lead time: días entre el alta y la llegada prevista, para llegadas del rango.
    if (priced.startKey >= rangeStartKey && priced.startKey <= rangeEndKey) {
      leadSum += Math.max(0, daysBetweenKeys(hotelDateKey(r.createdAt, tz), priced.startKey));
      leadCount += 1;
    }
  }

  const availableRoomNights = activeRooms * countDaysInclusive(rangeStartKey, rangeEndKey);
  const paymentsInRange = payments.filter((p) => keyInRange(p.createdAt));
  const totalPaymentsIncome = paymentsInRange.reduce((sum, p) => sum + p.amount, 0);
  // Plata de verdad: ni el vale blanco (consumo interno) ni un pago marcado
  // `cuenta_corriente` (que es fiado) entran a la caja. Ver NON_CASH_METHODS.
  const totalPaymentsIncomeNoVale = paymentsInRange
    .filter((p) => !NON_CASH_METHODS.has(p.method))
    .reduce((sum, p) => sum + p.amount, 0);

  const createdInRange = reservationsCreated.filter((r) => keyInRange(r.createdAt));
  const reservationsCreatedCount = createdInRange.length;
  const cancellations = createdInRange.filter((r) => r.status === "cancelled").length;

  return {
    lodgingRevenue: round2(lodgingRevenue),
    totalPaymentsIncome: round2(totalPaymentsIncome),
    totalPaymentsIncomeNoVale: round2(totalPaymentsIncomeNoVale),
    roomNightsSold,
    availableRoomNights,
    occupancyRate: computeOccupancyRate(roomNightsSold, availableRoomNights),
    adr: round2(computeAdr(lodgingRevenue, roomNightsSold)),
    revpar: round2(computeRevpar(lodgingRevenue, availableRoomNights)),
    guestNights,
    avgGuestsPerNight: physicalRoomNights > 0 ? round2(guestNights / physicalRoomNights) : 0,
    reservationsCreated: reservationsCreatedCount,
    cancellations,
    cancellationRate: reservationsCreatedCount > 0 ? (cancellations / reservationsCreatedCount) * 100 : 0,
    avgLengthOfStay: losCount > 0 ? round2(losSum / losCount) : 0,
    avgLeadTimeDays: leadCount > 0 ? round2(leadSum / leadCount) : 0,
  };
}

// ───────────────────────────── Pasajeros y estacionalidad ─────────────────────────────

/**
 * Pasajeros-noche por día del rango: cuánta gente durmió cada noche (base física).
 * Clon de buildOccupancyHistogram sumando guest_count en lugar de 1.
 */
export function buildGuestNightsSeries(
  reservations: NightlyReservation[],
  rangeStartKey: string,
  rangeEndKey: string,
  tz: string
): DailyTotal[] {
  const map = new Map<string, number>();
  for (const key of eachHotelDayKey(rangeStartKey, rangeEndKey)) map.set(key, 0);

  for (const r of reservations) {
    if (r.status === "cancelled") continue;
    const { startKey, endKey } = occupancyInterval(r, "physical", tz);
    if (daysBetweenKeys(startKey, endKey) <= 0) continue;
    const guests = Math.max(1, r.guestCount);
    let cur = maxKey(startKey, rangeStartKey);
    const stop = minKey(endKey, addDaysToDateKey(rangeEndKey, 1)); // exclusivo
    while (cur < stop) {
      const prev = map.get(cur);
      if (prev !== undefined) map.set(cur, prev + guests);
      cur = addDaysToDateKey(cur, 1);
    }
  }

  return eachHotelDayKey(rangeStartKey, rangeEndKey).map((date) => ({
    date,
    total: map.get(date) ?? 0,
  }));
}

/** 0=lunes … 6=domingo, en espacio UTC de la clave (puro, inmune a tz). */
export function weekdayOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  // getUTCDay(): 0=domingo … 6=sábado → normalizamos a lunes-primero.
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export type WeekdayStat = {
  /** 0=lunes … 6=domingo. */
  weekday: number;
  label: string;
  /** Cuántas veces aparece este día de semana en el rango. */
  days: number;
  avgOccupancyRate: number;
  avgRevenue: number;
};

/**
 * Estacionalidad por día de la semana: promedia la ocupación y la recaudación de
 * las series diarias ya calculadas, agrupando por día de semana. Divide por el
 * número REAL de ocurrencias de cada día (los rangos no múltiplos de 7 no
 * distorsionan). Orden lunes-primero. Responde "¿los sábados se repiten?".
 */
export function buildWeekdaySeasonality(
  dailyOccupancy: DailyOccupancy[],
  dailyCash: DailyTotal[]
): WeekdayStat[] {
  const occSum = new Array(7).fill(0);
  const occCount = new Array(7).fill(0);
  const cashSum = new Array(7).fill(0);
  const cashCount = new Array(7).fill(0);

  for (const d of dailyOccupancy) {
    const w = weekdayOfKey(d.date);
    occSum[w] += d.rate;
    occCount[w] += 1;
  }
  for (const d of dailyCash) {
    const w = weekdayOfKey(d.date);
    cashSum[w] += d.total;
    cashCount[w] += 1;
  }

  return WEEKDAY_LABELS.map((label, weekday) => ({
    weekday,
    label,
    days: Math.max(occCount[weekday], cashCount[weekday]),
    avgOccupancyRate: occCount[weekday] > 0 ? round2(occSum[weekday] / occCount[weekday]) : 0,
    avgRevenue: cashCount[weekday] > 0 ? round2(cashSum[weekday] / cashCount[weekday]) : 0,
  }));
}

// ───────────────────────────── Desglose por habitación ─────────────────────────────

/** Identidad de una habitación activa (para el tablero por habitación). */
export type RoomInfo = { id: number; roomNumber: string; roomType: string };

/** Reserva creada, con la habitación asociada (para cancelaciones por habitación). */
export type CreatedRoomReservation = {
  roomId: number;
  status: ReservationStatus;
  createdAt: string;
};

/** Un registro de limpieza asociado a una habitación. */
export type RoomCleaning = { roomId: number; cleanedAt: string };

export type RoomBreakdownRow = {
  roomId: number;
  roomNumber: string;
  roomType: string;
  roomNightsSold: number;
  availableNights: number;
  occupancyRate: number;
  lodgingRevenue: number;
  adr: number;
  revpar: number;
  reservations: number;
  cancellations: number;
  cleanings: number;
};

/**
 * Métricas por habitación en el rango [start, end] (inclusive). Cada habitación tiene
 * `availableNights = días del período` (una unidad, disponible cada día). Reutiliza las
 * mismas reglas de room-nights/ingreso que los KPIs globales, de modo que la suma de las
 * filas coincide con el total del tablero general. Ordena por nº de habitación.
 */
export function buildRoomBreakdown(input: {
  rooms: RoomInfo[];
  reservationsOverlap: NightlyReservation[];
  createdWithRoom: CreatedRoomReservation[];
  cleanings: RoomCleaning[];
  rangeStartKey: string;
  rangeEndKey: string;
  tz: string;
}): RoomBreakdownRow[] {
  const { rooms, reservationsOverlap, createdWithRoom, cleanings, rangeStartKey, rangeEndKey, tz } = input;
  const days = countDaysInclusive(rangeStartKey, rangeEndKey);

  const byId = new Map<number, RoomBreakdownRow>();
  for (const rm of rooms) {
    byId.set(rm.id, {
      roomId: rm.id,
      roomNumber: rm.roomNumber,
      roomType: rm.roomType,
      roomNightsSold: 0,
      availableNights: days,
      occupancyRate: 0,
      lodgingRevenue: 0,
      adr: 0,
      revpar: 0,
      reservations: 0,
      cancellations: 0,
      cleanings: 0,
    });
  }

  for (const r of reservationsOverlap) {
    if (r.status === "cancelled") continue;
    const row = byId.get(r.roomId);
    if (!row) continue;
    const priced = occupancyInterval(r, "priced", tz);
    const fullNights = daysBetweenKeys(priced.startKey, priced.endKey);
    if (fullNights <= 0) continue; // media estadía / siesta: sin room-nights
    const nights = reservationRoomNightsInRange(r, rangeStartKey, rangeEndKey, "priced", tz);
    if (nights <= 0) continue;
    row.roomNightsSold += nights;
    row.lodgingRevenue += perNightLodging(r.baseTotalPrice, r.discountAmount, fullNights) * nights;
    row.reservations += 1;
  }

  const inRange = (iso: string) => {
    const k = hotelDateKey(iso, tz);
    return k >= rangeStartKey && k <= rangeEndKey;
  };
  for (const c of createdWithRoom) {
    if (c.status !== "cancelled" || !inRange(c.createdAt)) continue;
    const row = byId.get(c.roomId);
    if (row) row.cancellations += 1;
  }
  for (const cl of cleanings) {
    if (!inRange(cl.cleanedAt)) continue;
    const row = byId.get(cl.roomId);
    if (row) row.cleanings += 1;
  }

  for (const row of byId.values()) {
    row.lodgingRevenue = round2(row.lodgingRevenue);
    row.occupancyRate = computeOccupancyRate(row.roomNightsSold, row.availableNights);
    row.adr = round2(computeAdr(row.lodgingRevenue, row.roomNightsSold));
    row.revpar = round2(computeRevpar(row.lodgingRevenue, row.availableNights));
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
  );
}

export type RoomBreakdownTotals = {
  roomNightsSold: number;
  availableNights: number;
  occupancyRate: number;
  lodgingRevenue: number;
  adr: number;
  revpar: number;
  reservations: number;
  cancellations: number;
  cleanings: number;
};

/** Fila de totales del desglose por habitación (ocupación/ADR/RevPAR recomputados del total). */
export function summarizeRoomBreakdown(rows: RoomBreakdownRow[]): RoomBreakdownTotals {
  const acc = rows.reduce(
    (a, r) => {
      a.roomNightsSold += r.roomNightsSold;
      a.availableNights += r.availableNights;
      a.lodgingRevenue += r.lodgingRevenue;
      a.reservations += r.reservations;
      a.cancellations += r.cancellations;
      a.cleanings += r.cleanings;
      return a;
    },
    { roomNightsSold: 0, availableNights: 0, lodgingRevenue: 0, reservations: 0, cancellations: 0, cleanings: 0 }
  );
  const lodgingRevenue = round2(acc.lodgingRevenue);
  return {
    roomNightsSold: acc.roomNightsSold,
    availableNights: acc.availableNights,
    occupancyRate: computeOccupancyRate(acc.roomNightsSold, acc.availableNights),
    lodgingRevenue,
    adr: round2(computeAdr(lodgingRevenue, acc.roomNightsSold)),
    revpar: round2(computeRevpar(lodgingRevenue, acc.availableNights)),
    reservations: acc.reservations,
    cancellations: acc.cancellations,
    cleanings: acc.cleanings,
  };
}

// ─────────────────────── Cierre de ventas del período ───────────────────────
//
// El tablero mezclaba tres bases distintas (devengado por noche, caja por fecha de
// pago, y foto de hoy) y por eso "la venta" nunca daba igual a "cobrado + impago".
// Este bloque agrega la única cohorte donde la cuenta CIERRA exacto: las estadías
// que se cerraron (check-out real) dentro del período. Para cada una vale la
// invariante que garantizan los RPCs de cobro y check-out:
//
//     total_price = Σ pagos + Σ cargos a cuenta corriente + saldo pendiente
//
// El "fiado a cuenta corriente" es justamente la pata que faltaba: plata vendida
// que no entró por caja y que tampoco figura en el saldo de la reserva (el
// check-out a cta cte deja la reserva saldada y muda la deuda a la cuenta).

/** Una estadía cerrada (check-out real) con su liquidación ya agregada. */
export type ClosedStay = {
  actualCheckOut: string;
  /** Venta final de la estadía: alojamiento neto de descuento + extras. */
  totalPrice: number;
  baseTotalPrice: number;
  discountAmount: number;
  paidAmount: number;
  /** Pagos con plata de verdad (cualquier método salvo vale blanco). */
  paymentsMoney: number;
  /** Pagos con vale blanco (consumo interno: no es plata que entra). */
  paymentsVale: number;
  /** Cargado a la cuenta corriente del cliente al cerrar (fiado). */
  creditCharged: number;
};

export type SalesSettlement = {
  stays: number;
  /** Venta total de las estadías cerradas en el período (alojamiento + extras). */
  sales: number;
  lodging: number;
  extras: number;
  collectedMoney: number;
  vale: number;
  credit: number;
  pending: number;
  /** sales − (collectedMoney + vale + credit + pending). Cero = los libros cierran. */
  unreconciled: number;
};

/**
 * Liquidación de las estadías cerradas dentro de [rangeStart, rangeEnd] (inclusive),
 * bucketeadas por el día del hotel del check-out real. `unreconciled` es el testigo:
 * si sale distinto de 0 hay filas inconsistentes y el tablero lo tiene que mostrar
 * en vez de disimularlo.
 */
export function buildSalesSettlement(
  stays: ClosedStay[],
  rangeStartKey: string,
  rangeEndKey: string,
  tz: string
): SalesSettlement {
  const acc = {
    stays: 0,
    sales: 0,
    lodging: 0,
    extras: 0,
    collectedMoney: 0,
    vale: 0,
    credit: 0,
    pending: 0,
  };

  for (const s of stays) {
    const key = hotelDateKey(s.actualCheckOut, tz);
    if (key < rangeStartKey || key > rangeEndKey) continue;
    const lodging = s.baseTotalPrice - s.discountAmount;
    acc.stays += 1;
    acc.sales += s.totalPrice;
    acc.lodging += lodging;
    acc.extras += s.totalPrice - lodging;
    acc.collectedMoney += s.paymentsMoney;
    acc.vale += s.paymentsVale;
    acc.credit += s.creditCharged;
    acc.pending += s.totalPrice - s.paidAmount;
  }

  const sales = round2(acc.sales);
  const collectedMoney = round2(acc.collectedMoney);
  const vale = round2(acc.vale);
  const credit = round2(acc.credit);
  const pending = round2(acc.pending);

  return {
    stays: acc.stays,
    sales,
    lodging: round2(acc.lodging),
    extras: round2(acc.extras),
    collectedMoney,
    vale,
    credit,
    pending,
    unreconciled: round2(sales - (collectedMoney + vale + credit + pending)),
  };
}

/** Un movimiento de cuenta corriente para bucketear por período. */
export type AccountMovementPoint = { tipo: "cargo" | "pago"; amount: number; createdAt: string };

/** Lo que se fió y lo que se cobró de cuenta corriente dentro del período. */
export type AccountFlow = { charged: number; collected: number };

/**
 * Flujo de cuenta corriente del período. `collected` es plata que entró de verdad
 * (empresas saldando su cuenta) y que NO pasa por `payments` ni por el arqueo, así
 * que sin esto quedaba invisible en todo el tablero.
 */
export function sumAccountMovements(
  movements: AccountMovementPoint[],
  rangeStartKey: string,
  rangeEndKey: string,
  tz: string
): AccountFlow {
  let charged = 0;
  let collected = 0;
  for (const m of movements) {
    const key = hotelDateKey(m.createdAt, tz);
    if (key < rangeStartKey || key > rangeEndKey) continue;
    if (m.tipo === "cargo") charged += m.amount;
    else collected += m.amount;
  }
  return { charged: round2(charged), collected: round2(collected) };
}
