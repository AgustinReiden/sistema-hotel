"use server";

import { revalidatePath } from "next/cache";

import { getCtaCteMovements, registerAccountPayment } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, CtaCteClientKind, CtaCteMovimiento } from "@/lib/types";

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
    throw new Error("Permisos insuficientes para gestionar cuentas corrientes.");
  }
}

export async function loadCtaCteAccountAction(
  kind: CtaCteClientKind,
  clientId: string
): Promise<ActionResult<{ movements: CtaCteMovimiento[]; balance: number }>> {
  try {
    await assertAdmin();
    const data = await getCtaCteMovements(kind, clientId);
    return { success: true, data };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cargar la cuenta.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function registerAccountPaymentAction(input: {
  kind: CtaCteClientKind;
  clientId: string;
  amount: number;
  method?: string;
  notes?: string;
}): Promise<ActionResult> {
  try {
    await assertAdmin();
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: "El monto debe ser mayor a 0." };
    }
    if (!input.clientId) {
      return { success: false, error: "Falta el cliente." };
    }
    await registerAccountPayment({
      kind: input.kind,
      clientId: input.clientId,
      amount,
      method: input.method,
      notes: input.notes,
    });
    revalidatePath("/admin/cuentas");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo registrar el pago.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
