import { describe, expect, it } from "vitest";

import { buildCheckoutCsv } from "@/lib/csv";
import type { CheckoutExportRow } from "@/lib/types";

const TZ = "America/Argentina/Tucuman";

function row(partial: Partial<CheckoutExportRow> = {}): CheckoutExportRow {
  return {
    actual_check_out: "2026-07-03T10:30:00-03:00",
    client_name: "Juan Pérez",
    client_dni: "30123456",
    total_price: 50000,
    payment_method: "cash",
    shift_number: 42,
    ...partial,
  };
}

describe("buildCheckoutCsv", () => {
  it("incluye la columna Turno al final con el nº de cierre formateado", () => {
    const csv = buildCheckoutCsv([row()], TZ);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    // El header conserva el orden de columnas que el importador mapea por posición.
    expect(lines[0]).toBe("Fecha;Hora;Cliente;Cod. Cliente;Monto;Forma de pago;Turno");
    const fields = lines[1].split(";");
    expect(fields[0]).toBe("03/07/2026");
    expect(fields[1]).toMatch(/^10:30/); // "10:30" o "10:30 a. m." según ICU
    expect(fields.slice(2)).toEqual(["Juan Pérez", "30123456", "50000,00", "Efectivo", "000042"]);
  });

  it("mantiene el BOM UTF-8 al inicio", () => {
    const csv = buildCheckoutCsv([], TZ);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("escapa campos con punto y coma o comillas", () => {
    const csv = buildCheckoutCsv(
      [row({ client_name: 'Empresa "El Sol"; Sucursal Norte' })],
      TZ
    );
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain('"Empresa ""El Sol""; Sucursal Norte"');
    // Y aun así la fila termina con la columna Turno.
    expect(lines[1].endsWith(";000042")).toBe(true);
  });

  it("etiqueta 'Sin cobro' y monto con coma decimal", () => {
    const csv = buildCheckoutCsv(
      [row({ payment_method: "sin_cobro", total_price: 1234.5, shift_number: 7 })],
      TZ
    );
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain(";1234,50;Sin cobro;000007");
  });

  it("neutraliza inyección de fórmulas en Cliente (= + - @ TAB CR) anteponiendo apóstrofo", () => {
    for (const prefix of ["=", "+", "-", "@", "\t", "\r"]) {
      const csv = buildCheckoutCsv([row({ client_name: `${prefix}HYPERLINK("http://evil")` })], TZ);
      const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
      // El campo Cliente arranca con apóstrofo (o comilla de quoting seguida de apóstrofo).
      const cliente = fields[2];
      expect(cliente.replace(/^"/, "").startsWith("'")).toBe(true);
    }
  });

  it("neutraliza fórmulas también en Cod. Cliente (DNI)", () => {
    const csv = buildCheckoutCsv([row({ client_dni: "=1+1" })], TZ);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[3].replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("no toca nombres/DNI legítimos: quedan byte-idénticos", () => {
    const csv = buildCheckoutCsv([row({ client_name: "Juan Pérez", client_dni: "30123456" })], TZ);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[2]).toBe("Juan Pérez");
    expect(fields[3]).toBe("30123456");
  });

  it("combina neutralización de fórmula con quoting cuando hay ';' o comillas", () => {
    const csv = buildCheckoutCsv([row({ client_name: '=cmd;evil"x' })], TZ);
    const line = csv.replace(/^﻿/, "").split("\r\n")[1];
    // Lleva apóstrofo (neutralización) y va entrecomillado por el ';'/comilla interna.
    expect(line).toContain('"\'=cmd;evil""x"');
  });

  it("NO neutraliza el Monto negativo (empieza con '-' pero es un importe, no texto)", () => {
    const csv = buildCheckoutCsv([row({ total_price: -1234.5 })], TZ);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[4]).toBe("-1234,50");
  });
});
