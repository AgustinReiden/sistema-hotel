import { describe, expect, it } from "vitest";

import {
  assignWalkInSchema,
  associatedClientSchema,
  checkInSchema,
  createReservationSchema,
  hotelSettingsSchema,
  publicBookingSchema,
} from "@/lib/validations";

describe("assignWalkInSchema", () => {
  const validPersonWalkIn = {
    mode: "person" as const,
    roomId: 1,
    clientFirstName: "Juan",
    clientLastName: "Perez",
    clientDni: "30123456",
    nights: 3,
  };

  it("accepts valid person input", () => {
    const result = assignWalkInSchema.parse(validPersonWalkIn);

    if (result.mode !== "person") throw new Error("Expected person mode");
    expect(result.roomId).toBe(1);
    expect(result.clientFirstName).toBe("Juan");
    expect(result.clientLastName).toBe("Perez");
    expect(result.clientDni).toBe("30123456");
    expect(result.nights).toBe(3);
  });

  it("trims person name and last name", () => {
    const result = assignWalkInSchema.parse({
      ...validPersonWalkIn,
      clientFirstName: "  Maria  ",
      clientLastName: "  Gomez  ",
      nights: 1,
    });

    if (result.mode !== "person") throw new Error("Expected person mode");
    expect(result.clientFirstName).toBe("Maria");
    expect(result.clientLastName).toBe("Gomez");
  });

  it("accepts company input with passenger", () => {
    const result = assignWalkInSchema.parse({
      mode: "company",
      roomId: 1,
      nights: 2,
      associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
      passengerName: "Maria Lopez",
      passengerDni: "30123456",
    });

    if (result.mode !== "company") throw new Error("Expected company mode");
    expect(result.associatedClientId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.passengerName).toBe("Maria Lopez");
    expect(result.passengerDni).toBe("30123456");
  });

  it("rejects company walk-in without passenger data", () => {
    expect(() =>
      assignWalkInSchema.parse({
        mode: "company",
        roomId: 1,
        nights: 1,
        associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
      })
    ).toThrow();
  });

  it("rejects empty first name in person mode", () => {
    expect(() =>
      assignWalkInSchema.parse({ ...validPersonWalkIn, clientFirstName: "" })
    ).toThrow();
  });

  it("rejects empty last name in person mode", () => {
    expect(() =>
      assignWalkInSchema.parse({ ...validPersonWalkIn, clientLastName: "" })
    ).toThrow();
  });

  it("rejects missing DNI in person mode", () => {
    expect(() =>
      assignWalkInSchema.parse({ ...validPersonWalkIn, clientDni: "" })
    ).toThrow();
  });

  it("rejects missing company id in company mode", () => {
    expect(() =>
      assignWalkInSchema.parse({
        mode: "company",
        roomId: 1,
        nights: 1,
        passengerName: "Maria Lopez",
        passengerDni: "30123456",
      })
    ).toThrow();
  });

  it("rejects 0 nights", () => {
    expect(() => assignWalkInSchema.parse({ ...validPersonWalkIn, nights: 0 })).toThrow();
  });

  it("rejects more than 30 nights", () => {
    expect(() => assignWalkInSchema.parse({ ...validPersonWalkIn, nights: 31 })).toThrow();
  });

  it("accepts half_day (siesta) stay type", () => {
    const result = assignWalkInSchema.parse({
      ...validPersonWalkIn,
      nights: 1,
      stayType: "half_day",
    });

    if (result.mode !== "person") throw new Error("Expected person mode");
    expect(result.stayType).toBe("half_day");
  });

  it("rejects an invalid stay type", () => {
    expect(() =>
      assignWalkInSchema.parse({ ...validPersonWalkIn, nights: 1, stayType: "weekly" })
    ).toThrow();
  });

  it("trims passenger data on company walk-in", () => {
    const result = assignWalkInSchema.parse({
      mode: "company",
      roomId: 1,
      nights: 1,
      associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
      passengerName: "  Maria Lopez  ",
      passengerDni: "30123456",
    });

    if (result.mode !== "company") throw new Error("Expected company mode");
    expect(result.passengerName).toBe("Maria Lopez");
    expect(result.passengerDni).toBe("30123456");
  });
});

describe("createReservationSchema", () => {
  // La reserva es PERSONA (huesped) o EMPRESA (con pasajero real).
  const validPerson = {
    mode: "person" as const,
    roomId: 1,
    clientFirstName: "Carlos",
    clientLastName: "Lopez",
    clientDni: "20-12345678-3",
    clientPhone: "3814123456",
    checkIn: "2026-04-01T14:00:00.000Z",
    checkOut: "2026-04-03T10:00:00.000Z",
  };
  const validCompany = {
    mode: "company" as const,
    roomId: 1,
    associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
    passengerName: "Juan Perez",
    passengerDni: "30123456",
    checkIn: "2026-04-01T14:00:00.000Z",
    checkOut: "2026-04-03T10:00:00.000Z",
  };

  it("accepts a person reservation", () => {
    const result = createReservationSchema.parse(validPerson);
    if (result.mode !== "person") throw new Error("Expected person mode");
    expect(result.clientFirstName).toBe("Carlos");
    expect(result.clientDni).toBe("20-12345678-3");
  });

  it("accepts an optional guestId on a person reservation", () => {
    const result = createReservationSchema.parse({
      ...validPerson,
      guestId: "550e8400-e29b-41d4-a716-446655440000",
    });
    if (result.mode !== "person") throw new Error("Expected person mode");
    expect(result.guestId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("accepts a company reservation with passenger", () => {
    const result = createReservationSchema.parse(validCompany);
    if (result.mode !== "company") throw new Error("Expected company mode");
    expect(result.associatedClientId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.passengerName).toBe("Juan Perez");
    expect(result.passengerDni).toBe("30123456");
  });

  // La empresa reserva con semanas de anticipacion sin saber a quien manda: el pasajero
  // se carga en el check-in (mig 88).
  it("accepts a company reservation without passenger data", () => {
    const result = createReservationSchema.parse({
      mode: "company",
      roomId: 1,
      associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
      passengerName: "",
      passengerDni: "",
      checkIn: "2026-04-01T14:00:00.000Z",
      checkOut: "2026-04-03T10:00:00.000Z",
    });
    if (result.mode !== "company") throw new Error("Expected company mode");
    expect(result.passengerName).toBeUndefined();
    expect(result.passengerDni).toBeUndefined();
  });

  it("rejects a company reservation with a passenger name but no dni", () => {
    expect(() =>
      createReservationSchema.parse({
        mode: "company",
        roomId: 1,
        associatedClientId: "550e8400-e29b-41d4-a716-446655440000",
        passengerName: "Juan Perez",
        checkIn: "2026-04-01T14:00:00.000Z",
        checkOut: "2026-04-03T10:00:00.000Z",
      })
    ).toThrow();
  });

  it("rejects a company reservation without company id", () => {
    expect(() =>
      createReservationSchema.parse({
        mode: "company",
        roomId: 1,
        passengerName: "Juan Perez",
        passengerDni: "30123456",
        checkIn: "2026-04-01T14:00:00.000Z",
        checkOut: "2026-04-03T10:00:00.000Z",
      })
    ).toThrow();
  });

  it("allows empty optional phone on a person reservation", () => {
    const result = createReservationSchema.parse({ ...validPerson, clientPhone: "" });
    if (result.mode !== "person") throw new Error("Expected person mode");
    expect(result.clientPhone).toBeUndefined();
  });

  it("rejects missing name or DNI on a person reservation", () => {
    expect(() => createReservationSchema.parse({ ...validPerson, clientDni: "" })).toThrow();
    expect(() => createReservationSchema.parse({ ...validPerson, clientFirstName: "" })).toThrow();
    expect(() => createReservationSchema.parse({ ...validPerson, clientLastName: "" })).toThrow();
  });

  it("rejects checkOut before checkIn", () => {
    expect(() =>
      createReservationSchema.parse({
        ...validPerson,
        checkIn: "2026-04-05T14:00:00.000Z",
        checkOut: "2026-04-03T10:00:00.000Z",
      })
    ).toThrow();
  });

  it("rejects invalid date format", () => {
    expect(() =>
      createReservationSchema.parse({ ...validPerson, checkIn: "not-a-date" })
    ).toThrow();
  });
});

// Check-in: en una reserva de empresa es donde se identifica al humano que entra (mig 88).
describe("checkInSchema", () => {
  const reservationId = "550e8400-e29b-41d4-a716-446655440000";

  it("accepts a check-in with only the reservation id", () => {
    const result = checkInSchema.parse({ reservationId });
    expect(result.reservationId).toBe(reservationId);
    expect(result.passengerName).toBeUndefined();
    expect(result.passengerDni).toBeUndefined();
  });

  it("accepts a check-in with the company passenger", () => {
    const result = checkInSchema.parse({
      reservationId,
      companyPassengerId: "550e8400-e29b-41d4-a716-446655440001",
      passengerName: "Juan Perez",
      passengerDni: "30123456",
      passengerPhone: "3814123456",
      guestLocality: "Salta",
    });
    expect(result.passengerName).toBe("Juan Perez");
    expect(result.passengerDni).toBe("30123456");
    expect(result.companyPassengerId).toBe("550e8400-e29b-41d4-a716-446655440001");
    expect(result.guestLocality).toBe("Salta");
  });

  it("rejects half a passenger", () => {
    expect(() => checkInSchema.parse({ reservationId, passengerName: "Juan Perez" })).toThrow();
    expect(() => checkInSchema.parse({ reservationId, passengerDni: "30123456" })).toThrow();
  });

  it("rejects an invalid reservation id", () => {
    expect(() => checkInSchema.parse({ reservationId: "no-es-uuid" })).toThrow();
  });
});

describe("associatedClientSchema", () => {
  // CUIT real y valido (el del hotel). El de antes, 30-12345678-9, no pasa el
  // modulo 11: desde la mig 94 el schema lo valida de verdad.
  const CUIT_VALIDO = "30-70705453-7";

  it("accepts valid associated client input", () => {
    const result = associatedClientSchema.parse({
      displayName: "Empresa Uno",
      documentId: CUIT_VALIDO,
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
        documentId: CUIT_VALIDO,
        discountPercent: 101,
      })
    ).toThrow();
  });

  // Los tres casos que en PROD dejaron cuentas sin poder facturar (mig 94).
  it("rechaza un CUIT con el digito verificador mal", () => {
    expect(() =>
      associatedClientSchema.parse({
        displayName: "JUFEC - DROGUERIA",
        documentId: "30629421462", // el de PERFUMERIA con el ultimo digito cambiado
        discountPercent: 0,
      })
    ).toThrow();
  });

  it("rechaza un CUIT de 12 o 13 digitos", () => {
    expect(() =>
      associatedClientSchema.parse({
        displayName: "COMPANIA LA LEGUA SA",
        documentId: "30-7070916787-8",
        discountPercent: 0,
      })
    ).toThrow();
  });

  it("acepta un DNI de 7 u 8 digitos: no todo asociado es una empresa", () => {
    for (const dni of ["1234567", "30123456"]) {
      const result = associatedClientSchema.parse({
        displayName: "Persona",
        documentId: dni,
        discountPercent: 0,
      });
      expect(result.documentId).toBe(dni);
    }
  });

  it("la razon social es opcional y cae a undefined si esta vacia", () => {
    const vacia = associatedClientSchema.parse({
      displayName: "Empresa",
      documentId: CUIT_VALIDO,
      discountPercent: 0,
      razonSocial: "   ",
    });
    expect(vacia.razonSocial).toBeUndefined();

    const cargada = associatedClientSchema.parse({
      displayName: "JUFEC - DROGUERIA",
      documentId: CUIT_VALIDO,
      discountPercent: 0,
      razonSocial: "  JUFEC S.A.  ",
    });
    expect(cargada.razonSocial).toBe("JUFEC S.A.");
  });
});

describe("publicBookingSchema", () => {
  // Fechas dinamicas: el schema ahora valida futuro/horizonte contra la fecha real.
  const isoDay = (daysAhead: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  };
  const validInput = {
    roomType: "Doble",
    clientName: "Ana Garcia",
    clientDni: "12345678",
    phoneCountryCode: "54",
    phoneLocal: "3814123456",
    checkIn: isoDay(10),
    checkOut: isoDay(12),
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

  it("rejects checkOut on or before checkIn", () => {
    expect(() =>
      publicBookingSchema.parse({ ...validInput, checkIn: isoDay(10), checkOut: isoDay(10) })
    ).toThrow();
  });

  it("rejects stays longer than 30 nights", () => {
    expect(() =>
      publicBookingSchema.parse({ ...validInput, checkIn: isoDay(5), checkOut: isoDay(40) })
    ).toThrow();
  });

  it("accepts a 30-night stay (boundary)", () => {
    const result = publicBookingSchema.parse({ ...validInput, checkIn: isoDay(5), checkOut: isoDay(35) });
    expect(result.roomType).toBe("Doble");
  });

  it("rejects bookings more than a year ahead", () => {
    expect(() =>
      publicBookingSchema.parse({ ...validInput, checkIn: isoDay(400), checkOut: isoDay(402) })
    ).toThrow();
  });

  it("rejects past check-in dates", () => {
    expect(() =>
      publicBookingSchema.parse({ ...validInput, checkIn: isoDay(-5), checkOut: isoDay(2) })
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
