"use server";

import { parseActionError } from "@/lib/error-utils";
import { createClient } from "@/lib/supabase/server";
import { ActionResult, Room } from "@/lib/types";
import { revalidatePath } from "next/cache";

function canManageRooms(role: string | null | undefined): boolean {
    return role === "admin" || role === "receptionist";
}

function calculateLegacyCapacity(roomData: Partial<Room>): number {
    const adults =
        typeof roomData.capacity_adults === "number" && Number.isFinite(roomData.capacity_adults)
            ? roomData.capacity_adults
            : 0;
    const children =
        typeof roomData.capacity_children === "number" && Number.isFinite(roomData.capacity_children)
            ? roomData.capacity_children
            : 0;

    return Math.max(1, adults + children);
}

export async function updateRoomAction(roomId: number, roomData: Partial<Room>): Promise<ActionResult> {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autorizado." };

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!canManageRooms(profile?.role)) {
        return { success: false, error: "Permisos insuficientes para modificar habitaciones." };
    }

    // Prevent overriding the room ID from client state.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, ...updateData } = roomData;
    const normalizedUpdateData = {
        ...updateData,
        capacity: calculateLegacyCapacity(roomData),
    };

    const { error } = await supabase
        .from("rooms")
        .update(normalizedUpdateData)
        .eq("id", roomId);

    if (error) {
        console.error("Error updating room:", error);
        const parsed = parseActionError(error, "Hubo un error al actualizar la habitacion.");
        return { success: false, error: parsed.error, code: parsed.code };
    }

    revalidatePath("/admin/rooms");
    revalidatePath("/");

    return { success: true };
}

export async function createRoomAction(roomData: Partial<Room>): Promise<ActionResult> {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autorizado." };

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!canManageRooms(profile?.role)) {
        return { success: false, error: "Permisos insuficientes para crear habitaciones." };
    }

    const normalizedBasePrice =
        typeof roomData.base_price === "number" && Number.isFinite(roomData.base_price)
            ? roomData.base_price
            : 0;

    const insertData = {
        ...roomData,
        room_number: roomData.room_number?.trim(),
        room_type: roomData.room_type?.trim(),
        capacity: calculateLegacyCapacity(roomData),
        beds_configuration: roomData.beds_configuration?.trim(),
        description: roomData.description?.trim() || null,
        image_url: roomData.image_url?.trim() || null,
        amenities: Array.isArray(roomData.amenities)
            ? roomData.amenities.map((amenity) => amenity.trim()).filter(Boolean)
            : [],
        base_price: normalizedBasePrice,
        half_day_price:
            typeof roomData.half_day_price === "number" && Number.isFinite(roomData.half_day_price)
                ? roomData.half_day_price
                : normalizedBasePrice,
        is_active: roomData.is_active ?? true,
        status: roomData.status ?? "available",
    };

    const { error } = await supabase
        .from("rooms")
        .insert(insertData);

    if (error) {
        console.error("Error creating room:", error);
        const parsed = parseActionError(error, "Hubo un error al crear la habitacion.");
        return { success: false, error: parsed.error, code: parsed.code };
    }

    revalidatePath("/admin/rooms");
    revalidatePath("/");

    return { success: true };
}

export async function deleteRoomAction(roomId: number): Promise<ActionResult> {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autorizado." };

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!canManageRooms(profile?.role)) {
        return { success: false, error: "Permisos insuficientes para borrar habitaciones." };
    }

    const { error } = await supabase
        .from("rooms")
        .delete()
        .eq("id", roomId);

    if (error) {
        console.error("Error deleting room:", error);
        const parsed = parseActionError(error, "Hubo un error al borrar la habitacion.");
        return { success: false, error: parsed.error, code: parsed.code };
    }

    revalidatePath("/admin/rooms");
    revalidatePath("/");

    return { success: true };
}
