const DAY_IN_MS = 1000 * 60 * 60 * 24;

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateReservationNights(checkIn: string, checkOut: string) {
  const durationMs = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.ceil(durationMs / DAY_IN_MS));
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
