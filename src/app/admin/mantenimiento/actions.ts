"use server";

import { revalidatePath } from "next/cache";

import { resolveAdminAlert } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult } from "@/lib/types";

export async function resolveAdminAlertAction(
  alertId: number,
  notes?: string
): Promise<ActionResult> {
  try {
    if (!Number.isInteger(alertId) || alertId <= 0) {
      throw new Error("Alerta invalida.");
    }
    await resolveAdminAlert(alertId, notes);
    revalidatePath("/admin");
    revalidatePath("/admin/mantenimiento");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo marcar como leída la alerta.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
