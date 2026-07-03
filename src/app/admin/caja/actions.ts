"use server";

import { revalidatePath } from "next/cache";

import { closeCashShift, openCashShift } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult } from "@/lib/types";
import { closeShiftSchema } from "@/lib/validations";

function revalidateCajaViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/caja");
  revalidatePath("/admin/caja/rendiciones");
  revalidatePath("/admin/finances");
}

export async function openShiftAction(): Promise<ActionResult<{ shiftId: string }>> {
  try {
    const shiftId = await openCashShift();
    revalidateCajaViews();
    return { success: true, data: { shiftId } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo abrir la caja.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function closeShiftAction(input: {
  shiftId: string;
  actualCash: number;
  notes?: string;
}): Promise<
  ActionResult<{
    expected_cash: number;
    actual_cash: number;
    discrepancy: number;
    shouldLogout: boolean;
  }>
> {
  try {
    const { shiftId, actualCash, notes } = closeShiftSchema.parse(input);
    const result = await closeCashShift(shiftId, actualCash, notes);

    // Caja unica por hotel: cerrar la caja YA NO cierra sesion. Quien la cierra
    // sigue trabajando; para el proximo turno se abre una caja nueva (a mano con
    // "Abrir Caja", o sola en el proximo login). shouldLogout se conserva en el
    // contrato por compatibilidad, siempre false.
    const shouldLogout = false;

    // IMPORTANTE: no revalidamos aca. Cualquier revalidatePath dispara un re-render
    // de /admin/caja que pasa a summary=null y DESMONTA el modal de cierre antes de
    // que el usuario pueda imprimir el comprobante o apretar "Listo". El front
    // refresca con router.refresh() al apretar "Listo".
    return { success: true, data: { ...result, shouldLogout } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cerrar la caja.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
