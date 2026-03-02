"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResult } from "@/lib/types";
import { revalidatePath } from "next/cache";

export async function registerPaymentAction(
    reservationId: string,
    amount: number,
    paymentMethod: string,
    notes?: string
): Promise<ActionResult> {
    const supabase = await createClient();

    // The RPC will handle staff permissions internally 
    // but Next.js Action should ideally catch if no user quickly
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autorizado." };

    const { error: rpcError } = await supabase.rpc("rpc_register_payment", {
        p_reservation_id: reservationId,
        p_amount: amount,
        p_payment_method: paymentMethod,
        p_notes: notes || null
    });

    if (rpcError) {
        console.error("Payment registration failed", rpcError);
        return { success: false, error: rpcError.message || "Fallo al registrar el pago." };
    }

    revalidatePath("/admin/finances");
    revalidatePath("/admin/guests");
    revalidatePath("/admin/timeline");

    return { success: true };
}
