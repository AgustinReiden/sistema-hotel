"use server";

import { revalidatePath } from "next/cache";

import {
  applyLateCheckOut,
  assignWalkIn,
  staffCreateReservation,
  doCheckout,
  markRoomAsAvailable,
  cancelReservation,
  extendReservation,
} from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult } from "@/lib/types";
import { assignWalkInSchema, createReservationSchema } from "@/lib/validations";

type CreateReservationPayload = {
  roomId: number;
  clientName: string;
  checkIn: string;
  checkOut: string;
};

export async function handleLateCheckOut(reservationId: string): Promise<ActionResult> {
  try {
    await applyLateCheckOut(reservationId);
    revalidatePath("/admin");
    revalidatePath("/admin/timeline");
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al cobrar medio dia.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleCheckOut(reservationId: string): Promise<ActionResult> {
  try {
    await doCheckout(reservationId);
    revalidatePath("/admin");
    revalidatePath("/admin/timeline");
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al ejecutar check-out.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleMarkAvailable(roomId: number): Promise<ActionResult> {
  try {
    await markRoomAsAvailable(roomId);
    revalidatePath("/admin");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al marcar habitacion disponible.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleAssignWalkIn(
  roomId: number,
  clientName: string,
  nights: number
): Promise<ActionResult<{ reservationId: string }>> {
  try {
    const validated = assignWalkInSchema.parse({ roomId, clientName, nights });
    const reservationId = await assignWalkIn(
      validated.roomId,
      validated.clientName,
      validated.nights
    );

    revalidatePath("/admin");
    revalidatePath("/admin/timeline");
    revalidatePath("/admin/guests");

    return { success: true, data: { reservationId } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al asignar la habitacion.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleCreateReservation(
  data: CreateReservationPayload
): Promise<ActionResult<{ reservationId: string }>> {
  try {
    const validated = createReservationSchema.parse(data);
    const reservationId = await staffCreateReservation(validated);

    revalidatePath("/admin");
    revalidatePath("/admin/timeline");
    revalidatePath("/admin/guests");

    return { success: true, data: { reservationId } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al crear la reserva.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleCancelReservation(reservationId: string): Promise<ActionResult> {
  try {
    await cancelReservation(reservationId);
    revalidatePath("/admin");
    revalidatePath("/admin/timeline");
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al cancelar la reserva.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleExtendReservation(reservationId: string, nights: number): Promise<ActionResult> {
  try {
    if (nights <= 0) throw new Error("Debe agregar al menos 1 noche.");
    await extendReservation(reservationId, nights);
    revalidatePath("/admin");
    revalidatePath("/admin/timeline");
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al ampliar la reserva.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
