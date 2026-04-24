import { describe, expect, it } from "vitest";

import {
  formatAmount,
  formatMoney,
  formatShiftCode,
  formatSignedAmount,
  localToISO,
} from "@/lib/format";

describe("formatMoney", () => {
  it("formats ARS correctly", () => {
    const result = formatMoney(1500.5, "ARS");
    expect(result).toContain("1.500,50");
  });

  it("formats USD correctly", () => {
    const result = formatMoney(99.99, "USD");
    expect(result).toContain("99,99");
  });

  it("formats zero", () => {
    const result = formatMoney(0, "ARS");
    expect(result).toContain("0,00");
  });

  it("handles large numbers", () => {
    const result = formatMoney(1000000, "ARS");
    expect(result).toContain("1.000.000");
  });

  it("falls back to USD for invalid currency", () => {
    const result = formatMoney(100, "INVALID_CURRENCY");
    expect(result).toBeTruthy();
    expect(result).toContain("100");
  });
});

describe("formatAmount", () => {
  it("formats amounts with peso sign", () => {
    expect(formatAmount(1234.5)).toBe("$1.234,50");
  });

  it("keeps the minus sign before the peso sign", () => {
    expect(formatAmount(-250)).toBe("-$250,00");
  });
});

describe("formatSignedAmount", () => {
  it("returns placeholder for null", () => {
    expect(formatSignedAmount(null)).toBe("---");
  });

  it("adds an explicit plus sign for positive values", () => {
    expect(formatSignedAmount(350)).toBe("+$350,00");
  });

  it("shows minus sign for negative values", () => {
    expect(formatSignedAmount(-125.5)).toBe("-$125,50");
  });

  it("shows zero without explicit sign", () => {
    expect(formatSignedAmount(0)).toBe("$0,00");
  });
});

describe("formatShiftCode", () => {
  it("pads numeric shift codes to 6 digits by default", () => {
    expect(formatShiftCode(27)).toBe("000027");
  });

  it("accepts a custom minimum length", () => {
    expect(formatShiftCode(27, 4)).toBe("0027");
  });
});

describe("localToISO", () => {
  it("creates correct ISO string for Argentina timezone", () => {
    const result = localToISO("2026-03-15", "14:00", "America/Argentina/Buenos_Aires");
    expect(result).toMatch(/^2026-03-15T14:00:00/);
    expect(result).toMatch(/-03:00$/);
  });

  it("pads single-digit months and days", () => {
    const result = localToISO("2026-01-05", "09:30", "America/Argentina/Buenos_Aires");
    expect(result).toMatch(/^2026-01-05T09:30:00/);
  });

  it("handles UTC timezone", () => {
    const result = localToISO("2026-06-15", "12:00", "UTC");
    expect(result).toBe("2026-06-15T12:00:00+00:00");
  });
});
