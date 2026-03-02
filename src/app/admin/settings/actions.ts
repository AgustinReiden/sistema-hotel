"use server";

import { revalidatePath } from "next/cache";

import { parseActionError } from "@/lib/error-utils";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { hotelSettingsSchema } from "@/lib/validations";

export async function updateHotelSettings(formData: FormData): Promise<ActionResult> {
  try {
    const rawData = {
      name: String(formData.get("name") ?? ""),
      standard_check_in_time: String(formData.get("standard_check_in_time") ?? ""),
      standard_check_out_time: String(formData.get("standard_check_out_time") ?? ""),
      late_check_out_time: String(formData.get("late_check_out_time") ?? ""),
      currency: String(formData.get("currency") ?? ""),
      contact_email: String(formData.get("contact_email") ?? "") || null,
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
