"use server";

import { revalidatePath } from "next/cache";

import {
  getCtaCteMovements,
  listClientInvoices,
  listClientPayments,
  registerAccountPayment,
} from "@/lib/data";
import { imputacionExcedente, retencionExcedente } from "@/lib/cc-pagos";
import { parseActionError } from "@/lib/error-utils";
import { formatAmount } from "@/lib/format";
import { assertAdmin } from "@/lib/server-auth";
import type {
  ActionResult,
  CcClientPaymentRow,
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
