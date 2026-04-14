"use server";

import { revalidatePath } from "next/cache";
import { parseActionError } from "@/lib/error-utils";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, RoomCategory } from "@/lib/types";

function canManageRoomCategories(role: string | null | undefined): boolean {
    return role === "admin" || role === "receptionist";
}

function normalizeCategoryPayload(categoryData: Partial<RoomCategory>) {
    const basePrice =
        typeof categoryData.base_price === "number" && Number.isFinite(categoryData.base_price)
            ? categoryData.base_price
            : 0;

    return {
        name: categoryData.name?.trim(),
        capacity:
            typeof categoryData.capacity === "number" && Number.isFinite(categoryData.capacity)
                ? categoryData.capacity
                : 1,
        capacity_adults:
            typeof categoryData.capacity_adults === "number" && Number.isFinite(categoryData.capacity_adults)
                ? categoryData.capacity_adults
                : typeof categoryData.capacity === "number" && Number.isFinite(categoryData.capacity)
                    ? categoryData.capacity
                    : 1,
        capacity_children:
            typeof categoryData.capacity_children === "number" && Number.isFinite(categoryData.capacity_children)
                ? categoryData.capacity_children
                : 0,
        beds_configuration: categoryData.beds_configuration?.trim() || "1 Cama",
        description: categoryData.description?.trim() || null,
        image_url: categoryData.image_url?.trim() || null,
        amenities: Array.isArray(categoryData.amenities)
            ? categoryData.amenities.map((amenity) => amenity.trim()).filter(Boolean)
            : [],
        base_price: basePrice,
        half_day_price:
            typeof categoryData.half_day_price === "number" && Number.isFinite(categoryData.half_day_price)
                ? categoryData.half_day_price
                : basePrice,
        is_active: categoryData.is_active ?? true,
    };
}

async function ensureAuthorized() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { supabase, error: "No autorizado." };
    }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!canManageRoomCategories(profile?.role)) {
        return { supabase, error: "Permisos insuficientes para gestionar categorias." };
    }

    return { supabase, error: null as string | null };
}

function revalidateRoomAdminPaths() {
    revalidatePath("/admin/categorias");
    revalidatePath("/admin/rooms");
    revalidatePath("/");
}

export async function createRoomCategoryAction(categoryData: Partial<RoomCategory>): Promise<ActionResult> {
    const { supabase, error: authError } = await ensureAuthorized();
    if (authError) return { success: false, error: authError };

    const payload = normalizeCategoryPayload(categoryData);
    if (!payload.name) {
        return { success: false, error: "El nombre de la categoria es obligatorio." };
    }

    const { error } = await supabase
        .from("room_categories")
        .insert(payload);

    if (error) {
        const parsed = parseActionError(error, "Hubo un error al crear la categoria.");
        return { success: false, error: parsed.error, code: parsed.code };
    }

    revalidateRoomAdminPaths();
    return { success: true };
}

export async function updateRoomCategoryAction(categoryId: number, categoryData: Partial<RoomCategory>): Promise<ActionResult> {
    const { supabase, error: authError } = await ensureAuthorized();
    if (authError) return { success: false, error: authError };

    const payload = normalizeCategoryPayload(categoryData);
    if (!payload.name) {
        return { success: false, error: "El nombre de la categoria es obligatorio." };
    }

    const { error } = await supabase
        .from("room_categories")
        .update(payload)
        .eq("id", categoryId);

    if (error) {
        const parsed = parseActionError(error, "Hubo un error al actualizar la categoria.");
        return { success: false, error: parsed.error, code: parsed.code };
    }

    revalidateRoomAdminPaths();
    return { success: true };
}

export async function deleteRoomCategoryAction(categoryId: number): Promise<ActionResult> {
    const { supabase, error: authError } = await ensureAuthorized();
    if (authError) return { success: false, error: authError };

    const { count, error: countError } = await supabase
        .from("rooms")
        .select("id", { count: "exact", head: true })
        .eq("category_id", categoryId);

    if (countError) {
        const parsed = parseActionError(countError, "No se pudo verificar el uso de la categoria.");
        return { success: false, error: parsed.error, code: parsed.code };
    }

    if ((count || 0) > 0) {
        return {
            success: false,
            error: "No se puede eliminar una categoria que todavia tiene habitaciones asignadas.",
        };
    }

    const { error } = await supabase
        .from("room_categories")
        .delete()
        .eq("id", categoryId);

    if (error) {
        const parsed = parseActionError(error, "Hubo un error al eliminar la categoria.");
        return { success: false, error: parsed.error, code: parsed.code };
    }

    revalidateRoomAdminPaths();
    return { success: true };
}
