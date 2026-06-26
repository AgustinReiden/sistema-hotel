import { describe, expect, it } from "vitest";

import {
  calculateReservationNights,
  calculateReservationPriceBreakdown,
  calculateWalkInPriceBreakdown,
  resolveEffectiveDiscountPercent,
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

describe("resolveEffectiveDiscountPercent", () => {
  it("usa el descuento de la empresa/convenio cuando esta adjunta (aunque el huesped tenga otro)", () => {
    expect(
      resolveEffectiveDiscountPercent({
        hasCompany: true,
        companyDiscountPercent: 10,
        guestDiscountPercent: 5,
      })
    ).toBe(10);
  });

  it("la empresa manda aunque su descuento sea 0 (es la facturable)", () => {
    expect(
      resolveEffectiveDiscountPercent({
        hasCompany: true,
        companyDiscountPercent: 0,
        guestDiscountPercent: 5,
      })
    ).toBe(0);
  });

  it("usa el descuento personal del huesped cuando no hay empresa", () => {
    expect(
      resolveEffectiveDiscountPercent({
        hasCompany: false,
        companyDiscountPercent: 10,
        guestDiscountPercent: 5,
      })
    ).toBe(5);
  });

  it("es 0 cuando no hay empresa ni descuento del huesped", () => {
    expect(
      resolveEffectiveDiscountPercent({ hasCompany: false, guestDiscountPercent: 0 })
    ).toBe(0);
    expect(resolveEffectiveDiscountPercent({ hasCompany: false })).toBe(0);
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
