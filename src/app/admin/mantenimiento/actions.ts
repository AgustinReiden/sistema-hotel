"use server";

import { revalidatePath } from "next/cache";

import { authorizeOldTariff, rejectOldTariff, resolveAdminAlert } from "@/lib/data";
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

export async function authorizeOldTariffAction(alertId: number): Promise<ActionResult> {
  try {
    if (!Number.isInteger(alertId) || alertId <= 0) {
      throw new Error("Alerta invalida.");
    }
    await authorizeOldTariff(alertId);
    revalidatePath("/admin");
    revalidatePath("/admin/mantenimiento");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo autorizar la tarifa anterior.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function rejectOldTariffAction(alertId: number): Promise<ActionResult> {
  try {
    if (!Number.isInteger(alertId) || alertId <= 0) {
      throw new Error("Alerta invalida.");
    }
    await rejectOldTariff(alertId);
    revalidatePath("/admin");
    revalidatePath("/admin/mantenimiento");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo rechazar la solicitud.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
