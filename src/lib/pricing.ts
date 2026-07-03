import { countHotelNights } from "./time";

const DAY_IN_MS = 1000 * 60 * 60 * 24;

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateReservationNights(checkIn: string, checkOut: string) {
  const durationMs = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.ceil(durationMs / DAY_IN_MS));
}

export function calculateReservationPriceBreakdown({
  basePrice,
  checkIn,
  checkOut,
  discountPercent = 0,
}: {
  basePrice: number;
  checkIn: string;
  checkOut: string;
  discountPercent?: number;
}) {
  const nights = calculateReservationNights(checkIn, checkOut);
  const baseTotalPrice = roundCurrency(basePrice * nights);
  const normalizedDiscountPercent = roundCurrency(discountPercent);
  const discountAmount = roundCurrency((baseTotalPrice * normalizedDiscountPercent) / 100);
  const finalTotalPrice = roundCurrency(baseTotalPrice - discountAmount);

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
  const finalTotalPrice = roundCurrency(baseTotalPrice - discountAmount);

  return {
    nights: normalizedNights,
    baseTotalPrice,
    discountPercent: normalizedDiscountPercent,
    discountAmount,
    finalTotalPrice,
  };
}

/**
 * Salida anticipada: recalcula el precio a las noches efectivamente dormidas
 * (desde el check-in hasta el dia de salida), preservando la tarifa cotizada, el
 * % de descuento y los extras (minibar, danos, media estadia). Es el PREVIEW que
 * usa la UI; la autoridad es rpc_staff_early_checkout, que aplica la misma formula.
 *
 * - noches a cobrar = noches calendario (zona hotel) check-in -> salida, min 1,
 *   nunca mas que las noches originales.
 * - tarifa/noche = baseTotalPrice / noches_originales.
 * - extras = totalPrice - (baseTotalPrice - discountAmount).
 * - nuevo total = (nuevaBase - nuevoDescuento) + extras.
 * - isOverpaid: el nuevo total quedo por debajo de lo ya pagado (lo cierra admin).
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
  const newFinal = roundCurrency(newBaseTotal - newDiscountAmount);
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
  const finalTotalPrice = roundCurrency(baseTotalPrice - discountAmount);

  return {
    baseTotalPrice,
    discountPercent: normalizedDiscountPercent,
    discountAmount,
    finalTotalPrice,
  };
}
