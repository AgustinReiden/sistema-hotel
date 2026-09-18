"use server";

import { revalidatePath } from "next/cache";

import {
  addPaymentImputaciones,
  getCtaCteMovements,
  listCcAccountStays,
  listClientInvoices,
  listClientOpenInvoices,
  listClientPayments,
  registerAccountPayment,
  revertPaymentImputacion,
} from "@/lib/data";
import { imputacionExcedente, retencionExcedente } from "@/lib/cc-pagos";
import { parseActionError } from "@/lib/error-utils";
import { formatAmount } from "@/lib/format";
import { assertAdmin } from "@/lib/server-auth";
import type {
  ActionResult,
  CcAccountStayRow,
  CcClientPaymentRow,
  CcOpenInvoiceRow,
  ClientInvoiceRow,
  CtaCteClientKind,
  CtaCteMovimiento,
} from "@/lib/types";

// El chequeo de rol vive en @/lib/server-auth; aca solo se fija el mensaje de la seccion.
const assertCuentasAdmin = () =>
  assertAdmin("Permisos insuficientes para gestionar cuentas corrientes.");

export async function loadCtaCteAccountAction(
  kind: CtaCteClientKind,
  clientId: string
): Promise<ActionResult<{ movements: CtaCteMovimiento[]; balance: number }>> {
  try {
    await assertCuentasAdmin();
    const data = await getCtaCteMovements(kind, clientId);
    return { success: true, data };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cargar la cuenta.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/** Solapa "Facturas" de la ficha: los comprobantes emitidos a ese cliente (mig 108). */
export async function loadClientInvoicesAction(
  kind: CtaCteClientKind,
  clientId: string
): Promise<ActionResult<ClientInvoiceRow[]>> {
  try {
    await assertCuentasAdmin();
    if (!clientId) {
      return { success: false, error: "Falta el cliente." };
    }
    const data = await listClientInvoices(kind, clientId);
    return { success: true, data };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudieron cargar las facturas.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/** Solapa "Pagos" de la ficha: los cobros a cuenta con su imputación (mig 109). */
export async function loadClientPaymentsAction(
  kind: CtaCteClientKind,
  clientId: string
): Promise<ActionResult<CcClientPaymentRow[]>> {
  try {
    await assertCuentasAdmin();
    if (!clientId) {
      return { success: false, error: "Falta el cliente." };
    }
    const data = await listClientPayments(kind, clientId);
    return { success: true, data };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudieron cargar los pagos.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * Estado de cobro de las estadías de la cuenta, para las pastillas de la solapa
 * Movimientos (mig 109).
 *
 * Trae la cuenta entera sin rango: la ficha ya tiene todos los movimientos cargados
 * y necesita poder etiquetar cualquiera de ellos, no sólo los de un período.
 */
export async function loadCcAccountStaysAction(
  kind: CtaCteClientKind,
  clientId: string
): Promise<ActionResult<CcAccountStayRow[]>> {
  try {
    await assertCuentasAdmin();
    if (!clientId) {
      return { success: false, error: "Falta el cliente." };
    }
    const data = await listCcAccountStays(kind, clientId);
    return { success: true, data };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cargar el estado de cobro.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * Facturas con saldo del cliente: lo que el modal de cobro ofrece para imputar.
 *
 * El saldo que devuelve es una FOTO. El techo real lo valida la RPC con la fila de la
 * factura lockeada (P0038): entre que esto se lee y el admin guarda, otro pago pudo
 * haber entrado. Sirve para no ofrecer un imposible, no para garantizarlo.
 */
export async function loadClientOpenInvoicesAction(
  kind: CtaCteClientKind,
  clientId: string
): Promise<ActionResult<CcOpenInvoiceRow[]>> {
  try {
    await assertCuentasAdmin();
    if (!clientId) {
      return { success: false, error: "Falta el cliente." };
    }
    const data = await listClientOpenInvoices(kind, clientId);
    return { success: true, data };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudieron cargar las facturas impagas.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * Registra un cobro a cuenta corriente, con retenciones e imputación a facturas.
 *
 * `amount` es lo que CANCELA de deuda: efectivo más retenciones (mig 109). Devuelve
 * el movimiento y su número de recibo para que la pantalla pueda abrir el impreso
 * (`/admin/recibo-cc/<movementId>?autoprint=1&copy=original`).
 *
 * Las validaciones de acá son para que el admin vea el problema en su pantalla y con
 * los importes escritos en pesos, en vez de comerse un round-trip. **La autoridad
 * sigue siendo la RPC**, que valida lo mismo con la fila de la factura lockeada y es
 * lo único que puede cerrar una carrera entre dos cobros simultáneos: no borrar esas
 * guardas creyendo que esto las reemplaza.
 */
export async function registerAccountPaymentAction(input: {
  kind: CtaCteClientKind;
  clientId: string;
  amount: number;
  method?: string;
  notes?: string;
  retencionGanancias?: number;
  retencionIibb?: number;
  retencionCertificado?: string;
  imputaciones?: { invoiceId: string; amount: number }[];
}): Promise<ActionResult<{ movementId: string; reciboCcNumero: number | null }>> {
  try {
    await assertCuentasAdmin();
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "El monto debe ser mayor a 0." };
    }
    if (!input.clientId) {
      return { success: false, error: "Falta el cliente." };
    }

    const retencionGanancias = Number(input.retencionGanancias ?? 0);
    const retencionIibb = Number(input.retencionIibb ?? 0);
    if (!Number.isFinite(retencionGanancias) || !Number.isFinite(retencionIibb)) {
      return { success: false, error: "Las retenciones tienen que ser números." };
    }
    if (retencionGanancias < 0 || retencionIibb < 0) {
      return { success: false, error: "Las retenciones no pueden ser negativas." };
    }
    // El monto incluye lo retenido, así que las retenciones son una PARTE de él.
    const sobranRetenciones = retencionExcedente({ amount, retencionGanancias, retencionIibb });
    if (sobranRetenciones > 0) {
      return {
        success: false,
        error: `Las retenciones se pasan ${formatAmount(sobranRetenciones)} del monto del pago. El monto ya incluye lo retenido.`,
      };
    }

    const imputaciones = (input.imputaciones ?? []).map((i) => ({
      invoiceId: i.invoiceId,
      amount: Number(i.amount),
    }));
    if (imputaciones.some((i) => !i.invoiceId)) {
      return { success: false, error: "Hay una imputación sin factura." };
    }
    if (imputaciones.some((i) => !Number.isFinite(i.amount) || i.amount <= 0)) {
      return { success: false, error: "El importe imputado a cada factura tiene que ser mayor a 0." };
    }
    const ids = imputaciones.map((i) => i.invoiceId);
    if (new Set(ids).size !== ids.length) {
      return { success: false, error: "Una misma factura aparece dos veces en la imputación." };
    }
    // Contra el monto que cancela, no contra el neto: la retención cancela factura
    // igual que el efectivo.
    const sobraImputado = imputacionExcedente({ amount }, imputaciones);
    if (sobraImputado > 0) {
      return {
        success: false,
        error: `Lo imputado se pasa ${formatAmount(sobraImputado)} del monto del pago.`,
      };
    }

    const data = await registerAccountPayment({
      kind: input.kind,
      clientId: input.clientId,
      amount,
      method: input.method,
      notes: input.notes,
      retencionGanancias,
      retencionIibb,
      retencionCertificado: input.retencionCertificado,
      imputaciones,
    });
    revalidatePath("/admin/cuentas");
    return { success: true, data };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo registrar el pago.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * Suelta una imputación de un pago (mig 111). El motivo es obligatorio acá y en la
 * RPC: la fila queda como historia, y una historia sin el porqué no sirve de nada
 * cuando dentro de un año haya que explicar por qué se movió esa plata.
 */
export async function revertPaymentImputacionAction(input: {
  imputacionId: string;
  motivo: string;
}): Promise<ActionResult<{ liberado: number; sinImputar: number }>> {
  try {
    await assertCuentasAdmin();
    if (!input.imputacionId) {
      return { success: false, error: "Falta la imputación a desimputar." };
    }
    const motivo = (input.motivo ?? "").trim();
    if (!motivo) {
      return { success: false, error: "Escribí por qué se desimputa." };
    }
    const { liberado, sinImputar } = await revertPaymentImputacion({
      imputacionId: input.imputacionId,
      motivo,
    });
    revalidatePath("/admin/cuentas");
    return { success: true, data: { liberado, sinImputar } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo desimputar el pago.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * Aplica un pago ya registrado a una o más facturas (mig 111): lo que se hace con la
 * plata que quedó libre después de desimputar, o con un adelanto que se cobró antes
 * de que existiera la factura.
 */
export async function addPaymentImputacionesAction(input: {
  movementId: string;
  imputaciones: Array<{ invoiceId: string; amount: number }>;
}): Promise<ActionResult<{ imputado: number; sinImputar: number }>> {
  try {
    await assertCuentasAdmin();
    if (!input.movementId) {
      return { success: false, error: "Falta el pago a imputar." };
    }
    const imputaciones = input.imputaciones ?? [];
    if (imputaciones.length === 0) {
      return { success: false, error: "Elegí al menos una factura." };
    }
    // Se valida acá además de en la RPC porque un importe NaN o negativo llegaría al
    // jsonb como null y el error de la base no diría cuál de las líneas está mal.
    for (const linea of imputaciones) {
      if (!linea.invoiceId) {
        return { success: false, error: "Falta la factura en una de las líneas." };
      }
      const amount = Number(linea.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { success: false, error: "Cada importe imputado debe ser mayor a 0." };
      }
    }
    const data = await addPaymentImputaciones({
      movementId: input.movementId,
      imputaciones: imputaciones.map((i) => ({
        invoiceId: i.invoiceId,
        amount: Number(i.amount),
      })),
    });
    revalidatePath("/admin/cuentas");
    return { success: true, data };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo imputar el pago.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
