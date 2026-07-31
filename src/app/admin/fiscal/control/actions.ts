"use server";

import { revalidatePath } from "next/cache";

import { markInvoicedExternally, unmarkInvoicedExternally } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult } from "@/lib/types";

function revalidateControlViews() {
  revalidatePath("/admin/fiscal/control");
  revalidatePath("/admin/fiscal/consolidada");
  revalidatePath("/admin/fiscal");
  revalidatePath("/admin");
}

/**
 * "Ya se facturó por fuera": el contador emitió el comprobante desde el portal de
 * ARCA o desde otro sistema. No emite nada — sólo deja constancia de que esa
 * estadía está cubierta, para que deje de figurar como pendiente. Sólo admin.
 */
export async function markInvoicedExternallyAction(
  reservationId: string,
  ref: string,
  fecha?: string,
  notes?: string
): Promise<ActionResult> {
  try {
    await markInvoicedExternally(reservationId, ref, fecha, notes);
    revalidateControlViews();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo registrar la facturación externa.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/** Deshace la marca: la estadía vuelve a figurar como pendiente de facturar. */
export async function unmarkInvoicedExternallyAction(
  reservationId: string
): Promise<ActionResult> {
  try {
    await unmarkInvoicedExternally(reservationId);
    revalidateControlViews();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo deshacer la marca.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
