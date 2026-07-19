// Armado del CSV fiscal de check-outs por turno. Formato AR (Excel-friendly):
// separador ';', decimales con coma, UTF-8 con BOM, fecha DD/MM/AAAA, hora HH:MM.

import { formatShiftCode } from "./format";
import { formatHotelDate, formatHotelTime } from "./time";
import type { CheckoutExportRow } from "./types";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  credit_card: "Tarjeta credito",
  debit_card: "Tarjeta debito",
  bank_transfer: "Transferencia",
  mercado_pago: "Mercado Pago",
  vale_blanco: "Vale Blanco",
  cuenta_corriente: "Cuenta corriente",
  other: "Otro",
  sin_cobro: "Sin cobro",
};

// "Turno" va AL FINAL para no correr las columnas que un importador ya mapee
// por posición. Es el nº de cierre correlativo con el que el sistema de gestión
// valida que se importó el turno correcto.
const CSV_HEADERS = [
  "Fecha",
  "Hora",
  "Cliente",
  "Cod. Cliente",
  "Monto",
  "Forma de pago",
  "Turno",
];

/** Escapa un campo para CSV con separador ';': envuelve en comillas y duplica comillas internas. */
function csvField(value: string): string {
  const needsQuote = /[";\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

/**
 * Neutraliza la inyección de fórmulas (CSV injection) para texto libre controlado
 * por el usuario. Si el valor arranca con un carácter que Excel/LibreOffice
 * interpretan como fórmula (= + - @, TAB o CR), antepone un apóstrofo para que la
 * celda quede como texto y no se ejecute. Recién después aplica el quoting normal
 * (entrecomillar por sí solo NO desactiva la fórmula).
 *
 * Usar SOLO en campos untrusted (nombre y documento del cliente, cargables por un
 * anónimo en la reserva pública). NO usar en montos: un importe negativo empieza
 * con '-' y quedaría corrompido para el importador fiscal. Los nombres/DNI
 * legítimos nunca arrancan con esos caracteres, así que las filas reales no cambian.
 */
function csvTextField(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return csvField(neutralized);
}

/** Monto con coma decimal, sin separador de miles (más seguro para importadores fiscales). */
function formatAmountAr(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/**
 * Construye el texto CSV a partir de las filas de check-out.
 * Prefija BOM para que Excel en español respete los acentos.
 */
export function buildCheckoutCsv(
  rows: CheckoutExportRow[],
  timezone: string
): string {
  const lines: string[] = [CSV_HEADERS.map(csvField).join(";")];

  for (const row of rows) {
    const fecha = formatHotelDate(row.actual_check_out, timezone);
    const hora = formatHotelTime(row.actual_check_out, timezone);
    const cliente = row.client_name ?? "";
    const codCliente = row.client_dni ?? "";
    const monto = formatAmountAr(row.total_price);
    const formaPago =
      PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method;

    lines.push(
      [
        csvField(fecha),
        csvField(hora),
        csvTextField(cliente),
        csvTextField(codCliente),
        csvField(monto),
        csvField(formaPago),
        csvField(formatShiftCode(row.shift_number)),
      ].join(";")
    );
  }

  // ﻿ = BOM UTF-8; \r\n = fin de línea que Excel prefiere.
  return "﻿" + lines.join("\r\n");
}
