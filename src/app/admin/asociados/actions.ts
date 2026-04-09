"use server";

import { revalidatePath } from "next/cache";

import { parseActionError } from "@/lib/error-utils";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { associatedClientSchema } from "@/lib/validations";

type AssociatedClientFormPayload = {
  displayName: string;
  documentId: string;
  phone?: string;
  discountPercent: number;
  notes?: string;
};

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("No autorizado.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error) throw error;
  if (profile?.role !== "admin") {
    throw new Error("Permisos insuficientes para administrar asociados.");
  }

  return supabase;
}

function revalidateAssociatedPaths() {
  revalidatePath("/admin");
  revalidatePath("/admin/calendario");
  revalidatePath("/admin/asociados");
}

export async function createAssociatedClientAction(
  payload: AssociatedClientFormPayload
): Promise<ActionResult> {
  try {
    const supabase = await assertAdmin();
    const validated = associatedClientSchema.parse(payload);

    const { error } = await supabase.from("associated_clients").insert({
      display_name: validated.displayName,
      document_id: validated.documentId,
      phone: validated.phone ?? null,
      discount_percent: validated.discountPercent,
      notes: validated.notes ?? null,
    });

    if (error) throw error;

    revalidateAssociatedPaths();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al crear el asociado.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function updateAssociatedClientAction(
  id: string,
  payload: AssociatedClientFormPayload
): Promise<ActionResult> {
  try {
    const supabase = await assertAdmin();
    const validated = associatedClientSchema.parse(payload);

    const { error } = await supabase
      .from("associated_clients")
      .update({
        display_name: validated.displayName,
        document_id: validated.documentId,
        phone: validated.phone ?? null,
        discount_percent: validated.discountPercent,
        notes: validated.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    revalidateAssociatedPaths();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al actualizar el asociado.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function toggleAssociatedClientStatusAction(
  id: string,
  nextIsActive: boolean
): Promise<ActionResult> {
  try {
    const supabase = await assertAdmin();
    const { error } = await supabase
      .from("associated_clients")
      .update({
        is_active: nextIsActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    revalidateAssociatedPaths();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al actualizar el estado del asociado.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
