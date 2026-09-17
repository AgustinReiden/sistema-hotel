/**
 * Aritmética de un pago de cuenta corriente: retenciones e imputación a facturas.
 *
 * ESPEJO DECLARADO DEL SQL. La autoridad son los CHECK de
 * `cuenta_corriente_movimientos` y las guardas de `rpc_register_account_payment`
 * (migración 109): el servidor rechaza igual lo que acá salga mal. Esto existe para
 * que la pantalla pueda avisar ANTES de mandar y para que el impreso muestre el neto
 * sin pedirle otra cuenta a la base. Mismo criterio que `sanitizeDetalleLine` ↔
 * `app_sanitize_detalle`.
 *
 * LA REGLA, que es lo único que hay que entender de este archivo:
 *
 *     amount = lo que CANCELA de deuda = efectivo + retenciones
 *     neto recibido = amount − retenciones
 *
 * Una retención es plata que el cliente le pagó a ARCA en nombre del hotel, así que
 * la deuda se extingue por el total igual. Si alguien "corrige" esto restándole las
 * retenciones al monto que cancela, el cliente queda debiendo para siempre algo que
 * ya pagó. Los tests de `cc-pagos.test.ts` fijan esa invariante justamente para que
 * no se pueda dar vuelta sin que algo se ponga rojo.
 */

/** El redondeo de dinero del repo (mismo que `roundCurrency` en pricing.ts). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Las dos retenciones de un pago. Cero es lo normal: la mayoría no retiene. */
export type Retenciones = {
  retencionGanancias?: number | null;
  retencionIibb?: number | null;
};

/**
 * Lo mínimo que necesita una imputación para hacer cuentas: su importe, y si sigue
 * viva. Una imputación desimputada (mig 110) queda en la lista como historia pero no
 * cancela nada, así que todas las sumas de acá abajo la saltean. `revertida` es
 * opcional para que un arreglo recién armado en la pantalla —donde nada se desimputó
 * todavía— se siga pudiendo pasar tal cual.
 */
export type ImputacionMonto = { amount: number; revertida?: boolean | null };

/**
 * Las que todavía cancelan factura. Es el único lugar que decide qué cuenta: si
 * mañana aparece otra forma de anular una imputación, se agrega acá y las cinco
 * funciones de abajo quedan bien solas.
 */
export function imputacionesVivas<T extends ImputacionMonto>(
  imputaciones: readonly T[]
): T[] {
  return imputaciones.filter((i) => !i.revertida);
}

function num(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

/** Ganancias + IIBB. */
export function retencionesTotal(ret: Retenciones): number {
  return round2(num(ret.retencionGanancias) + num(ret.retencionIibb));
}

/**
 * La plata que entró de verdad a la caja del hotel: el monto menos lo retenido.
 * Puede ser 0 (un pago absorbido entero por la retención es legítimo) pero nunca
 * negativo, porque las retenciones no pueden superar el monto.
 */
export function netoRecibido(pago: { amount: number } & Retenciones): number {
  return round2(num(pago.amount) - retencionesTotal(pago));
}

/**
 * Cuánto se pasan las retenciones del monto del pago, 0 si entran.
 * Espejo del CHECK `cc_mov_retenciones_no_superan_amount`.
 */
export function retencionExcedente(pago: { amount: number } & Retenciones): number {
  return Math.max(0, round2(retencionesTotal(pago) - num(pago.amount)));
}

/** Σ de lo imputado a facturas. Sólo lo vivo: lo desimputado ya no cancela nada. */
export function imputadoTotal(imputaciones: readonly ImputacionMonto[]): number {
  return round2(imputacionesVivas(imputaciones).reduce((sum, i) => sum + num(i.amount), 0));
}

/**
 * Lo del pago que todavía no se imputó a ninguna factura. Un pago puede quedar
 * parcialmente imputado (o sin imputar) a propósito: el cliente adelanta plata y la
 * factura sale después.
 *
 * Como `imputadoTotal` saltea las desimputadas, desimputar una línea sube este número:
 * ésa es justamente la plata que queda libre para aplicar a la factura de reemplazo.
 * Espejo del `sin_imputar` de `rpc_list_client_payments`.
 */
export function sinImputar(pago: { amount: number }, imputaciones: readonly ImputacionMonto[]): number {
  return round2(num(pago.amount) - imputadoTotal(imputaciones));
}

/**
 * Cuánto se pasa la imputación del monto del pago, 0 si entra.
 *
 * Se mide contra `amount`, NO contra el neto recibido: la retención cancela factura
 * igual que el efectivo. Espejo de la guarda P0035 de la RPC.
 */
export function imputacionExcedente(
  pago: { amount: number },
  imputaciones: readonly ImputacionMonto[]
): number {
  return Math.max(0, round2(imputadoTotal(imputaciones) - num(pago.amount)));
}

/**
 * Cuánto se pasaría de una factura si se le imputara `aImputar` además de lo que ya
 * tiene, 0 si entra. Espejo de la guarda P0038 de la RPC.
 */
export function facturaExcedente(
  factura: { impTotal: number; imputado: number },
  aImputar: number
): number {
  return Math.max(
    0,
    round2(num(factura.imputado) + num(aImputar) - num(factura.impTotal))
  );
}

/**
 * Una factura está pagada cuando lo imputado alcanza su total.
 *
 * Sin epsilon a propósito: los importes son decimales exactos de Postgres y el techo
 * por factura acota la suma en `imp_total`, así que la igualdad se alcanza de verdad.
 * Un faltante de medio centavo NO es "pagada". Espejo del `cobro_estado` de
 * `rpc_list_cc_account_stays`.
 */
export function estaPagada(factura: { impTotal: number; imputado: number }): boolean {
  return round2(num(factura.imputado)) >= round2(num(factura.impTotal));
}
