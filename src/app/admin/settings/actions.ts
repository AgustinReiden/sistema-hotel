"use server";

import { revalidatePath } from "next/cache";

import { parseActionError } from "@/lib/error-utils";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, ManageableProfile, UserRole } from "@/lib/types";
import { hotelSettingsSchema } from "@/lib/validations";

export async function updateHotelSettings(formData: FormData): Promise<ActionResult> {
  try {
    const rawData = {
      name: String(formData.get("name") ?? ""),
      standard_check_in_time: String(formData.get("standard_check_in_time") ?? ""),
      standard_check_out_time: String(formData.get("standard_check_out_time") ?? ""),
      late_check_out_time: String(formData.get("late_check_out_time") ?? ""),
      timezone: String(formData.get("timezone") ?? "America/Argentina/Tucuman"),
      currency: String(formData.get("currency") ?? ""),
      contact_email: String(formData.get("contact_email") ?? ""),
      contact_phone: String(formData.get("contact_phone") ?? ""),
      contact_instagram: String(formData.get("contact_instagram") ?? "") || null,
      address: String(formData.get("address") ?? ""),
      hero_title: String(formData.get("hero_title") ?? ""),
      hero_subtitle: String(formData.get("hero_subtitle") ?? ""),
      hero_image_url: String(formData.get("hero_image_url") ?? "") || null,
      services_image_url: String(formData.get("services_image_url") ?? "") || null,
      logo_url: String(formData.get("logo_url") ?? "") || null,
    };

    const validated = hotelSettingsSchema.parse(rawData);
    const supabase = await createClient();

    const { error } = await supabase
      .from("hotel_settings")
      .update({
        ...validated,
        hero_image_url: validated.hero_image_url || null,
        services_image_url: validated.services_image_url || null,
        logo_url: validated.logo_url || null,
        contact_instagram: validated.contact_instagram || null
      })
      .eq("id", 1);

    if (error) {
      return { success: false, error: error.message, code: error.code };
    }

    revalidatePath("/admin/settings");
    revalidatePath("/admin");
    revalidatePath("/");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al actualizar ajustes.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

// ─── Gestión de usuarios (admin-only) ──────────────────────────────────

export async function listManageableUsersAction(): Promise<ActionResult<ManageableProfile[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_admin_list_profiles");
    if (error) throw error;
    const rows = (data ?? []) as {
      id: string;
      email: string;
      full_name: string | null;
      role: UserRole;
      created_at: string;
    }[];
    return { success: true, data: rows };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cargar la lista de usuarios.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function updateProfileAction(
  userId: string,
  fullName: string,
  role: UserRole
): Promise<ActionResult> {
  try {
    if (!userId) throw new Error("Usuario invalido.");
    if (!fullName || !fullName.trim()) throw new Error("El nombre es obligatorio.");
    if (role !== "admin" && role !== "receptionist" && role !== "client")
      throw new Error("Rol invalido.");

    const supabase = await createClient();
    const { error } = await supabase.rpc("rpc_admin_update_profile", {
      p_user_id: userId,
      p_full_name: fullName.trim(),
      p_role: role,
    });
    if (error) throw error;
    revalidatePath("/admin/settings");
    revalidatePath("/admin");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo actualizar el usuario.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
