import { describe, expect, it } from "vitest";

import { buildCsv, type CsvColumn } from "@/lib/csv";

type Row = { nombre: string; monto: number; fecha: string; nota: string };

const columns: CsvColumn<Row>[] = [
  { header: "Nombre", type: "texto", value: (r) => r.nombre },
  { header: "Monto", type: "monto", value: (r) => r.monto },
  { header: "Fecha", type: "fecha", value: (r) => r.fecha },
  { header: "Nota", type: "plano", value: (r) => r.nota },
];

function row(partial: Partial<Row> = {}): Row {
  return { nombre: "Juan Pérez", monto: 1000, fecha: "2026-07-03", nota: "ok", ...partial };
}

describe("buildCsv", () => {
  it("arma header y BOM UTF-8", () => {
    const csv = buildCsv(columns, []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Nombre;Monto;Fecha;Nota");
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
});
