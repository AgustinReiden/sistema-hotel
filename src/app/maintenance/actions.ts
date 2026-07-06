"use server";

import { revalidatePath } from "next/cache";

import { markRoomClean, markRoomNoKey } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult, CleaningType } from "@/lib/types";

function revalidateMaintenanceViews() {
  revalidatePath("/maintenance");
  revalidatePath("/admin");
  revalidatePath("/admin/mantenimiento");
  revalidatePath("/admin/calendario");
}

export async function markRoomCleanAction(
  roomId: number,
  notes?: string,
  cleaningType?: CleaningType
): Promise<ActionResult<{ alertGenerated: boolean }>> {
  try {
    if (!Number.isInteger(roomId) || roomId <= 0) {
      throw new Error("Habitacion invalida.");
    }
    const result = await markRoomClean(roomId, notes, cleaningType);
    revalidateMaintenanceViews();
    return { success: true, data: result };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo marcar como limpia.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function markRoomNoKeyAction(
  roomId: number,
  notes?: string
): Promise<ActionResult> {
  try {
    if (!Number.isInteger(roomId) || roomId <= 0) {
      throw new Error("Habitacion invalida.");
    }
    await markRoomNoKey(roomId, notes);
    revalidateMaintenanceViews();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo registrar 'sin llave'.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
