"use server";

import { revalidatePath } from "next/cache";

import { closeCashShift, openCashShift } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult } from "@/lib/types";
import { closeShiftSchema, openShiftSchema } from "@/lib/validations";

function revalidateCajaViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/caja");
  revalidatePath("/admin/caja/reportes");
  revalidatePath("/admin/finances");
}

export async function openShiftAction(input: {
  openingCash: number;
}): Promise<ActionResult<{ shiftId: string }>> {
  try {
    const { openingCash } = openShiftSchema.parse(input);
    const shiftId = await openCashShift(openingCash);
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
  ActionResult<{ expected_cash: number; actual_cash: number; discrepancy: number }>
> {
  try {
    const { shiftId, actualCash, notes } = closeShiftSchema.parse(input);
    const result = await closeCashShift(shiftId, actualCash, notes);
    revalidateCajaViews();
    return { success: true, data: result };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cerrar la caja.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
