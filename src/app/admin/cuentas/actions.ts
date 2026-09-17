"use server";

import { revalidatePath } from "next/cache";

import {
  addPaymentImputaciones,
  getCtaCteMovements,
  listClientInvoices,
  registerAccountPayment,
  revertPaymentImputacion,
} from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import { assertAdmin } from "@/lib/server-auth";
import type {
  ActionResult,
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

export async function registerAccountPaymentAction(input: {
  kind: CtaCteClientKind;
  clientId: string;
  amount: number;
  method?: string;
  notes?: string;
}): Promise<ActionResult> {
  try {
    await assertCuentasAdmin();
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "El monto debe ser mayor a 0." };
    }
    if (!input.clientId) {
      return { success: false, error: "Falta el cliente." };
    }
    await registerAccountPayment({
      kind: input.kind,
      clientId: input.clientId,
      amount,
      method: input.method,
      notes: input.notes,
    });
    revalidatePath("/admin/cuentas");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo registrar el pago.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * Suelta una imputación de un pago (mig 110). El motivo es obligatorio acá y en la
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
 * Aplica un pago ya registrado a una o más facturas (mig 110): lo que se hace con la
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
