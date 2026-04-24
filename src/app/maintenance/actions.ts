"use server";

import { revalidatePath } from "next/cache";

import { markRoomClean } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult, CleaningType } from "@/lib/types";

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
    revalidatePath("/maintenance");
    revalidatePath("/admin");
    revalidatePath("/admin/mantenimiento");
    revalidatePath("/admin/calendario");
    return { success: true, data: result };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo marcar como limpia.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
