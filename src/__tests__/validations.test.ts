import { describe, expect, it } from "vitest";

import {
  assignWalkInSchema,
  associatedClientSchema,
  createReservationSchema,
  hotelSettingsSchema,
  publicBookingSchema,
} from "@/lib/validations";

describe("assignWalkInSchema", () => {
  it("accepts valid manual input", () => {
    const result = assignWalkInSchema.parse({
      customerMode: "manual",
      roomId: 1,
      clientName: "Juan Perez",
      nights: 3,
    });

    expect(result.customerMode).toBe("manual");
    if (result.customerMode !== "manual") throw new Error("Expected manual mode");
    expect(result.roomId).toBe(1);
    expect(result.clientName).toBe("Juan Perez");
    expect(result.nights).toBe(3);
  });

  it("trims manual client name", () => {
    const result = assignWalkInSchema.parse({
      customerMode: "manual",
      roomId: 1,
      clientName: "  Maria  ",
      nights: 1,
    });

    if (result.customerMode !== "manual") throw new Error("Expected manual mode");
    expect(result.clientName).toBe("Maria");
  });

  it("accepts associated input", () => {
    const result = assignWalkInSchema.parse({
      customerMode: "associated",
      roomId: 1,
      nights: 2,
      associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.customerMode).toBe("associated");
    if (result.customerMode !== "associated") throw new Error("Expected associated mode");
    expect(result.associatedClientId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects empty client name in manual mode", () => {
    expect(() =>
      assignWalkInSchema.parse({
        customerMode: "manual",
        roomId: 1,
        clientName: "",
        nights: 1,
      })
    ).toThrow();
  });

  it("rejects missing associated id in associated mode", () => {
    expect(() =>
      assignWalkInSchema.parse({
        customerMode: "associated",
        roomId: 1,
        nights: 1,
      })
    ).toThrow();
  });

  it("rejects 0 nights", () => {
    expect(() =>
      assignWalkInSchema.parse({
        customerMode: "manual",
        roomId: 1,
        clientName: "Test",
        nights: 0,
      })
    ).toThrow();
  });

  it("rejects more than 30 nights", () => {
    expect(() =>
      assignWalkInSchema.parse({
        customerMode: "manual",
        roomId: 1,
        clientName: "Test",
        nights: 31,
      })
    ).toThrow();
  });
});

describe("createReservationSchema", () => {
  const validManualInput = {
    customerMode: "manual" as const,
    roomId: 1,
    clientName: "Carlos Lopez",
    clientDni: "20-12345678-3",
    clientPhone: "3814123456",
    checkIn: "2026-04-01T14:00:00.000Z",
    checkOut: "2026-04-03T10:00:00.000Z",
  };

  it("accepts valid manual reservation data", () => {
    const result = createReservationSchema.parse(validManualInput);
    expect(result.customerMode).toBe("manual");
    if (result.customerMode !== "manual") throw new Error("Expected manual mode");
    expect(result.roomId).toBe(1);
    expect(result.clientName).toBe("Carlos Lopez");
    expect(result.clientDni).toBe("20-12345678-3");
  });

  it("accepts associated reservation data", () => {
    const result = createReservationSchema.parse({
      customerMode: "associated",
      roomId: 1,
      associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
      checkIn: "2026-04-01T14:00:00.000Z",
      checkOut: "2026-04-03T10:00:00.000Z",
    });

    expect(result.customerMode).toBe("associated");
    if (result.customerMode !== "associated") throw new Error("Expected associated mode");
    expect(result.associatedClientId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("allows empty optional phone", () => {
    const result = createReservationSchema.parse({
      ...validManualInput,
      clientPhone: "",
    });

    if (result.customerMode !== "manual") throw new Error("Expected manual mode");
    expect(result.clientPhone).toBeUndefined();
  });

  it("rejects missing DNI or CUIT in manual mode", () => {
    expect(() =>
      createReservationSchema.parse({
        ...validManualInput,
        clientDni: "",
      })
    ).toThrow();
  });

  it("rejects short optional phone when provided", () => {
    expect(() =>
      createReservationSchema.parse({
        ...validManualInput,
        clientPhone: "123",
      })
    ).toThrow();
  });

  it("rejects missing associated id in associated mode", () => {
    expect(() =>
      createReservationSchema.parse({
        customerMode: "associated",
        roomId: 1,
        checkIn: "2026-04-01T14:00:00.000Z",
        checkOut: "2026-04-03T10:00:00.000Z",
      })
    ).toThrow();
  });

  it("rejects checkOut before checkIn", () => {
    expect(() =>
      createReservationSchema.parse({
        ...validManualInput,
        checkIn: "2026-04-05T14:00:00.000Z",
        checkOut: "2026-04-03T10:00:00.000Z",
      })
    ).toThrow();
  });

  it("rejects invalid date format", () => {
    expect(() =>
      createReservationSchema.parse({ ...validManualInput, checkIn: "not-a-date" })
    ).toThrow();
  });
});

describe("associatedClientSchema", () => {
  it("accepts valid associated client input", () => {
    const result = associatedClientSchema.parse({
      displayName: "Empresa Uno",
      documentId: "30-12345678-9",
      phone: "+54 381 4123456",
      discountPercent: "12.5",
      notes: "Tarifa corporativa",
    });

    expect(result.displayName).toBe("Empresa Uno");
    expect(result.discountPercent).toBe(12.5);
  });

  it("rejects discount above 100", () => {
    expect(() =>
      associatedClientSchema.parse({
        displayName: "Empresa Dos",
        documentId: "30-12345678-9",
        discountPercent: 101,
      })
    ).toThrow();
  });
});

describe("publicBookingSchema", () => {
  const validInput = {
    roomType: "Doble",
    clientName: "Ana Garcia",
    clientDni: "12345678",
    phoneCountryCode: "54",
    phoneLocal: "3814123456",
    checkIn: "2026-05-01",
    checkOut: "2026-05-03",
  };

  it("accepts valid public booking data", () => {
    const result = publicBookingSchema.parse(validInput);
    expect(result.roomType).toBe("Doble");
    expect(result.clientName).toBe("Ana Garcia");
    expect(result.clientDni).toBe("12345678");
    expect(result.phoneCountryCode).toBe("54");
    expect(result.phoneLocal).toBe("3814123456");
  });

  it("accepts brazilian country code", () => {
    const result = publicBookingSchema.parse({
      ...validInput,
      phoneCountryCode: "55",
      phoneLocal: "11987654321",
    });
    expect(result.phoneCountryCode).toBe("55");
  });

  it("rejects short DNI", () => {
    expect(() => publicBookingSchema.parse({ ...validInput, clientDni: "123" })).toThrow();
  });

  it("rejects short phone local part", () => {
    expect(() => publicBookingSchema.parse({ ...validInput, phoneLocal: "123" })).toThrow();
  });

  it("rejects phone with non-digit chars", () => {
    expect(() =>
      publicBookingSchema.parse({ ...validInput, phoneLocal: "abc12345678" })
    ).toThrow();
  });

  it("rejects unsupported country code", () => {
    expect(() =>
      publicBookingSchema.parse({ ...validInput, phoneCountryCode: "1" })
    ).toThrow();
  });
});

describe("hotelSettingsSchema", () => {
  const validSettings = {
    name: "El Refugio",
    standard_check_in_time: "14:00",
    standard_check_out_time: "10:00",
    late_check_out_time: "18:00",
    timezone: "America/Argentina/Tucuman",
    currency: "ars",
    contact_email: "info@hotel.com",
    contact_phone: "+54 381 4000000",
    contact_whatsapp_phone: "+54 381 4000000",
    contact_fixed_phone: "+54 381 4000001",
    address: "Ruta Nacional 16, Taco Pozo",
    hero_title: "Tu refugio en el camino",
    hero_subtitle: "Descanso y servicios de ruta",
  };

  it("accepts valid settings and uppercases currency", () => {
    const result = hotelSettingsSchema.parse(validSettings);
    expect(result.currency).toBe("ARS");
    expect(result.name).toBe("El Refugio");
  });

  it("rejects invalid currency format", () => {
    expect(() =>
      hotelSettingsSchema.parse({ ...validSettings, currency: "PESOS" })
    ).toThrow();
  });

  it("accepts HH:MM:SS time format", () => {
    const result = hotelSettingsSchema.parse({
      ...validSettings,
      standard_check_in_time: "14:00:00",
    });
    expect(result.standard_check_in_time).toBe("14:00:00");
  });
});
