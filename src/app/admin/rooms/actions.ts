"use server";

import { parseActionError } from "@/lib/error-utils";
import { getRoomCapacity } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/server";
import { ActionResult, Room, RoomCategory } from "@/lib/types";
import { revalidatePath } from "next/cache";

function canManageRooms(role: string | null | undefined): boolean {
    return role === "admin" || role === "receptionist";
}

function normalizeCapacityFields(roomData: Partial<Room>) {
    const capacity = getRoomCapacity({
        capacity: roomData.capacity ?? 0,
        capacity_adults: roomData.capacity_adults ?? 0,
        capacity_children: roomData.capacity_children ?? 0,
    });

    return {
        capacity,
        capacity_adults:
            typeof roomData.capacity_adults === "number" && Number.isFinite(roomData.capacity_adults)
                ? roomData.capacity_adults
                : capacity,
        capacity_children:
            typeof roomData.capacity_children === "number" && Number.isFinite(roomData.capacity_children)
                ? roomData.capacity_children
                : 0,
    };
}

function normalizeCategoryFields(roomData: Partial<Room>) {
    const normalizedBasePrice =
        typeof roomData.base_price === "number" && Number.isFinite(roomData.base_price)
            ? roomData.base_price
            : 0;

    return {
        name: roomData.room_type?.trim(),
        ...normalizeCapacityFields(roomData),
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
    };
}

async function upsertRoomCategory(roomData: Partial<Room>): Promise<{ id: number } | { error: string; code?: string }> {
    const supabase = await createClient();
    const payload = normalizeCategoryFields(roomData);

    if (!payload.name) {
        return { error: "La categoria es obligatoria." };
    }

    const { data: existingCategories, error: fetchError } = await supabase
        .from("room_categories")
        .select("id, name, half_day_price, is_active")
        .order("name");

    if (fetchError) {
        const parsed = parseActionError(fetchError, "No se pudo verificar la categoria.");
        return { error: parsed.error, code: parsed.code };
    }

    const existingCategory = ((existingCategories ?? []) as Pick<RoomCategory, "id" | "name" | "half_day_price" | "is_active">[])
        .find((category) => category.name.trim().toLowerCase() === payload.name?.toLowerCase());

    if (existingCategory) {
        const updatePayload = {
            ...payload,
            half_day_price:
                typeof roomData.half_day_price === "number" && Number.isFinite(roomData.half_day_price)
                    ? roomData.half_day_price
                    : existingCategory.half_day_price,
            is_active: roomData.is_active ?? existingCategory.is_active,
        };

        const { error: updateError } = await supabase
            .from("room_categories")
            .update(updatePayload)
            .eq("id", existingCategory.id);

        if (updateError) {
            const parsed = parseActionError(updateError, "No se pudo actualizar la categoria.");
            return { error: parsed.error, code: parsed.code };
        }

        return { id: existingCategory.id };
    }

    const { data: insertedCategory, error: insertError } = await supabase
        .from("room_categories")
        .insert(payload)
        .select("id")
        .single();

    if (insertError) {
        const parsed = parseActionError(insertError, "No se pudo crear la categoria.");
        return { error: parsed.error, code: parsed.code };
    }

    return { id: insertedCategory.id as number };
}

export async function updateRoomAction(roomId: number, roomData: Partial<Room>): Promise<ActionResult> {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "No autorizado." };

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!canManageRooms(profile?.role)) {
        return { success: false, error: "Permisos insuficientes para modificar habitaciones." };
    }

    const categoryResult = await upsertRoomCategory(roomData);
    if ("error" in categoryResult) {
        return { success: false, error: categoryResult.error, code: categoryResult.code };
    }

    const normalizedUpdateData: {
        category_id: number;
        is_active: boolean;
        status?: Room["status"];
    } = {
        category_id: categoryResult.id,
        is_active: roomData.is_active ?? true,
    };

    if (roomData.status) {
        normalizedUpdateData.status = roomData.status;
    }

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

    const categoryResult = await upsertRoomCategory(roomData);
    if ("error" in categoryResult) {
        return { success: false, error: categoryResult.error, code: categoryResult.code };
    }

    const roomNumber = roomData.room_number?.trim();
    if (!roomNumber) {
        return { success: false, error: "El numero de habitacion es obligatorio." };
    }

    const insertData = {
        room_number: roomNumber,
        category_id: categoryResult.id,
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
