import { describe, expect, it } from "vitest";

import {
  calculateReservationNights,
  calculateReservationPriceBreakdown,
  calculateWalkInPriceBreakdown,
} from "@/lib/pricing";

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
