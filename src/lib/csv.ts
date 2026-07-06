// Armado del CSV fiscal de check-outs por turno. Formato AR (Excel-friendly):
// separador ';', decimales con coma, UTF-8 con BOM, fecha DD/MM/AAAA, hora HH:MM.

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

const CSV_HEADERS = [
  "Fecha",
  "Hora",
  "Cliente",
  "Cod. Cliente",
  "Monto",
  "Forma de pago",
];

/** Escapa un campo para CSV con separador ';': envuelve en comillas y duplica comillas internas. */
function csvField(value: string): string {
  const needsQuote = /[";\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
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
        csvField(cliente),
        csvField(codCliente),
        csvField(monto),
        csvField(formaPago),
      ].join(";")
    );
  }

  // ﻿ = BOM UTF-8; \r\n = fin de línea que Excel prefiere.
  return "﻿" + lines.join("\r\n");
}
