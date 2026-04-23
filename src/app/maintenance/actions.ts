"use server";

import { revalidatePath } from "next/cache";

import { markRoomClean } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult } from "@/lib/types";

export async function markRoomCleanAction(
  roomId: number,
  notes?: string
): Promise<ActionResult> {
  try {
    if (!Number.isInteger(roomId) || roomId <= 0) {
      throw new Error("Habitacion invalida.");
    }
    await markRoomClean(roomId, notes);
    revalidatePath("/maintenance");
    revalidatePath("/admin");
    revalidatePath("/admin/calendario");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo marcar como limpia.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
