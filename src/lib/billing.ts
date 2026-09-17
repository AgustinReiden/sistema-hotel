import { formatCbteNumero } from "./arca/amounts";
import type {
  BillingControlCierre,
  BillingControlEstado,
  PaymentMethod,
} from "./types";

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

// ─── Control de facturación: etiquetas y lógica de lote ────────────────────────
// Viven acá y no en ControlClient.tsx porque el CSV que se le manda al contador
// tiene que decir exactamente lo mismo que la pantalla. Una sola fuente de verdad:
// si mañana cambia una etiqueta, cambia en los dos lados o en ninguno.

/** Texto de cada estado. El color queda en la pantalla; el texto se comparte con el CSV. */
export const BILLING_ESTADO_LABEL: Record<BillingControlEstado, string> = {
  facturado: "Facturado",
  facturado_consolidado: "Consolidado",
  facturado_externo: "Facturado afuera",
  en_proceso: "En proceso",
  pendiente_consolidada: "Espera consolidada",
  no_corresponde: "No corresponde",
  falta: "FALTA FACTURAR",
};

/** Cómo cerró la estadía. Mismo criterio: compartido entre pantalla y CSV. */
export const BILLING_CIERRE_LABEL: Record<BillingControlCierre, string> = {
  caja: "Caja",
  cuenta_corriente: "Cta. cte.",
  vale_blanco: "Vale blanco",
};

/**
 * Qué comprobante mostrar para una estadía: el externo declarado a mano gana,
 * porque si está es porque alguien afirmó que se facturó afuera. Devuelve null
 * cuando no hay ninguno, y cada consumidor decide cómo se ve la ausencia (la
 * pantalla pone "—", el CSV deja la celda vacía).
 */
export function billingComprobante(row: {
  external_ref: string | null;
  cbte_tipo: number | null;
  pto_vta: number | null;
  cbte_nro: number | null;
}): string | null {
  if (row.external_ref) return row.external_ref;
  if (row.cbte_nro && row.pto_vta) {
    return `${row.cbte_tipo === 1 ? "A" : "B"} ${formatCbteNumero(row.pto_vta, row.cbte_nro)}`;
  }
  return null;
}

/**
 * Qué acción en lote admite una selección.
 *
 * - "marcar": todas están sin facturar, así que se pueden dar por facturadas afuera.
 * - "deshacer": todas están marcadas como facturadas afuera.
 * - "mezclado": hay estados distintos y la acción sería ambigua.
 * - "sin_accion": todas en el mismo estado, pero uno que no admite lote (ya
 *   facturadas por el sistema, en proceso, no corresponde).
 * - "vacio": no hay nada seleccionado.
 *
 * Por qué se bloquea en vez de aplicar "lo que se pueda": marcar de más es
 * irreversible en la práctica (esa estadía deja de reclamarse), así que el
 * empleado tiene que ver exactamente sobre qué está actuando.
 */
export type BulkBillingAction = "marcar" | "deshacer" | "mezclado" | "sin_accion" | "vacio";

/** Estados desde los que todavía falta facturar: son los que se pueden marcar. */
const MARCABLES: readonly BillingControlEstado[] = ["falta", "pendiente_consolidada"];

/**
 * ¿Esta estadía sigue reclamando una factura? Mismo criterio que
 * `rpc_count_billing_pending` suma en la base, para que el contador "en todo el
 * historial" y lo que se ve en pantalla se puedan comparar sin mentir.
 */
export function isPendingBilling(estado: BillingControlEstado): boolean {
  return MARCABLES.includes(estado);
}

export function bulkBillingAction(
  rows: readonly { estado: BillingControlEstado }[]
): BulkBillingAction {
  if (rows.length === 0) return "vacio";
  if (rows.every((r) => MARCABLES.includes(r.estado))) return "marcar";
  if (rows.every((r) => r.estado === "facturado_externo")) return "deshacer";
  // Todas iguales pero fuera de lote (p. ej. ya facturadas por el sistema): no es
  // una mezcla, y decirle "elegí filas del mismo estado" sería mentirle al empleado.
  const primero = rows[0].estado;
  return rows.every((r) => r.estado === primero) ? "sin_accion" : "mezclado";
}

/**
 * Cómo se cobró la estadía, para el filtro del control de facturación.
 *
 * OJO CON `cierre`: `'caja'` NO significa efectivo. Significa "no fue a cuenta
 * corriente ni a vale blanco". Una estadía pagada con tarjeta tiene
 * `cierre = 'caja'` Y `bancario = true`. Por eso el filtro no clasifica cada fila
 * en una sola categoría: son predicados que se pisan a propósito. Una estadía que
 * pagó una parte con tarjeta y el resto a cuenta corriente aparece en los dos
 * filtros, que es la verdad.
 */
export type BillingCobroFilter = "cuenta_corriente" | "bancaria" | "efectivo" | "vale_blanco";

export const BILLING_COBRO_LABEL: Record<BillingCobroFilter, string> = {
  cuenta_corriente: "Cta. cte.",
  bancaria: "Bancaria (tarjeta, transf., MP)",
  efectivo: "Efectivo o sin cobro",
  vale_blanco: "Vale blanco",
};

export const BILLING_COBRO_FILTERS: readonly BillingCobroFilter[] = [
  "cuenta_corriente",
  "bancaria",
  "efectivo",
  "vale_blanco",
] as const;

export function isBillingCobroFilter(value: string): value is BillingCobroFilter {
  return (BILLING_COBRO_FILTERS as readonly string[]).includes(value);
}

type CobroRow = { cierre: BillingControlCierre; bancario: boolean };

/** Predicado del filtro de cobro. Cadena vacía = sin filtro (pasa todo). */
export function matchesCobro(row: CobroRow, filter: string): boolean {
  if (filter === "") return true;
  switch (filter) {
    case "cuenta_corriente":
      return row.cierre === "cuenta_corriente";
    case "bancaria":
      return row.bancario;
    // Único definido por exclusión: es "lo que quedó" una vez descartado el resto.
    case "efectivo":
      return row.cierre === "caja" && !row.bancario;
    case "vale_blanco":
      return row.cierre === "vale_blanco";
    default:
      // Filtro desconocido (alguien tocó la URL): mostrar todo antes que nada.
      return true;
  }
}

/**
 * Lo que pide la planilla del gerente en una sola condición: estadías que faltan
 * facturar Y que dejaron rastro (cuenta corriente o cobro bancario). Son las que
 * no se pueden dejar pasar, porque el movimiento ya existe en otro lado.
 *
 * Es un atajo de un clic y no "combiná estos dos filtros" justamente porque el
 * que la usa (el admin que factura) entra a buscar exactamente esta lista.
 */
export function isPendingWithTrail(
  row: CobroRow & { estado: BillingControlEstado }
): boolean {
  return (
    isPendingBilling(row.estado) &&
    (row.bancario || row.cierre === "cuenta_corriente")
  );
}
