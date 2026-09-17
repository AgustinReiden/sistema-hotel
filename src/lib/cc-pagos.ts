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

import { formatAmount } from "./format";

/** El redondeo de dinero del repo (mismo que `roundCurrency` en pricing.ts). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Las dos retenciones de un pago. Cero es lo normal: la mayoría no retiene. */
export type Retenciones = {
  retencionGanancias?: number | null;
  retencionIibb?: number | null;
};

/** Lo mínimo que necesita una imputación para hacer cuentas: su importe. */
export type ImputacionMonto = { amount: number };

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

/** Σ de lo imputado a facturas. */
export function imputadoTotal(imputaciones: readonly ImputacionMonto[]): number {
  return round2(imputaciones.reduce((sum, i) => sum + num(i.amount), 0));
}

/**
 * Lo del pago que todavía no se imputó a ninguna factura. Un pago puede quedar
 * parcialmente imputado (o sin imputar) a propósito: el cliente adelanta plata y la
 * factura sale después.
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

// ───────────────────────────────────────────────────────────────────────────────
// Lo que necesita la PANTALLA de cobro, además de los espejos de arriba.
//
// Todo esto es aritmética pura a propósito: el resumen en vivo del modal y el
// reparto automático se tienen que poder testear sin montar React, porque son
// justo los números que la gente se equivoca. La autoridad sigue siendo la RPC.
// ───────────────────────────────────────────────────────────────────────────────

/** Una factura del cliente con saldo pendiente, como la ve el modal de cobro. */
export type FacturaAImputar = {
  invoiceId: string;
  /** Fecha del comprobante (YYYY-MM-DD). Es la que ordena el reparto automático. */
  fecha: string | null;
  /** Número del comprobante, para desempatar dos del mismo día. */
  numero: number | null;
  /** Lo que falta cobrarle: `imp_total` menos lo ya imputado por otros pagos. */
  saldo: number;
};

/** Una imputación tal como viaja al server action. */
export type ImputacionElegida = { invoiceId: string; amount: number };

/**
 * De la más vieja a la más nueva. Las que no tienen fecha van al final: una factura
 * sin CAE no tiene lugar en la fila de antigüedad, y ponerla primera haría que el
 * reparto automático empiece por lo que todavía no es exigible.
 */
function masViejaPrimero(a: FacturaAImputar, b: FacturaAImputar): number {
  if (a.fecha !== b.fecha) {
    if (!a.fecha) return 1;
    if (!b.fecha) return -1;
    return a.fecha < b.fecha ? -1 : 1;
  }
  return (a.numero ?? 0) - (b.numero ?? 0);
}

/**
 * Reparte `monto` entre las facturas, saldando la más vieja antes de tocar la
 * siguiente. Es lo que hace cualquiera a mano con una transferencia grande, y el
 * caso normal: nadie quiere cargar seis renglones para decir "pagá lo que debe".
 *
 * El orden lo decide ESTA función y no el que le pasen: que el reparto sea por
 * antigüedad no puede depender de cómo vino ordenada una lista.
 *
 * Nunca imputa más que el saldo de cada factura ni más que el monto, así que lo que
 * devuelve pasa las dos guardas de la RPC (P0035 y P0038) por construcción. Si el
 * monto sobra, el resto queda sin imputar — que es un pago a cuenta legítimo.
 */
export function repartirMasViejoPrimero(
  monto: number,
  facturas: readonly FacturaAImputar[]
): ImputacionElegida[] {
  let restante = round2(num(monto));
  if (restante <= 0) return [];

  const imputaciones: ImputacionElegida[] = [];
  for (const factura of [...facturas].sort(masViejaPrimero)) {
    if (restante <= 0) break;
    const saldo = round2(num(factura.saldo));
    if (saldo <= 0) continue;
    const aplica = round2(Math.min(saldo, restante));
    imputaciones.push({ invoiceId: factura.invoiceId, amount: aplica });
    restante = round2(restante - aplica);
  }
  return imputaciones;
}

/**
 * Las tres cifras del resumen en vivo, arriba del botón de guardar.
 *
 * Es el número que la gente se equivoca: con retenciones, lo que cancela de deuda y
 * lo que entra a la cuenta bancaria NO son lo mismo, y hasta ahora eso recién se veía
 * en el recibo, después de guardar.
 */
export type ResumenPago = {
  /** Lo que CANCELA de deuda: el `amount` de la mig 109, retenciones adentro. */
  cancela: number;
  /** La plata que entra de verdad: `cancela` menos las retenciones. */
  entran: number;
  retenciones: number;
  /** Σ de lo que se está aplicando a facturas. */
  imputado: number;
  /** Lo que queda a cuenta, sin factura asignada. */
  sinImputar: number;
};

export function resumenPago(
  pago: { amount: number } & Retenciones,
  imputaciones: readonly ImputacionMonto[] = []
): ResumenPago {
  const cancela = round2(num(pago.amount));
  const retenciones = retencionesTotal(pago);
  return {
    cancela,
    retenciones,
    entran: round2(cancela - retenciones),
    imputado: imputadoTotal(imputaciones),
    sinImputar: round2(cancela - imputadoTotal(imputaciones)),
  };
}

/**
 * Estado de COBRO de una estadía, para la pastilla de la pantalla.
 *
 * Es el `cobro_estado` de `rpc_list_cc_account_stays` con un grado más: la RPC sólo
 * distingue pagada de impaga (porque la unidad de cobro es la factura y no hay forma
 * de saber qué mitad de una consolidada se cobró), pero para mirar una lista sí
 * importa la diferencia entre "no entró nada" y "entró una parte".
 */
export type EstadoPago = "sin_facturar" | "facturado_externo" | "impaga" | "parcial" | "pagada";

export function estadoPago(row: {
  /** Hay un comprobante nuestro vivo para esta estadía, autorizado o en trámite. */
  facturada: boolean;
  /** Se facturó fuera del sistema (mig 82): no hay comprobante nuestro que cobrar. */
  externa: boolean;
  /** Total de la factura cobrable; null mientras no haya una autorizada y viva. */
  impTotal: number | null;
  imputado: number | null;
}): EstadoPago {
  if (row.externa) return "facturado_externo";
  if (!row.facturada) return "sin_facturar";
  // Factura emitida pero todavía sin CAE: no hay nada imputado ni total contra el
  // cual imputar, y decir "sin facturar" mandaría a facturarla de nuevo.
  const impTotal = num(row.impTotal);
  const imputado = num(row.imputado);
  if (impTotal <= 0) return "impaga";
  if (estaPagada({ impTotal, imputado })) return "pagada";
  return imputado > 0 ? "parcial" : "impaga";
}

/** Una imputación como la está armando el modal, con lo que hace falta para explicarla. */
export type ImputacionEnPantalla = {
  invoiceId: string;
  /** Cómo se llama la factura en la pantalla: "Factura B 0008-00000123". */
  etiqueta: string;
  /** Lo que le faltaba cobrar ANTES de este pago. */
  saldo: number;
  amount: number;
};

/**
 * Todo lo que está mal en el pago que se está cargando, dicho como una instrucción.
 *
 * Devuelve la lista completa y no el primer problema: si el monto no alcanza para
 * dos imputaciones, corregir una y descubrir la otra recién al reintentar es
 * exactamente el ida y vuelta que esta pantalla viene a sacar.
 *
 * Los mensajes dicen QUÉ CORREGIR y con cuánto, no "error de validación": el que
 * carga el pago tiene la transferencia a la vista y necesita saber qué número mover.
 *
 * Son las mismas condiciones que rechaza `rpc_register_account_payment` (P0035,
 * P0038 y el CHECK de retenciones). La RPC sigue siendo la autoridad —es la única
 * que puede cerrar una carrera entre dos cobros simultáneos—: esto existe para
 * avisar antes de mandar, no para reemplazarla.
 */
export function problemasDelPago(input: {
  amount: number;
  imputaciones: readonly ImputacionEnPantalla[];
} & Retenciones): string[] {
  const problemas: string[] = [];
  const amount = round2(num(input.amount));
  const rg = num(input.retencionGanancias);
  const iibb = num(input.retencionIibb);

  if (!Number.isFinite(Number(input.amount)) || amount <= 0) {
    problemas.push("Escribí el monto del pago: tiene que ser mayor a 0.");
  }
  if (rg < 0 || iibb < 0) {
    problemas.push("Las retenciones no pueden ser negativas. Escribí lo retenido, sin signo.");
  }

  const sobranRetenciones = retencionExcedente({ amount, retencionGanancias: rg, retencionIibb: iibb });
  if (sobranRetenciones > 0) {
    // El monto ya incluye lo retenido: el error típico es sumarle la retención al
    // neto que llegó al banco en vez de partir del total que cancela.
    problemas.push(
      `Las retenciones se pasan ${formatAmount(sobranRetenciones)} del monto. El monto ya las incluye: subilo a ${formatAmount(round2(rg + iibb))} o bajá la retención.`
    );
  }

  for (const imp of input.imputaciones) {
    if (!Number.isFinite(Number(imp.amount)) || round2(num(imp.amount)) <= 0) {
      problemas.push(`Poné cuánto le imputás a ${imp.etiqueta}, o destildala.`);
      continue;
    }
    const sobra = facturaExcedente({ impTotal: imp.saldo, imputado: 0 }, imp.amount);
    if (sobra > 0) {
      problemas.push(
        `A ${imp.etiqueta} le faltan ${formatAmount(round2(num(imp.saldo)))} y le estás imputando ${formatAmount(round2(num(imp.amount)))}: son ${formatAmount(sobra)} de más.`
      );
    }
  }

  const sobraImputado = imputacionExcedente({ amount }, input.imputaciones);
  if (sobraImputado > 0) {
    problemas.push(
      `Estás imputando ${formatAmount(sobraImputado)} más de lo que entra en el pago. Subí el monto o bajá lo imputado.`
    );
  }

  return problemas;
}
