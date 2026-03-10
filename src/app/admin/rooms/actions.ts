"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResult, Room } from "@/lib/types";
import { revalidatePath } from "next/cache";

export async function updateRoomAction(roomId: number, roomData: Partial<Room>): Promise<ActionResult> {
    const supabase = await createClient();

    // Auth check (same as createRoomAction / deleteRoomAction)
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autorizado." };
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!["admin", "staff"].includes(profile?.role)) return { success: false, error: "Permisos insuficientes para modificar habitaciones." };

    // Basic validation to prevent overriding ID
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...updateData } = roomData;

    const { error } = await supabase
        .from("rooms")
        .update(updateData)
        .eq("id", roomId);

    if (error) {
        console.error("Error updating room:", error);
        return { success: false, error: "Hubo un error al actualizar la habitación." };
    }

    revalidatePath("/admin/rooms");
    revalidatePath("/");

    return { success: true };
}

export async function createRoomAction(roomData: Partial<Room>): Promise<ActionResult> {
    const supabase = await createClient();

    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autorizado." };
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!["admin", "staff"].includes(profile?.role)) return { success: false, error: "Permisos insuficientes para crear habitaciones." };

    const { error } = await supabase
        .from("rooms")
        .insert({
            ...roomData,
            status: 'available', // initial status
        });

    if (error) {
        console.error("Error creating room:", error);
        return { success: false, error: "Hubo un error al crear la habitación." };
    }

    revalidatePath("/admin/rooms");
    revalidatePath("/");

    return { success: true };
}

export async function deleteRoomAction(roomId: number): Promise<ActionResult> {
    const supabase = await createClient();

    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autorizado." };
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!["admin", "staff"].includes(profile?.role)) return { success: false, error: "Permisos insuficientes para borrar habitaciones." };

    const { error } = await supabase
        .from("rooms")
        .delete()
        .eq("id", roomId);

    if (error) {
        console.error("Error deleting room:", error);
        return { success: false, error: "Hubo un error al borrar la habitación." };
    }

    revalidatePath("/admin/rooms");
    revalidatePath("/");

    return { success: true };
}
