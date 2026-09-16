import { describe, expect, it } from "vitest";

import { buildCsv, type CsvColumn } from "@/lib/csv";

type Row = { nombre: string; monto: number; fecha: string; nota: string; doc: string };

const columns: CsvColumn<Row>[] = [
  { header: "Nombre", type: "texto", value: (r) => r.nombre },
  { header: "Monto", type: "monto", value: (r) => r.monto },
  { header: "Fecha", type: "fecha", value: (r) => r.fecha },
  { header: "Nota", type: "plano", value: (r) => r.nota },
  { header: "DNI/CUIT", type: "documento", value: (r) => r.doc },
];

function row(partial: Partial<Row> = {}): Row {
  return {
    nombre: "Juan Pérez",
    monto: 1000,
    fecha: "2026-07-03",
    nota: "ok",
    doc: "20123456789",
    ...partial,
  };
}

describe("buildCsv", () => {
  it("arma header y BOM UTF-8", () => {
    const csv = buildCsv(columns, []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Nombre;Monto;Fecha;Nota;DNI/CUIT");
  });

  it("formatea monto con coma decimal y fecha DD/MM/AAAA", () => {
    const csv = buildCsv(columns, [row()]);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[1]).toBe("1000,00");
    expect(fields[2]).toBe("03/07/2026");
  });

  it("neutraliza inyección de fórmulas en columnas 'texto' que arrancan con '='", () => {
    const csv = buildCsv(columns, [row({ nombre: '=HYPERLINK("http://evil")' })]);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[0].replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("NO neutraliza un monto negativo (columna 'monto' no pasa por csvTextField)", () => {
    const csv = buildCsv(columns, [row({ monto: -1234.5 })]);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[1]).toBe("-1234,50");
  });

  // Sin puntuar, Excel abre un CUIT de once dígitos como "2,0123E+10".
  it("puntúa el CUIT de once dígitos para que Excel no lo lea como número", () => {
    const csv = buildCsv(columns, [row()]);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[4]).toBe("20-12345678-9");
  });

  it("deja el DNI como está: no es largo y Excel lo muestra entero", () => {
    const csv = buildCsv(columns, [row({ doc: "11222333" })]);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[4]).toBe("11222333");
  });

  it("no vuelve a puntuar un documento que ya vino con guiones", () => {
    const csv = buildCsv(columns, [row({ doc: "27-98765432-1" })]);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[4]).toBe("27-98765432-1");
  });

  it("deja vacía la celda cuando no hay documento", () => {
    const csv = buildCsv(columns, [row({ doc: "" })]);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[4]).toBe("");
  });

  it("sigue neutralizando una fórmula metida en el documento", () => {
    const csv = buildCsv(columns, [row({ doc: "=1+1" })]);
    const fields = csv.replace(/^﻿/, "").split("\r\n")[1].split(";");
    expect(fields[4].replace(/^"/, "").startsWith("'")).toBe(true);
  });
});
