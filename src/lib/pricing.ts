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
