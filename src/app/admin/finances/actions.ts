"use server";

import { createClient } from "@/lib/supabase/server";
import { parseActionError } from "@/lib/error-utils";
import { ActionResult } from "@/lib/types";
import { revalidatePath } from "next/cache";

export async function registerPaymentAction(
    reservationId: string,
    amount: number,
    paymentMethod: string,
    notes?: string
): Promise<ActionResult<{ paymentId: string | null }>> {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autorizado." };

    if (!Number.isFinite(amount) || amount <= 0) {
        return { success: false, error: "El monto del pago debe ser mayor a cero." };
    }
    if (!paymentMethod) {
        return { success: false, error: "Seleccioná un método de pago." };
    }

    const { data, error: rpcError } = await supabase.rpc("rpc_register_payment", {
        p_reservation_id: reservationId,
        p_amount: amount,
        p_payment_method: paymentMethod,
        p_notes: notes || null
    });

    if (rpcError) {
        const parsed = parseActionError(rpcError, "Fallo al registrar el pago.");
        return { success: false, error: parsed.error, code: parsed.code };
    }

    const result = (data ?? {}) as { payment_id?: string | null };

    revalidatePath("/admin");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/caja");
    revalidatePath("/admin/guests");
    revalidatePath("/admin/calendario");
    revalidatePath("/admin/timeline");

    return { success: true, data: { paymentId: result.payment_id ?? null } };
}
