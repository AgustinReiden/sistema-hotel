import { describe, expect, it } from "vitest";

import {
  addDaysToDateKey,
  daysBetweenKeys,
  countDaysInclusive,
  eachHotelDayKey,
  hotelRangeToUtc,
  previousPeriodRange,
  reservationRoomNightsInRange,
  perNightLodging,
  computeOccupancyRate,
  computeAdr,
  computeRevpar,
  pctDelta,
  buildOccupancyHistogram,
  buildDailyTotals,
  buildRevenueByRoomType,
  computeWindowKpis,
  type NightlyReservation,
} from "@/lib/analytics";

const TZ = "America/Argentina/Tucuman"; // UTC-3, sin DST

function resv(partial: Partial<NightlyReservation> = {}): NightlyReservation {
  return {
    status: "confirmed",
    checkInTarget: "2026-07-10T14:00:00-03:00",
    checkOutTarget: "2026-07-13T10:00:00-03:00",
    actualCheckIn: null,
    actualCheckOut: null,
    baseTotalPrice: 30000,
    discountAmount: 0,
    roomType: "Doble",
    createdAt: "2026-07-01T12:00:00-03:00",
    ...partial,
  };
}

describe("aritmética de claves de día", () => {
  it("suma y resta días cruzando fin de mes", () => {
    expect(addDaysToDateKey("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysToDateKey("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("cuenta días entre claves e inclusive", () => {
    expect(daysBetweenKeys("2026-07-01", "2026-07-13")).toBe(12);
    expect(countDaysInclusive("2026-07-01", "2026-07-31")).toBe(31);
  });

  it("enumera todos los días del rango inclusive", () => {
    expect(eachHotelDayKey("2026-07-01", "2026-07-03")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });
});

describe("hotelRangeToUtc", () => {
  it("convierte medianoche local del hotel a UTC con fin exclusivo (UTC-3)", () => {
    const { startUtc, endUtcExclusive } = hotelRangeToUtc("2026-07-01", "2026-07-31", TZ);
    expect(startUtc).toBe("2026-07-01T00:00:00-03:00");
    // fin exclusivo = medianoche del día siguiente al último día del rango
    expect(endUtcExclusive).toBe("2026-08-01T00:00:00-03:00");
  });
});

describe("previousPeriodRange", () => {
  it("devuelve un rango previo contiguo de igual longitud", () => {
    expect(previousPeriodRange("2026-07-01", "2026-07-31")).toEqual({
      start: "2026-05-31",
      end: "2026-06-30",
    });
  });

  it("para un solo día devuelve el día anterior", () => {
    expect(previousPeriodRange("2026-07-10", "2026-07-10")).toEqual({
      start: "2026-07-09",
      end: "2026-07-09",
    });
  });
});

describe("reservationRoomNightsInRange", () => {
  const RANGE_START = "2026-07-01";
  const RANGE_END = "2026-07-31";

  it("cuenta las noches de una estadía enteramente dentro del rango", () => {
    // 10 → 13 = noches 10, 11, 12
    expect(reservationRoomNightsInRange(resv(), RANGE_START, RANGE_END, "priced", TZ)).toBe(3);
  });

  it("hace clamp cuando la estadía cruza el borde izquierdo", () => {
    const r = resv({
      checkInTarget: "2026-06-29T14:00:00-03:00",
      checkOutTarget: "2026-07-02T10:00:00-03:00", // noches 29, 30, 01 → solo 01 en rango
    });
    expect(reservationRoomNightsInRange(r, RANGE_START, RANGE_END, "priced", TZ)).toBe(1);
  });

  it("hace clamp cuando la estadía cruza el borde derecho", () => {
    const r = resv({
      checkInTarget: "2026-07-30T14:00:00-03:00",
      checkOutTarget: "2026-08-02T10:00:00-03:00", // noches 30, 31, 01-ago → 30 y 31 en rango
    });
    expect(reservationRoomNightsInRange(r, RANGE_START, RANGE_END, "priced", TZ)).toBe(2);
  });

  it("es 0 para una estadía fuera del rango", () => {
    const r = resv({
      checkInTarget: "2026-08-10T14:00:00-03:00",
      checkOutTarget: "2026-08-12T10:00:00-03:00",
    });
    expect(reservationRoomNightsInRange(r, RANGE_START, RANGE_END, "priced", TZ)).toBe(0);
  });

  it("usa el checkout target como cola cuando está hospedado sin actual_check_out (physical)", () => {
    const r = resv({
      status: "checked_in",
      actualCheckIn: "2026-07-10T15:00:00-03:00",
      actualCheckOut: null,
    });
    expect(reservationRoomNightsInRange(r, RANGE_START, RANGE_END, "physical", TZ)).toBe(3);
  });

  it("es 0 para media estadía (mismo día de entrada y salida)", () => {
    const r = resv({
      checkInTarget: "2026-07-10T13:00:00-03:00",
      checkOutTarget: "2026-07-10T17:00:00-03:00",
    });
    expect(reservationRoomNightsInRange(r, RANGE_START, RANGE_END, "priced", TZ)).toBe(0);
  });

  it("es 0 para una reserva cancelada", () => {
    expect(
      reservationRoomNightsInRange(resv({ status: "cancelled" }), RANGE_START, RANGE_END, "priced", TZ)
    ).toBe(0);
  });
});

describe("perNightLodging", () => {
  it("reparte el neto de descuento sobre las noches", () => {
    // (20000 − 2000) / 2 = 9000
    expect(perNightLodging(20000, 2000, 2)).toBe(9000);
  });

  it("evita dividir por cero (piso de 1 noche)", () => {
    expect(perNightLodging(10000, 0, 0)).toBe(10000);
  });
});

describe("ratios y deltas", () => {
  it("ocupación / ADR / RevPAR con denominador 0 dan 0", () => {
    expect(computeOccupancyRate(5, 0)).toBe(0);
    expect(computeAdr(1000, 0)).toBe(0);
    expect(computeRevpar(1000, 0)).toBe(0);
  });

  it("pctDelta calcula la variación y devuelve null sin base", () => {
    expect(pctDelta(120, 100)).toBe(20);
    expect(pctDelta(5, 0)).toBeNull();
    expect(pctDelta(0, 0)).toBeNull();
  });
});

describe("buildOccupancyHistogram", () => {
  it("suma habitaciones solapadas por día y no cuenta el día de checkout", () => {
    const r1 = resv({
      checkInTarget: "2026-07-10T14:00:00-03:00",
      checkOutTarget: "2026-07-12T10:00:00-03:00", // noches 10, 11
    });
    const r2 = resv({
      checkInTarget: "2026-07-09T14:00:00-03:00",
      checkOutTarget: "2026-07-11T10:00:00-03:00", // noches 09, 10
    });
    const cancelled = resv({
      status: "cancelled",
      checkInTarget: "2026-07-10T14:00:00-03:00",
      checkOutTarget: "2026-07-11T10:00:00-03:00",
    });

    const hist = buildOccupancyHistogram([r1, r2, cancelled], "2026-07-09", "2026-07-12", 12, TZ);
    const byDate = Object.fromEntries(hist.map((d) => [d.date, d.occupied]));

    expect(byDate["2026-07-09"]).toBe(1); // r2
    expect(byDate["2026-07-10"]).toBe(2); // r1 + r2 (cancelada no cuenta)
    expect(byDate["2026-07-11"]).toBe(1); // r1
    expect(byDate["2026-07-12"]).toBe(0); // día de checkout de r1, no cuenta
    expect(hist.find((d) => d.date === "2026-07-10")?.rate).toBeCloseTo((2 / 12) * 100);
  });
});

describe("buildDailyTotals (fix de timezone)", () => {
  it("bucketea un pago nocturno en el día del hotel, no en el UTC siguiente", () => {
    // 2026-07-10 02:00 UTC == 2026-07-09 23:00 en Argentina (UTC-3)
    const totals = buildDailyTotals(
      [{ iso: "2026-07-10T02:00:00Z", value: 5000 }],
      "2026-07-08",
      "2026-07-11",
      TZ
    );
    const byDate = Object.fromEntries(totals.map((d) => [d.date, d.total]));
    expect(byDate["2026-07-09"]).toBe(5000);
    expect(byDate["2026-07-10"]).toBe(0);
  });

  it("rellena días vacíos con 0", () => {
    const totals = buildDailyTotals([], "2026-07-01", "2026-07-03", TZ);
    expect(totals).toEqual([
      { date: "2026-07-01", total: 0 },
      { date: "2026-07-02", total: 0 },
      { date: "2026-07-03", total: 0 },
    ]);
  });
});

describe("buildRevenueByRoomType", () => {
  it("agrupa el ingreso de alojamiento devengado por tipo de habitación", () => {
    const suite = resv({
      roomType: "Suite",
      checkInTarget: "2026-07-05T14:00:00-03:00",
      checkOutTarget: "2026-07-07T10:00:00-03:00", // 2 noches
      baseTotalPrice: 40000,
    });
    const doble = resv({
      roomType: "Doble",
      checkInTarget: "2026-07-05T14:00:00-03:00",
      checkOutTarget: "2026-07-08T10:00:00-03:00", // 3 noches
      baseTotalPrice: 30000,
    });
    const result = buildRevenueByRoomType([suite, doble], "2026-07-01", "2026-07-31", TZ);
    // Ordenado por total desc: Suite 40000, Doble 30000
    expect(result).toEqual([
      { room_type: "Suite", total: 40000 },
      { room_type: "Doble", total: 30000 },
    ]);
  });
});

describe("computeWindowKpis", () => {
  it("calcula los KPIs escalares de un período", () => {
    const r1 = resv({
      checkInTarget: "2026-07-02T14:00:00-03:00",
      checkOutTarget: "2026-07-05T10:00:00-03:00", // 3 noches, todas en rango
      baseTotalPrice: 30000, // perNight 10000
      createdAt: "2026-07-01T10:00:00-03:00",
    });
    const r2 = resv({
      checkInTarget: "2026-07-08T14:00:00-03:00",
      checkOutTarget: "2026-07-12T10:00:00-03:00", // 4 noches (08..11); en rango ..10 → 08,09,10 = 3
      baseTotalPrice: 40000, // perNight 10000
      createdAt: "2026-06-20T10:00:00-03:00",
    });

    const kpis = computeWindowKpis({
      reservationsOverlap: [r1, r2],
      reservationsCreated: [
        { status: "confirmed", createdAt: "2026-07-01T10:00:00-03:00" },
        { status: "confirmed", createdAt: "2026-07-06T10:00:00-03:00" },
        { status: "cancelled", createdAt: "2026-07-04T10:00:00-03:00" },
      ],
      payments: [
        { amount: 5000, method: "cash", createdAt: "2026-07-03T12:00:00-03:00" },
        { amount: 8000, method: "cash", createdAt: "2026-07-15T12:00:00-03:00" }, // fuera de rango
      ],
      rangeStartKey: "2026-07-01",
      rangeEndKey: "2026-07-10",
      activeRooms: 10,
      tz: TZ,
    });

    expect(kpis.roomNightsSold).toBe(6); // 3 + 3
    expect(kpis.lodgingRevenue).toBe(60000); // 30000 + 30000
    expect(kpis.availableRoomNights).toBe(100); // 10 rooms × 10 días
    expect(kpis.occupancyRate).toBeCloseTo(6);
    expect(kpis.adr).toBe(10000); // 60000 / 6
    expect(kpis.revpar).toBe(600); // 60000 / 100
    expect(kpis.totalPaymentsIncome).toBe(5000); // solo el pago del 03
    expect(kpis.reservationsCreated).toBe(3);
    expect(kpis.cancellations).toBe(1);
    expect(kpis.cancellationRate).toBeCloseTo((1 / 3) * 100);
    expect(kpis.avgLengthOfStay).toBe(3.5); // (3 + 4) / 2
    expect(kpis.avgLeadTimeDays).toBe(9.5); // (1 + 18) / 2
  });

  it("no rompe con arrays vacíos", () => {
    const kpis = computeWindowKpis({
      reservationsOverlap: [],
      reservationsCreated: [],
      payments: [],
      rangeStartKey: "2026-07-01",
      rangeEndKey: "2026-07-10",
      activeRooms: 10,
      tz: TZ,
    });
    expect(kpis.occupancyRate).toBe(0);
    expect(kpis.adr).toBe(0);
    expect(kpis.cancellationRate).toBe(0);
    expect(kpis.avgLengthOfStay).toBe(0);
  });
});
