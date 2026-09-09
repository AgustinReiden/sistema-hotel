import { countHotelNights } from "./time";

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Total despues del descuento, con piso en cero. Un descuento mayor a 100 dejaba
 * el total en negativo y la pantalla mostraba un "a pagar" negativo, que despues
 * se congelaba en la reserva. El hotel no le debe plata al huesped por reservar:
 * el descuento puede llegar a regalar la estadia, no a pagarla.
 */
function finalAfterDiscount(baseTotalPrice: number, discountAmount: number) {
  return Math.max(0, roundCurrency(baseTotalPrice - discountAmount));
}

/**
 * Noches de CALENDARIO en la zona del hotel. Del 9 al 10 es una noche, se entre a las
 * 06:00 o a las 23:00: la hora de entrada define el servicio, no cuantas noches se
 * cobran. Debe coincidir con app_calculate_reservation_pricing (mig 95), que es la
 * autoridad; antes las dos contaban horas/24 para arriba y un walk-in de la manana
 * cobraba una noche de mas.
 */
export function calculateReservationNights(
  checkIn: string,
  checkOut: string,
  timezone?: string
) {
  return Math.max(1, countHotelNights(checkIn, checkOut, timezone));
}

/**
 * Salida anticipada: recalcula el precio a las noches efectivamente dormidas
 * (desde el check-in hasta el día de salida), preservando la tarifa cotizada, el
 * % de descuento y los extras (minibar, daños, media estadía). Es el PREVIEW que
 * usa la UI; la autoridad es rpc_staff_early_checkout, que aplica la misma fórmula.
 *
 * Única diferencia con la RPC, y sólo con un descuento imposible de >100 %: acá el
 * neto tiene piso en cero y allá no, pero allá el UPDATE rebota contra el CHECK
 * reservations_total_price_non_negative. Ninguna de las dos guarda un negativo.
 */
export function calculateEarlyCheckoutBreakdown({
  checkInTargetIso,
  checkOutTargetIso,
  departureIso,
  baseTotalPrice,
  discountPercent = 0,
  discountAmount = 0,
  totalPrice,
  paidAmount = 0,
  timezone,
}: {
  checkInTargetIso: string;
  checkOutTargetIso: string;
  departureIso: string;
  baseTotalPrice: number;
  discountPercent?: number;
  discountAmount?: number;
  totalPrice: number;
  paidAmount?: number;
  timezone?: string;
}) {
  const originalNights = Math.max(
    1,
    countHotelNights(checkInTargetIso, checkOutTargetIso, timezone)
  );
  const chargedNights = Math.min(
    originalNights,
    Math.max(1, countHotelNights(checkInTargetIso, departureIso, timezone))
  );

  const perNight = baseTotalPrice / originalNights;
  const extras = roundCurrency(totalPrice - (baseTotalPrice - discountAmount));
  const newBaseTotal = roundCurrency(perNight * chargedNights);
  const newDiscountAmount = roundCurrency((newBaseTotal * discountPercent) / 100);
  const newFinal = finalAfterDiscount(newBaseTotal, newDiscountAmount);
  const newTotal = roundCurrency(newFinal + extras);
  const newBalance = roundCurrency(Math.max(0, newTotal - paidAmount));
  const isOverpaid = newTotal < paidAmount;

  return {
    originalNights,
    chargedNights,
    newBaseTotal,
    newDiscountPercent: roundCurrency(discountPercent),
    newDiscountAmount,
    newFinal,
    extras,
    newTotal,
    newBalance,
    isOverpaid,
  };
}

/**
 * Precedencia de descuento de una reserva (debe coincidir con rpc_staff_create_reservation):
 * si hay una empresa/convenio adjunta manda SU descuento (aunque sea 0, porque es la
 * facturable); si no, manda el descuento personal del huesped; si no hay ninguno, 0.
 */
export function resolveEffectiveDiscountPercent({
  hasCompany,
  companyDiscountPercent,
  guestDiscountPercent,
}: {
  hasCompany: boolean;
  companyDiscountPercent?: number | null;
  guestDiscountPercent?: number | null;
}): number {
  const value = hasCompany ? companyDiscountPercent : guestDiscountPercent;
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? roundCurrency(normalized) : 0;
}

export function calculateReservationPriceBreakdown({
  basePrice,
  checkIn,
  checkOut,
  discountPercent = 0,
  timezone,
}: {
  basePrice: number;
  checkIn: string;
  checkOut: string;
  discountPercent?: number;
  timezone?: string;
}) {
  const nights = calculateReservationNights(checkIn, checkOut, timezone);
  const baseTotalPrice = roundCurrency(basePrice * nights);
  const normalizedDiscountPercent = roundCurrency(discountPercent);
  const discountAmount = roundCurrency((baseTotalPrice * normalizedDiscountPercent) / 100);
  const finalTotalPrice = finalAfterDiscount(baseTotalPrice, discountAmount);

  return {
    nights,
    baseTotalPrice,
    discountPercent: normalizedDiscountPercent,
    discountAmount,
    finalTotalPrice,
  };
}

export function calculateWalkInPriceBreakdown({
  basePrice,
  nights,
  discountPercent = 0,
}: {
  basePrice: number;
  nights: number;
  discountPercent?: number;
}) {
  const normalizedNights = Math.max(1, Math.floor(nights));
  const baseTotalPrice = roundCurrency(basePrice * normalizedNights);
  const normalizedDiscountPercent = roundCurrency(discountPercent);
  const discountAmount = roundCurrency((baseTotalPrice * normalizedDiscountPercent) / 100);
  const finalTotalPrice = finalAfterDiscount(baseTotalPrice, discountAmount);

  return {
    nights: normalizedNights,
    baseTotalPrice,
    discountPercent: normalizedDiscountPercent,
    discountAmount,
    finalTotalPrice,
  };
}

/**
 * Media estadia / siesta (12 a 17 hs): se cobra un precio fijo de medio dia
 * (rooms.half_day_price), con el descuento del asociado si corresponde.
 */
export function calculateHalfDayPriceBreakdown({
  halfDayPrice,
  discountPercent = 0,
}: {
  halfDayPrice: number;
  discountPercent?: number;
}) {
  const baseTotalPrice = roundCurrency(halfDayPrice);
  const normalizedDiscountPercent = roundCurrency(discountPercent);
  const discountAmount = roundCurrency((baseTotalPrice * normalizedDiscountPercent) / 100);
  const finalTotalPrice = finalAfterDiscount(baseTotalPrice, discountAmount);

  return {
    baseTotalPrice,
    discountPercent: normalizedDiscountPercent,
    discountAmount,
    finalTotalPrice,
  };
}
