"use server";

import { revalidatePath } from "next/cache";

import { getAssociatedClientLedger } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, AssociatedClientLedger } from "@/lib/types";
import { associatedClientSchema } from "@/lib/validations";

type AssociatedClientFormPayload = {
  displayName: string;
  documentId: string;
  phone?: string;
  discountPercent: number;
  notes?: string;
  cuentaCorrienteHabilitada?: boolean;
  condicionIva?: "responsable_inscripto" | "monotributo" | "consumidor_final";
  domicilio?: string;
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
      cuenta_corriente_habilitada: Boolean(payload.cuentaCorrienteHabilitada),
      condicion_iva: validated.condicionIva ?? null,
      domicilio: validated.domicilio ?? null,
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
        cuenta_corriente_habilitada: Boolean(payload.cuentaCorrienteHabilitada),
        condicion_iva: validated.condicionIva ?? null,
        domicilio: validated.domicilio ?? null,
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

// Borra una empresa/convenio de forma definitiva. Sus pasajeros (company_passengers) se borran
// en cascada; las reservas históricas quedan SIN empresa asociada (FK ON DELETE SET NULL), por lo
// que se pierde su cuenta corriente. Para conservar el historial, preferir archivar.
export async function deleteAssociatedClientAction(id: string): Promise<ActionResult> {
  try {
    const supabase = await assertAdmin();
    const { error } = await supabase.from("associated_clients").delete().eq("id", id);
    if (error) throw error;

    revalidateAssociatedPaths();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo borrar la empresa/convenio.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function loadAssociatedClientLedgerAction(
  clientId: string
): Promise<ActionResult<AssociatedClientLedger>> {
  try {
    await assertAdmin();
    const ledger = await getAssociatedClientLedger(clientId);
    return { success: true, data: ledger };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cargar la ficha del asociado.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
