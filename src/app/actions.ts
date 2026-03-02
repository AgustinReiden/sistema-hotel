"use server";

import { publicCreateReservation } from "@/lib/data";
import { ActionResult } from "@/lib/types";
import { revalidatePath } from "next/cache";

export async function handlePublicBooking(
    roomId: number,
    clientName: string,
    checkIn: string,
    checkOut: string
): Promise<ActionResult> {
    try {
        if (!clientName || clientName.trim().length === 0) {
            return { success: false, error: "El nombre es requerido." };
        }

        const inDate = new Date(checkIn);
        const outDate = new Date(checkOut);
        if (inDate >= outDate) {
            return { success: false, error: "La fecha de salida debe ser posterior a la de llegada." };
        }

        await publicCreateReservation({ roomId, clientName, checkIn, checkOut });
        revalidatePath("/");
        revalidatePath("/admin");
        return { success: true };
    } catch (error: unknown) {
        console.error("Booking error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Error al procesar la reserva correcta. Revise la disponibilidad."
        };
    }
}
