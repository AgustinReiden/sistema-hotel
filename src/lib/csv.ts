// Armado de CSVs con formato AR (Excel-friendly): separador ';', decimales con
// coma, UTF-8 con BOM, fecha DD/MM/AAAA. buildCsv es el motor genérico: cada
// columna declara su tipo para que nadie vuelva a decidir a mano cuándo escapar.
// buildCheckoutCsv (el export fiscal de check-outs por turno) está montado encima.

import { formatShiftCode } from "./format";
import { formatHotelDate, formatHotelTime } from "./time";
import { DATE_KEY, formatKey } from "./date-range";
import {
  BILLING_CIERRE_LABEL,
  BILLING_ESTADO_LABEL,
  billingComprobante,
} from "./billing";
import type { BillingControlRow, CheckoutExportRow } from "./types";

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

/** Escapa un campo para CSV con separador ';': envuelve en comillas y duplica comillas internas. */
export function csvField(value: string): string {
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
export function csvTextField(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return csvField(neutralized);
}

/** Monto con coma decimal, sin separador de miles (más seguro para importadores fiscales). */
export function formatAmountAr(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

export type CsvColumnType = "texto" | "plano" | "monto" | "fecha";

export type CsvColumn<T> = {
  header: string;
  /** "texto" = untrusted (pasa por csvTextField); "monto" NO pasa por csvTextField
   * (un importe negativo empieza con "-" y quedaría corrompido); "fecha" espera una
   * clave "YYYY-MM-DD" y la formatea DD/MM/AAAA. */
  type: CsvColumnType;
  value: (row: T) => string | number;
};

function formatCsvValue(type: CsvColumnType, raw: string | number): string {
  switch (type) {
    case "texto":
      return csvTextField(String(raw ?? ""));
    case "monto":
      return csvField(formatAmountAr(Number(raw)));
    case "fecha": {
      const key = String(raw ?? "");
      return csvField(DATE_KEY.test(key) ? formatKey(key) : key);
    }
    case "plano":
    default:
      return csvField(String(raw ?? ""));
  }
}

/**
 * Motor genérico de CSV: cada columna declara su tipo, así nadie vuelve a decidir
 * a mano cuándo escapar. Prefija BOM para que Excel en español respete los acentos.
 */
export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines: string[] = [columns.map((c) => csvField(c.header)).join(";")];
  for (const row of rows) {
    lines.push(columns.map((c) => formatCsvValue(c.type, c.value(row))).join(";"));
  }
  // ﻿ = BOM UTF-8; \r\n = fin de línea que Excel prefiere.
  return "﻿" + lines.join("\r\n");
}

/** Construye el texto CSV a partir de las filas de check-out (export fiscal). */
export function buildCheckoutCsv(
  rows: CheckoutExportRow[],
  timezone: string
): string {
  // "Turno" va AL FINAL para no correr las columnas que un importador ya mapee
  // por posición. Es el nº de cierre correlativo con el que el sistema de gestión
  // valida que se importó el turno correcto.
  const columns: CsvColumn<CheckoutExportRow>[] = [
    { header: "Fecha", type: "plano", value: (r) => formatHotelDate(r.actual_check_out, timezone) },
    { header: "Hora", type: "plano", value: (r) => formatHotelTime(r.actual_check_out, timezone) },
    { header: "Cliente", type: "texto", value: (r) => r.client_name ?? "" },
    { header: "Cod. Cliente", type: "texto", value: (r) => r.client_dni ?? "" },
    { header: "Monto", type: "monto", value: (r) => r.total_price },
    {
      header: "Forma de pago",
      type: "plano",
      value: (r) => PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method,
    },
    { header: "Turno", type: "plano", value: (r) => formatShiftCode(r.shift_number) },
  ];
  return buildCsv(columns, rows);
}

/**
 * CSV del control de facturación: es el archivo que se le manda al contador para
 * cruzar qué falta facturar. Se arma en el cliente sobre las filas que están en
 * pantalla (ya filtradas), sin segunda consulta, justamente para que el archivo
 * nunca pueda decir algo distinto de lo que vio el empleado.
 *
 * Cliente y comprobante son texto untrusted (el nombre puede venir de una reserva
 * pública y el comprobante lo tipea a mano un admin), así que van por "texto".
 */
export function buildBillingControlCsv(rows: BillingControlRow[]): string {
  const columns: CsvColumn<BillingControlRow>[] = [
    { header: "Salida", type: "fecha", value: (r) => r.fch_hasta },
    { header: "Habitacion", type: "plano", value: (r) => r.room_number },
    { header: "Cliente", type: "texto", value: (r) => r.cliente },
    { header: "Cierre", type: "plano", value: (r) => BILLING_CIERRE_LABEL[r.cierre] },
    { header: "Total", type: "monto", value: (r) => r.total_price },
    {
      // "plano" en vez de "monto" SÓLO por el null: la estadía que cerró por caja
      // no tiene cargo a cuenta corriente, y un "0,00" le diría al contador algo
      // falso (que se cargó cero). Vacío es lo que la pantalla muestra como "—".
      // Para los importes reales el resultado es idéntico al de "monto": misma
      // función de formato y el mismo escapado (no hay caracteres que citar).
      header: "Cargo cta. cte.",
      type: "plano",
      value: (r) => (r.cargo_cc === null ? "" : formatAmountAr(r.cargo_cc)),
    },
    { header: "Estado", type: "plano", value: (r) => BILLING_ESTADO_LABEL[r.estado] },
    { header: "Comprobante", type: "texto", value: (r) => billingComprobante(r) ?? "" },
  ];
  return buildCsv(columns, rows);
}

/** `control-facturacion-2026-08-01_2026-08-31.csv`: con el rango, para que no se pisen en Descargas. */
export function billingControlCsvFilename(from: string, to: string): string {
  return `control-facturacion-${from}_${to}.csv`;
}
