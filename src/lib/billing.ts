import type { PaymentMethod } from "./types";

/**
 * Medios de pago con rastro bancario. Cobrar por acá y no facturar es una
 * inconsistencia que después hay que explicar, así que en estos casos la
 * facturación es obligatoria: no se muestra el SÍ/NO del check-out.
 *
 * ESPEJO DE `app_is_bank_payment_method` (mig 83). Si cambia uno, cambia el otro.
 * El enforcement real vive en la base (`rpc_decline_invoice` rechaza con P0032);
 * esto es lo que decide qué se le muestra al playero.
 *
 * `other` queda afuera a propósito: no tiene botón en el modal de cobro y su
 * semántica es indefinida, así que no se puede afirmar que deje rastro.
 */
export const BANK_PAYMENT_METHODS: readonly PaymentMethod[] = [
  "credit_card",
  "debit_card",
  "bank_transfer",
  "mercado_pago",
] as const;

export function isBankPaymentMethod(method: string | null | undefined): boolean {
  return BANK_PAYMENT_METHODS.includes(method as PaymentMethod);
}

/** Los pasos del prompt de facturación post check-out. */
export type InvoiceStep = "ask" | "confirmNo" | "tipo" | "formCuit" | "confirmDirecto";

type InvoiceStepInput = {
  /** Se entró desde /admin/fiscal o el control: la decisión de facturar ya está tomada. */
  startAtTipo: boolean;
  /** Se cobró por medio bancario: no existe la opción de no facturar. */
  mandatory: boolean;
  /** La ficha ya tiene CUIT, condición IVA, razón social y domicilio. */
  prefillComplete: boolean;
};

/**
 * Paso inicial del prompt. Función pura para poder testear la matriz completa sin
 * montar el componente.
 *
 * - Con datos fiscales completos no se pregunta el tipo: se muestra qué se va a
 *   emitir y se confirma con un clic.
 * - Bancario o entrada desde Facturación saltean el SÍ/NO.
 * - El resto (efectivo, o check-out sin cobro) mantiene el SÍ/NO de siempre.
 */
export function initialInvoiceStep({
  startAtTipo,
  mandatory,
  prefillComplete,
}: InvoiceStepInput): InvoiceStep {
  if (startAtTipo || mandatory) {
    return prefillComplete ? "confirmDirecto" : "tipo";
  }
  return "ask";
}

/** Paso al que lleva el SÍ del prompt (o el atajo cuando ya hay datos cargados). */
export function stepAfterYes(prefillComplete: boolean): InvoiceStep {
  return prefillComplete ? "confirmDirecto" : "tipo";
}

/**
 * Largos máximos del detalle editable de la factura consolidada (mig 93). La
 * comandera son 72 mm de ancho útil: más que esto envuelve y deja el ticket
 * ilegible. Los CHECK de `invoice_reservations.descripcion` y
 * `invoices.detalle_nota` usan los mismos números.
 */
export const DETALLE_LINEA_MAX = 80;
export const DETALLE_NOTA_MAX = 200;

/**
 * Limpia un texto que va a salir impreso en un comprobante fiscal: colapsa
 * espacios, saca caracteres de control (un salto de línea rompe el layout del
 * ticket) y recorta. Devuelve null si no queda nada, para que el servidor caiga
 * al texto automático.
 *
 * ESPEJO DE `app_sanitize_detalle` (mig 90). Si cambia uno, cambia el otro.
 * El enforcement real vive en la base; esto es para que la UI muestre lo mismo
 * que se va a guardar.
 */
export function sanitizeDetalleLine(text: string | null | undefined, max = DETALLE_LINEA_MAX): string | null {
  const collapsed = (text ?? "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Se corta por caracteres, no por unidades UTF-16: `slice` partia al medio un
  // emoji (que ocupa dos unidades), dejaba media pareja suelta -se imprime como
  // "�"- y ademas lo contaba doble contra el limite. Asi coincide con el LEFT() de
  // app_sanitize_detalle, que en Postgres tambien cuenta caracteres.
  // (Un emoji compuesto con ZWJ son varios caracteres para las dos reglas por
  // igual: se puede partir, pero el front y la base lo parten en el mismo lugar.)
  const cut = Array.from(collapsed).slice(0, Math.max(max, 1)).join("").trim();
  return cut === "" ? null : cut;
}

/**
 * Texto por defecto de una línea del detalle. ASCII a propósito: es lo que se
 * imprime en la comandera térmica.
 *
 * ESPEJO DE `app_default_stay_description` (mig 90).
 */
export function defaultStayDescription(stay: {
  room_number: string | null;
  fch_desde: string; // yyyy-mm-dd
  fch_hasta: string; // yyyy-mm-dd
}): string {
  const desde = formatDetalleDate(stay.fch_desde);
  const hasta = formatDetalleDate(stay.fch_hasta);
  const room = (stay.room_number ?? "").trim();
  return room === ""
    ? `Estadia ${desde} al ${hasta}`
    : `Hab. ${room} - ${desde} al ${hasta}`;
}

/** "2026-08-12" (date de Postgres) → "12/08/2026". */
function formatDetalleDate(value: string): string {
  const [y, m, d] = (value ?? "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}
