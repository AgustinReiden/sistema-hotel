import { describe, expect, it } from "vitest";

import {
  calculateEarlyCheckoutBreakdown,
  calculateReservationNights,
  calculateReservationPriceBreakdown,
  calculateWalkInPriceBreakdown,
} from "@/lib/pricing";

const TZ = "America/Argentina/Tucuman"; // UTC-3, sin DST

describe("calculateReservationPriceBreakdown", () => {
  it("calculates a frozen percentage discount over the base total", () => {
    const result = calculateReservationPriceBreakdown({
      basePrice: 10000,
      checkIn: "2026-04-01T14:00:00.000Z",
      checkOut: "2026-04-03T10:00:00.000Z",
      discountPercent: 10,
    });

    expect(result.nights).toBe(2);
    expect(result.baseTotalPrice).toBe(20000);
    expect(result.discountPercent).toBe(10);
    expect(result.discountAmount).toBe(2000);
    expect(result.finalTotalPrice).toBe(18000);
  });

  it("rounds up partial days to at least one night", () => {
    expect(
      calculateReservationNights("2026-04-01T14:00:00.000Z", "2026-04-02T01:00:00.000Z")
    ).toBe(1);
  });
});

describe("calculateWalkInPriceBreakdown", () => {
  it("applies the associated discount to walk-ins", () => {
    const result = calculateWalkInPriceBreakdown({
      basePrice: 8000,
      nights: 3,
      discountPercent: 15,
    });

    expect(result.baseTotalPrice).toBe(24000);
    expect(result.discountAmount).toBe(3600);
    expect(result.finalTotalPrice).toBe(20400);
  });
});

describe("calculateEarlyCheckoutBreakdown", () => {
  // Juan: reserva 03/07 -> 05/07 (2 noches, $10k/noche) y se va el 04/07.
  const base = {
    checkInTargetIso: "2026-07-03T14:00:00-03:00",
    checkOutTargetIso: "2026-07-05T10:00:00-03:00",
    baseTotalPrice: 20000,
    totalPrice: 20000,
    timezone: TZ,
  };

  it("charges only the nights slept (2 -> 1)", () => {
    const r = calculateEarlyCheckoutBreakdown({
      ...base,
      departureIso: "2026-07-04T09:00:00-03:00",
    });
    expect(r.originalNights).toBe(2);
    expect(r.chargedNights).toBe(1);
    expect(r.newTotal).toBe(10000);
    expect(r.newBalance).toBe(10000);
    expect(r.isOverpaid).toBe(false);
  });

  it("preserves the associated discount percentage", () => {
    const r = calculateEarlyCheckoutBreakdown({
      checkInTargetIso: base.checkInTargetIso,
      checkOutTargetIso: base.checkOutTargetIso,
      departureIso: "2026-07-04T09:00:00-03:00",
      baseTotalPrice: 20000,
      discountPercent: 10,
      discountAmount: 2000,
      totalPrice: 18000, // 2 noches con 10% off
      timezone: TZ,
    });
    expect(r.chargedNights).toBe(1);
    expect(r.newDiscountAmount).toBe(1000);
    expect(r.newTotal).toBe(9000); // 1 noche con 10% off
  });

  it("preserves extra charges (minibar, damages, half day)", () => {
    const r = calculateEarlyCheckoutBreakdown({
      ...base,
      totalPrice: 23000, // 2 noches (20000) + 3000 de extras
      departureIso: "2026-07-04T09:00:00-03:00",
    });
    expect(r.extras).toBe(3000);
    expect(r.newTotal).toBe(13000); // 1 noche (10000) + extras (3000)
  });

  it("charges at least one night when leaving the same day", () => {
    const r = calculateEarlyCheckoutBreakdown({
      checkInTargetIso: "2026-07-03T14:00:00-03:00",
      checkOutTargetIso: "2026-07-06T10:00:00-03:00",
      departureIso: "2026-07-03T20:00:00-03:00",
      baseTotalPrice: 30000, // 3 noches
      totalPrice: 30000,
      timezone: TZ,
    });
    expect(r.chargedNights).toBe(1);
    expect(r.newTotal).toBe(10000);
  });

  it("flags overpayment when the guest already paid more than the new total", () => {
    const r = calculateEarlyCheckoutBreakdown({
      ...base,
      paidAmount: 20000, // prepago 2 noches
      departureIso: "2026-07-04T09:00:00-03:00",
    });
    expect(r.newTotal).toBe(10000);
    expect(r.isOverpaid).toBe(true);
    expect(r.newBalance).toBe(0);
  });

  it("does not reduce when leaving on the reserved checkout date", () => {
    const r = calculateEarlyCheckoutBreakdown({
      ...base,
      departureIso: "2026-07-05T09:00:00-03:00",
    });
    expect(r.chargedNights).toBe(2);
    expect(r.newTotal).toBe(20000);
  });
});
