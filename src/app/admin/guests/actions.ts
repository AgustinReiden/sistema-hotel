"use server";

import { revalidatePath } from "next/cache";

import { parseActionError } from "@/lib/error-utils";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, GuestRecord } from "@/lib/types";

export type GuestRecordPayload = {
  fullName: string;
  documentType?: string | null;
  documentId?: string | null;
  phone?: string | null;
  address?: string | null;
  locality?: string | null;
  nationality?: string | null;
  profession?: string | null;
  discountPercent: number;
};

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autorizado.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  if (profile?.role !== "admin") {
    throw new Error("Permisos insuficientes para administrar huéspedes.");
  }
  return supabase;
}

const clean = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

// Carga la ficha completa de un huésped del padrón para el modal de edición.
export async function loadGuestRecordAction(id: string): Promise<ActionResult<GuestRecord>> {
  try {
    const supabase = await assertAdmin();
    const { data, error } = await supabase
      .from("guests")
      .select(
        "id, full_name, document_type, document_id, phone, address, locality, nationality, profession, discount_percent"
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { success: false, error: "No se encontró el huésped." };
    return { success: true, data: { ...data, discount_percent: Number(data.discount_percent ?? 0) } as GuestRecord };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cargar el huésped.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function updateGuestAction(
  id: string,
  payload: GuestRecordPayload
): Promise<ActionResult> {
  try {
    const supabase = await assertAdmin();

    const fullName = payload.fullName.trim();
    if (fullName.length < 2) {
      return { success: false, error: "El nombre debe tener al menos 2 caracteres." };
    }
    const percent = Number(payload.discountPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { success: false, error: "El descuento debe estar entre 0 y 100." };
    }

    const { error } = await supabase
      .from("guests")
      .update({
        full_name: fullName,
        document_type: clean(payload.documentType),
        document_id: clean(payload.documentId),
        phone: clean(payload.phone),
        address: clean(payload.address),
        locality: clean(payload.locality),
        nationality: clean(payload.nationality),
        profession: clean(payload.profession),
        discount_percent: percent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;

    revalidatePath("/admin/guests");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo actualizar el huésped.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

// Borra un huésped del padrón. Las reservas pasadas NO se tocan (FK guest_id ON DELETE SET NULL).
export async function deleteGuestAction(id: string): Promise<ActionResult> {
  try {
    const supabase = await assertAdmin();
    const { error } = await supabase.from("guests").delete().eq("id", id);
    if (error) throw error;

    revalidatePath("/admin/guests");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo borrar el huésped.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
