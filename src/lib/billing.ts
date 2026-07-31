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
