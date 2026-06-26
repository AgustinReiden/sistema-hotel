import { describe, expect, it } from "vitest";

import {
  assignWalkInSchema,
  associatedClientSchema,
  createReservationSchema,
  hotelSettingsSchema,
  publicBookingSchema,
} from "@/lib/validations";

describe("assignWalkInSchema", () => {
  // Flujo unico (igual que createReservationSchema): el huesped (persona) es siempre obligatorio;
  // la empresa/convenio es opcional. Se suma lo propio del walk-in (noches + tipo de estadia).
  const validWalkIn = {
    roomId: 1,
    clientFirstName: "Juan",
    clientLastName: "Perez",
    clientDni: "30123456",
    nights: 3,
  };

  it("accepts a guest-only walk-in (sin empresa)", () => {
    const result = assignWalkInSchema.parse(validWalkIn);

    expect(result.roomId).toBe(1);
    expect(result.clientFirstName).toBe("Juan");
    expect(result.clientLastName).toBe("Perez");
    expect(result.clientDni).toBe("30123456");
    expect(result.nights).toBe(3);
    expect(result.associatedClientId).toBeUndefined();
  });

  it("trims name and last name", () => {
    const result = assignWalkInSchema.parse({
      ...validWalkIn,
      clientFirstName: "  Maria  ",
      clientLastName: "  Gomez  ",
      nights: 1,
    });

    expect(result.clientFirstName).toBe("Maria");
    expect(result.clientLastName).toBe("Gomez");
  });

  it("accepts an optional empresa/convenio (associatedClientId)", () => {
    const result = assignWalkInSchema.parse({
      ...validWalkIn,
      nights: 2,
      associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.associatedClientId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("accepts an optional guestId (huesped del padron)", () => {
    const result = assignWalkInSchema.parse({
      ...validWalkIn,
      guestId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.guestId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("treats empty associatedClientId as undefined", () => {
    const result = assignWalkInSchema.parse({ ...validWalkIn, associatedClientId: "" });
    expect(result.associatedClientId).toBeUndefined();
  });

  it("rejects an invalid associatedClientId", () => {
    expect(() =>
      assignWalkInSchema.parse({ ...validWalkIn, associatedClientId: "not-a-uuid" })
    ).toThrow();
  });

  it("allows empty optional phone", () => {
    const result = assignWalkInSchema.parse({ ...validWalkIn, clientPhone: "" });
    expect(result.clientPhone).toBeUndefined();
  });

  it("rejects missing name or DNI (la persona es obligatoria)", () => {
    expect(() => assignWalkInSchema.parse({ ...validWalkIn, clientFirstName: "" })).toThrow();
    expect(() => assignWalkInSchema.parse({ ...validWalkIn, clientLastName: "" })).toThrow();
    expect(() => assignWalkInSchema.parse({ ...validWalkIn, clientDni: "" })).toThrow();
  });

  it("rejects 0 nights", () => {
    expect(() => assignWalkInSchema.parse({ ...validWalkIn, nights: 0 })).toThrow();
  });

  it("rejects more than 30 nights", () => {
    expect(() => assignWalkInSchema.parse({ ...validWalkIn, nights: 31 })).toThrow();
  });

  it("accepts half_day (siesta) stay type", () => {
    const result = assignWalkInSchema.parse({
      ...validWalkIn,
      nights: 1,
      stayType: "half_day",
    });

    expect(result.stayType).toBe("half_day");
  });

  it("rejects an invalid stay type", () => {
    expect(() =>
      assignWalkInSchema.parse({ ...validWalkIn, nights: 1, stayType: "weekly" })
    ).toThrow();
  });
});

describe("createReservationSchema", () => {
  // Flujo unico: el huesped (persona) es siempre obligatorio; la empresa/convenio es opcional.
  const validInput = {
    roomId: 1,
    clientFirstName: "Carlos",
    clientLastName: "Lopez",
    clientDni: "20-12345678-3",
    clientPhone: "3814123456",
    checkIn: "2026-04-01T14:00:00.000Z",
    checkOut: "2026-04-03T10:00:00.000Z",
  };

  it("accepts a guest-only reservation (sin empresa)", () => {
    const result = createReservationSchema.parse(validInput);
    expect(result.roomId).toBe(1);
    expect(result.clientFirstName).toBe("Carlos");
    expect(result.clientLastName).toBe("Lopez");
    expect(result.clientDni).toBe("20-12345678-3");
    expect(result.associatedClientId).toBeUndefined();
  });

  it("accepts an optional empresa/convenio (associatedClientId)", () => {
    const result = createReservationSchema.parse({
      ...validInput,
      associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.associatedClientId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("accepts an optional guestId (huesped del padron)", () => {
    const result = createReservationSchema.parse({
      ...validInput,
      guestId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.guestId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("treats empty associatedClientId as undefined", () => {
    const result = createReservationSchema.parse({ ...validInput, associatedClientId: "" });
    expect(result.associatedClientId).toBeUndefined();
  });

  it("rejects an invalid associatedClientId", () => {
    expect(() =>
      createReservationSchema.parse({ ...validInput, associatedClientId: "not-a-uuid" })
    ).toThrow();
  });

  it("allows empty optional phone", () => {
    const result = createReservationSchema.parse({ ...validInput, clientPhone: "" });
    expect(result.clientPhone).toBeUndefined();
  });

  it("rejects missing name or DNI (la persona es obligatoria)", () => {
    expect(() => createReservationSchema.parse({ ...validInput, clientDni: "" })).toThrow();
    expect(() => createReservationSchema.parse({ ...validInput, clientFirstName: "" })).toThrow();
    expect(() => createReservationSchema.parse({ ...validInput, clientLastName: "" })).toThrow();
  });

  it("rejects short optional phone when provided", () => {
    expect(() =>
      createReservationSchema.parse({ ...validInput, clientPhone: "123" })
    ).toThrow();
  });

  it("rejects checkOut before checkIn", () => {
    expect(() =>
      createReservationSchema.parse({
        ...validInput,
        checkIn: "2026-04-05T14:00:00.000Z",
        checkOut: "2026-04-03T10:00:00.000Z",
      })
    ).toThrow();
  });

  it("rejects invalid date format", () => {
    expect(() =>
      createReservationSchema.parse({ ...validInput, checkIn: "not-a-date" })
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
    confirmation_message_template: "Hola {nombre}, tu reserva está confirmada.",
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

  it("accepts empty public contact fields as null", () => {
    const result = hotelSettingsSchema.parse({
      ...validSettings,
      contact_email: "",
      contact_phone: "",
      contact_whatsapp_phone: "",
      contact_fixed_phone: "",
      contact_instagram: "",
      address: "",
      confirmation_message_template: "",
    });

    expect(result.contact_email).toBeNull();
    expect(result.contact_phone).toBeNull();
    expect(result.contact_whatsapp_phone).toBeNull();
    expect(result.contact_fixed_phone).toBeNull();
    expect(result.contact_instagram).toBeNull();
    expect(result.address).toBeNull();
    expect(result.confirmation_message_template).toBeNull();
  });

  it("rejects invalid contact email when provided", () => {
    expect(() =>
      hotelSettingsSchema.parse({ ...validSettings, contact_email: "info-hotel" })
    ).toThrow();
  });

  it("rejects invalid contact phone when provided", () => {
    expect(() =>
      hotelSettingsSchema.parse({ ...validSettings, contact_whatsapp_phone: "abcde" })
    ).toThrow();
  });
});
