"use server";

import { publicCreateReservationByType } from "@/lib/data";
import { ActionResult } from "@/lib/types";
import { publicBookingSchema } from "@/lib/validations";
import { formatPhoneForWhatsapp } from "@/lib/webhook";
import { revalidatePath } from "next/cache";

export async function handlePublicBooking(
    roomType: string,
    clientName: string,
    checkIn: string,
    checkOut: string,
    phoneCountryCode: string,
    phoneLocal: string,
    clientDni: string,
    guestCount?: number
): Promise<ActionResult> {
    try {
        const validated = publicBookingSchema.parse({
            roomType,
            clientName,
            clientDni,
            phoneCountryCode,
            phoneLocal,
            checkIn,
            checkOut,
        });

        const inDate = new Date(checkIn);
        const outDate = new Date(checkOut);
        if (inDate >= outDate) {
            return { success: false, error: "La fecha de salida debe ser posterior a la de llegada." };
        }

        const formattedPhone = formatPhoneForWhatsapp(
            validated.phoneLocal,
            validated.phoneCountryCode
        );

        await publicCreateReservationByType({
            roomType: validated.roomType,
            clientName: validated.clientName,
            checkIn,
            checkOut,
            clientPhone: formattedPhone ?? validated.phoneLocal,
            clientDni: validated.clientDni,
            guestCount: guestCount && guestCount >= 1 ? Math.floor(guestCount) : 1,
        });
        revalidatePath("/");
        revalidatePath("/admin");
        revalidatePath("/admin/solicitudes");
        return { success: true };
    } catch (error: unknown) {
        console.error("Booking error:", error);
        if (error && typeof error === "object" && "issues" in error) {
            const zodError = error as { issues: { message: string }[] };
            return { success: false, error: zodError.issues[0]?.message || "Datos inválidos." };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : "Error al procesar la reserva. Revise la disponibilidad."
        };
    }
}
