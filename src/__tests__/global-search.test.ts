import { describe, expect, it } from "vitest";

import {
  buildClientSummary,
  classifySearchTerm,
  matchesClient,
  matchesRoomNumber,
  normalizeSearchText,
  shapeGlobalSearch,
  summarizeStays,
  type ClientFacts,
  type GlobalSearchMatches,
} from "@/lib/global-search";

/**
 * Buscador global (F1-5a): las reglas puras con las que el servidor decide qué
 * buscar, qué coincide y qué se le muestra a cada rol. Datos ficticios.
 */

describe("normalizeSearchText", () => {
  it("ignora mayúsculas, tildes y espacios de más", () => {
    expect(normalizeSearchText("JOSÉ  Pérez")).toBe(normalizeSearchText("jose perez"));
    expect(normalizeSearchText("  Juan   Prueba ")).toBe("juan prueba");
  });

  it("tolera null", () => {
    expect(normalizeSearchText(null)).toBe("");
  });
});

describe("classifySearchTerm", () => {
  it("un DNI con puntos es un DNI con sus dígitos", () => {
    expect(classifySearchTerm("30.123.456")).toEqual({ kind: "dni", value: "30123456" });
    expect(classifySearchTerm("30123456")).toEqual({ kind: "dni", value: "30123456" });
    expect(classifySearchTerm("1.234.567")).toEqual({ kind: "dni", value: "1234567" });
  });

  it("un CUIT con o sin guiones es un CUIT", () => {
    expect(classifySearchTerm("20-30123456-7")).toEqual({ kind: "cuit", value: "20301234567" });
    expect(classifySearchTerm("20301234567")).toEqual({ kind: "cuit", value: "20301234567" });
  });

  it("hasta 3 dígitos es una habitación", () => {
    expect(classifySearchTerm("7")).toEqual({ kind: "habitacion", value: "7" });
    expect(classifySearchTerm("12")).toEqual({ kind: "habitacion", value: "12" });
    expect(classifySearchTerm("hab 3")).toEqual({ kind: "habitacion", value: "3" });
    expect(classifySearchTerm("Habitación 10")).toEqual({ kind: "habitacion", value: "10" });
  });

  it("otros números buscan dentro del documento", () => {
    expect(classifySearchTerm("3012")).toEqual({ kind: "numero", value: "3012" });
  });

  it("el texto se normaliza", () => {
    expect(classifySearchTerm("  Pérez ")).toEqual({ kind: "texto", value: "perez" });
  });

  it("con una letra, o nada, no busca", () => {
    expect(classifySearchTerm("p")).toBeNull();
    expect(classifySearchTerm("   ")).toBeNull();
    expect(classifySearchTerm("")).toBeNull();
  });
});

describe("matchesClient", () => {
  const persona = { nombre: "Juan Prueba", documento: "30.123.456" };
  const empresa = { nombre: "Empresa Ficticia SA", documento: "30-12345678-1", otrosNombres: ["Ficticia Servicios SRL"] };

  it("un DNI con o sin puntos encuentra a la persona", () => {
    expect(matchesClient(persona, classifySearchTerm("30.123.456")!)).toBe(true);
    expect(matchesClient(persona, classifySearchTerm("30123456")!)).toBe(true);
    expect(matchesClient({ ...persona, documento: "30123456" }, classifySearchTerm("30.123.456")!)).toBe(true);
    expect(matchesClient(persona, classifySearchTerm("30123457")!)).toBe(false);
  });

  it("un CUIT con o sin guiones encuentra a la empresa", () => {
    expect(matchesClient(empresa, classifySearchTerm("30-12345678-1")!)).toBe(true);
    expect(matchesClient(empresa, classifySearchTerm("30123456781")!)).toBe(true);
    expect(matchesClient({ ...empresa, documento: "30123456781" }, classifySearchTerm("30-12345678-1")!)).toBe(true);
    expect(matchesClient(empresa, classifySearchTerm("30-12345679-1")!)).toBe(false);
  });

  it("el CUIT de una persona encuentra su DNI y al revés", () => {
    expect(matchesClient(persona, classifySearchTerm("20-30123456-3")!)).toBe(true);
    expect(matchesClient({ nombre: "Juan Prueba", documento: "20-30123456-3" }, classifySearchTerm("30.123.456")!)).toBe(true);
  });

  it("por nombre, sin importar tildes ni el orden de las palabras", () => {
    expect(matchesClient({ nombre: "José Pérez" }, classifySearchTerm("perez jose")!)).toBe(true);
    expect(matchesClient({ nombre: "José Pérez" }, classifySearchTerm("per")!)).toBe(true);
    expect(matchesClient({ nombre: "José Pérez" }, classifySearchTerm("gomez")!)).toBe(false);
  });

  it("una empresa también por su razón social", () => {
    expect(matchesClient(empresa, classifySearchTerm("servicios")!)).toBe(true);
  });

  it("un número de habitación no busca personas", () => {
    expect(matchesClient({ nombre: "Juan 7", documento: "7" }, classifySearchTerm("7")!)).toBe(false);
  });
});

describe("matchesRoomNumber", () => {
  it("encuentra la habitación por número y las que empiezan igual", () => {
    expect(matchesRoomNumber("7", "7")).toBe(true);
    expect(matchesRoomNumber("10", "1")).toBe(true);
    expect(matchesRoomNumber("2", "1")).toBe(false);
    expect(matchesRoomNumber("07", "7")).toBe(true);
  });
});

describe("summarizeStays", () => {
  const ahora = new Date("2026-10-02T15:00:00Z");

  it("la reserva activa es la estadía en curso y la última estadía es el último check-out", () => {
    const resumen = summarizeStays(
      [
        { status: "checked_out", check_in_target: "2026-08-01T17:00:00Z", check_out_target: "2026-08-03T13:00:00Z", room_number: "4" },
        { status: "checked_out", check_in_target: "2026-09-10T17:00:00Z", check_out_target: "2026-09-12T13:00:00Z", room_number: "7" },
        { status: "checked_in", check_in_target: "2026-10-01T17:00:00Z", check_out_target: "2026-10-04T13:00:00Z", room_number: "3" },
        { status: "cancelled", check_in_target: "2026-10-01T17:00:00Z", check_out_target: "2026-10-04T13:00:00Z", room_number: "9" },
      ],
      ahora
    );
    expect(resumen.reservaActiva).toEqual({
      estado: "checked_in",
      habitacion: "3",
      entrada: "2026-10-01T17:00:00Z",
      salida: "2026-10-04T13:00:00Z",
    });
    expect(resumen.ultimaEstadia).toEqual({ salida: "2026-09-12T13:00:00Z", habitacion: "7" });
  });

  it("sin estadía en curso, la reserva confirmada más próxima que no venció", () => {
    const resumen = summarizeStays(
      [
        { status: "confirmed", check_in_target: "2026-11-01T17:00:00Z", check_out_target: "2026-11-03T13:00:00Z", room_number: "5" },
        { status: "confirmed", check_in_target: "2026-10-10T17:00:00Z", check_out_target: "2026-10-12T13:00:00Z", room_number: "6" },
        { status: "confirmed", check_in_target: "2026-09-01T17:00:00Z", check_out_target: "2026-09-02T13:00:00Z", room_number: "8" },
      ],
      ahora
    );
    expect(resumen.reservaActiva?.habitacion).toBe("6");
    expect(resumen.ultimaEstadia).toBeNull();
  });
});

describe("buildClientSummary", () => {
  const base: ClientFacts = {
    descuento: 10,
    saldoCuenta: null,
    ultimaEstadia: null,
    reservaActiva: null,
  };

  it("con saldo 0 dice que no debe", () => {
    const resumen = buildClientSummary({ ...base, saldoCuenta: 0 }, { conMonto: true });
    expect(resumen.debe).toBe(false);
    expect(resumen.saldoTexto).toBe("No debe");
  });

  it("con saldo dice que debe, con el monto para el admin", () => {
    const resumen = buildClientSummary({ ...base, saldoCuenta: 1500 }, { conMonto: true });
    expect(resumen.debe).toBe(true);
    expect(resumen.saldo).toBe(1500);
    expect(resumen.saldoTexto).toContain("Debe");
    expect(resumen.saldoTexto).toContain("1.500");
    expect(resumen.saldoTexto).toContain("cuenta corriente");
  });

  it("sin monto (recepción) dice solo que debe", () => {
    const resumen = buildClientSummary({ ...base, saldoCuenta: 1500 }, { conMonto: false });
    expect(resumen.debe).toBe(true);
    expect(resumen.saldo).toBeNull();
    expect(resumen.saldoTexto).toBe("Debe");
  });

  it("si no opera a cuenta no menciona la cuenta corriente", () => {
    const resumen = buildClientSummary(base, { conMonto: true });
    expect(resumen.debe).toBeNull();
    expect(resumen.saldo).toBeNull();
    expect(resumen.saldoTexto).toBeNull();
    expect(JSON.stringify(resumen)).not.toMatch(/cuenta corriente|Debe/);
  });

  it("un saldo a favor no es deuda", () => {
    const resumen = buildClientSummary({ ...base, saldoCuenta: -200 }, { conMonto: true });
    expect(resumen.debe).toBe(false);
    expect(resumen.saldoTexto).toBe("No debe");
  });

  it("pasa el descuento y las estadías tal cual", () => {
    const resumen = buildClientSummary(
      {
        ...base,
        ultimaEstadia: { salida: "2026-09-12T13:00:00Z", habitacion: "7" },
        reservaActiva: { estado: "confirmed", habitacion: "6", entrada: "2026-10-10T17:00:00Z", salida: "2026-10-12T13:00:00Z" },
      },
      { conMonto: false }
    );
    expect(resumen.descuento).toBe(10);
    expect(resumen.ultimaEstadia?.habitacion).toBe("7");
    expect(resumen.reservaActiva?.habitacion).toBe("6");
  });
});

describe("shapeGlobalSearch", () => {
  const matches: GlobalSearchMatches = {
    habitaciones: [
      { key: "habitacion:7", numero: "7", estado: "occupied", alojado: { nombre: "Juan Prueba", entrada: "2026-10-01T17:00:00Z", salida: "2026-10-04T13:00:00Z" } },
    ],
    huespedes: [
      {
        kind: "huesped",
        key: "huesped:g1",
        nombre: "Juan Prueba",
        detalle: "Doc. 30.123.456",
        filtro: "30.123.456",
        facts: { descuento: 10, saldoCuenta: 1500, ultimaEstadia: null, reservaActiva: null },
      },
    ],
    empresas: [
      {
        kind: "empresa",
        key: "empresa:c1",
        nombre: "Empresa Ficticia SA",
        detalle: "CUIT 30-12345678-1",
        filtro: "30-12345678-1",
        facts: { descuento: 15, saldoCuenta: null, ultimaEstadia: null, reservaActiva: null },
      },
    ],
    pasajeros: [],
  };

  it("para recepción no hay montos ni links", () => {
    const result = shapeGlobalSearch(matches, { esAdmin: false });
    const json = JSON.stringify(result);
    expect(json).not.toContain("href");
    expect(json).not.toContain("1500");
    expect(result.huespedes[0].resumen?.debe).toBe(true);
    expect(result.huespedes[0].resumen?.saldoTexto).toBe("Debe");
    expect(result.habitaciones[0].titulo).toBe("Habitación 7");
    expect(result.habitaciones[0].detalle).toContain("Juan Prueba");
  });

  it("el admin recibe el monto y los links con el filtro puesto", () => {
    const result = shapeGlobalSearch(matches, { esAdmin: true });
    const huesped = result.huespedes[0];
    expect(huesped.resumen?.saldo).toBe(1500);
    expect(huesped.href).toBe("/admin/guests?view=directorio&q=30.123.456");
    expect(huesped.hrefCuenta).toBe("/admin/cuentas");
    const empresa = result.empresas[0];
    expect(empresa.href).toBe("/admin/asociados?q=30-12345678-1");
    expect(empresa.hrefCuenta).toBeUndefined();
  });
});
