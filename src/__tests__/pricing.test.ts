import { describe, expect, it } from "vitest";

import {
  calculateEarlyCheckoutBreakdown,
  calculateHalfDayPriceBreakdown,
  calculateReservationNights,
  calculateReservationPriceBreakdown,
  calculateWalkInPriceBreakdown,
  resolveEffectiveDiscountPercent,
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

  it("cobra al menos una noche aunque la estadia entre y salga el mismo dia", () => {
    // 11:00 -> 22:00 hora del hotel: mismo dia de calendario, 0 noches -> minimo 1.
    expect(
      calculateReservationNights("2026-04-01T14:00:00.000Z", "2026-04-02T01:00:00.000Z", TZ)
    ).toBe(1);
  });

  it("cuenta noches de calendario, no bloques de 24 horas (regresion mig 95)", () => {
    // El caso de la habitacion 15: walk-in 09:20, salida 10:00 del dia siguiente. Son
    // 24 h 40 min, que con la cuenta vieja (horas/24 para arriba) daban 2 noches.
    expect(
      calculateReservationNights("2026-09-09T12:20:09.000Z", "2026-09-10T13:00:00.000Z", TZ)
    ).toBe(1);

    const result = calculateReservationPriceBreakdown({
      basePrice: 50000,
      checkIn: "2026-09-09T12:20:09.000Z",
      checkOut: "2026-09-10T13:00:00.000Z",
      timezone: TZ,
    });
    expect(result.nights).toBe(1);
    expect(result.finalTotalPrice).toBe(50000);
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

// Fase 4: un solo criterio de noches en todo el sistema. Una noche es una noche de
// CALENDARIO en la zona del hotel, con minimo 1 — la hora de entrada define el servicio,
// no cuantas noches se cobran. Estos tests fijan ese criterio del lado del front y, sobre
// todo, que las dos pantallas que muestran noches (alta / re-tarifa y salida anticipada)
// no puedan volver a contar distinto. La autoridad en la base es app_hotel_nights
// (mig 96), que aplica exactamente esta cuenta.
describe("noches de calendario: un solo criterio", () => {
  it("cuenta las noches que dormis, no los bloques de 24 horas", () => {
    // Entrada y salida a la hora estandar del hotel: el caso normal.
    expect(
      calculateReservationNights("2026-07-03T14:00:00-03:00", "2026-07-04T10:00:00-03:00", TZ)
    ).toBe(1);
    expect(
      calculateReservationNights("2026-07-03T14:00:00-03:00", "2026-07-05T10:00:00-03:00", TZ)
    ).toBe(2);
  });

  it("una entrada temprana no agrega una noche (antes daba 3)", () => {
    // 09:00 -> 10:00 dos dias despues son 49 h: horas/24 para arriba daba 3 noches y
    // congelaba una noche de mas. Del 3 al 5 son dos noches, se entre a las 9 o a las 14.
    expect(
      calculateReservationNights("2026-07-03T09:00:00-03:00", "2026-07-05T10:00:00-03:00", TZ)
    ).toBe(2);
  });

  it("cobra una noche cuando entra y sale el mismo dia", () => {
    // 12:00 -> 17:00: cero noches de calendario, pero la habitacion se ocupo. El minimo
    // de 1 es el que cubre esto (la siesta tarifada va por half_day_price, no por aca).
    expect(
      calculateReservationNights("2026-07-03T12:00:00-03:00", "2026-07-03T17:00:00-03:00", TZ)
    ).toBe(1);
  });

  it("cuenta en la zona del hotel, no en UTC", () => {
    // 22:00 del 03/07 en Tucuman ya es el 04/07 en UTC: contar por fecha UTC daria dos
    // fechas distintas del lado de la entrada y la noche se contaria mal.
    expect(
      calculateReservationNights("2026-07-03T22:00:00-03:00", "2026-07-04T10:00:00-03:00", TZ)
    ).toBe(1);
  });

  it("la hora de salida no puede agregar noches (caso 37 h)", () => {
    // Entrada 09:00, salida 22:00 del dia siguiente. round(37/24) da 2, que es lo que
    // leia rpc_extend_reservation antes de la mig 96 mientras el alta cobraba 1.
    expect(
      calculateReservationNights("2026-07-03T09:00:00-03:00", "2026-07-04T22:00:00-03:00", TZ)
    ).toBe(1);
  });

  it("el alta y la salida anticipada cuentan las mismas noches", () => {
    // La invariante que se rompio: si estas dos discrepan, el huesped paga N noches al
    // entrar y el check-out divide por otro numero. Se prueba sobre horarios variados,
    // porque solo coincidian cuando la hora de salida era menor que la de entrada.
    const pares = [
      ["2026-07-03T14:00:00-03:00", "2026-07-04T10:00:00-03:00"],
      ["2026-07-03T14:00:00-03:00", "2026-07-06T10:00:00-03:00"],
      ["2026-07-03T09:00:00-03:00", "2026-07-05T10:00:00-03:00"],
      ["2026-07-03T09:00:00-03:00", "2026-07-04T22:00:00-03:00"],
      ["2026-07-03T22:00:00-03:00", "2026-07-04T10:00:00-03:00"],
      ["2026-07-03T12:00:00-03:00", "2026-07-03T17:00:00-03:00"],
      ["2026-07-03T00:30:00-03:00", "2026-07-08T23:45:00-03:00"],
    ] as const;

    for (const [checkIn, checkOut] of pares) {
      const alta = calculateReservationPriceBreakdown({
        basePrice: 50000,
        checkIn,
        checkOut,
        timezone: TZ,
      });
      const salida = calculateEarlyCheckoutBreakdown({
        checkInTargetIso: checkIn,
        checkOutTargetIso: checkOut,
        departureIso: checkOut, // se va el dia que tenia reservado: no hay reduccion
        baseTotalPrice: alta.baseTotalPrice,
        totalPrice: alta.finalTotalPrice,
        timezone: TZ,
      });

      expect(salida.originalNights, `${checkIn} -> ${checkOut}`).toBe(alta.nights);
      expect(salida.chargedNights, `${checkIn} -> ${checkOut}`).toBe(alta.nights);
      expect(salida.newTotal, `${checkIn} -> ${checkOut}`).toBe(alta.finalTotalPrice);
    }
  });
});

describe("el descuento no puede dejar el total en negativo", () => {
  // Un descuento cargado mal (150 %) daba un "a pagar" negativo en pantalla y ese
  // número se congelaba en la reserva. El descuento puede llegar a regalar la
  // estadía; nunca a que el hotel le deba plata al huésped.
  it("acota el total de una reserva a cero", () => {
    const r = calculateReservationPriceBreakdown({
      basePrice: 50000,
      checkIn: "2026-07-03T14:00:00-03:00",
      checkOut: "2026-07-05T10:00:00-03:00",
      discountPercent: 150,
      timezone: TZ,
    });
    expect(r.baseTotalPrice).toBe(100000);
    expect(r.finalTotalPrice).toBe(0);
  });

  it("acota el total de un walk-in a cero", () => {
    const r = calculateWalkInPriceBreakdown({
      basePrice: 50000,
      nights: 2,
      discountPercent: 150,
    });
    expect(r.finalTotalPrice).toBe(0);
  });

  it("acota el total de una media estadía a cero", () => {
    const r = calculateHalfDayPriceBreakdown({
      halfDayPrice: 30000,
      discountPercent: 120,
    });
    expect(r.finalTotalPrice).toBe(0);
  });

  it("con 100 % justo da cero, no un negativo por redondeo", () => {
    const r = calculateReservationPriceBreakdown({
      basePrice: 33333.33,
      checkIn: "2026-07-03T14:00:00-03:00",
      checkOut: "2026-07-06T10:00:00-03:00",
      discountPercent: 100,
      timezone: TZ,
    });
    expect(r.finalTotalPrice).toBe(0);
  });

  it("un descuento normal sigue funcionando igual", () => {
    const r = calculateReservationPriceBreakdown({
      basePrice: 50000,
      checkIn: "2026-07-03T14:00:00-03:00",
      checkOut: "2026-07-05T10:00:00-03:00",
      discountPercent: 10,
      timezone: TZ,
    });
    expect(r.finalTotalPrice).toBe(90000);
  });
});
