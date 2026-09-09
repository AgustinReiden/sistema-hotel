"use server";

import { revalidatePath } from "next/cache";

import { authorizeOldTariff, rejectOldTariff, resolveAdminAlert } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import { assertAdmin } from "@/lib/server-auth";
import type { ActionResult } from "@/lib/types";

// Las tres RPC de alertas (rpc_resolve_admin_alert, rpc_authorize_old_tariff y
// rpc_reject_old_tariff) arrancan con `IF NOT public.app_is_admin()`, asi que el rol ya
// estaba validado en la base. El assert de aca corta antes y devuelve un mensaje claro
// en vez del "Acceso denegado" crudo, y deja escrito en el codigo que son solo-admin.

export async function resolveAdminAlertAction(
  alertId: number,
  notes?: string
): Promise<ActionResult> {
  try {
    await assertAdmin("Solo un administrador puede resolver alertas.");
    if (!Number.isInteger(alertId) || alertId <= 0) {
      throw new Error("Alerta invalida.");
    }
    await resolveAdminAlert(alertId, notes);
    revalidatePath("/admin");
    revalidatePath("/admin/mantenimiento");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo marcar como leída la alerta.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function authorizeOldTariffAction(alertId: number): Promise<ActionResult> {
  try {
    await assertAdmin("Solo un administrador puede resolver alertas.");
    if (!Number.isInteger(alertId) || alertId <= 0) {
      throw new Error("Alerta invalida.");
    }
    await authorizeOldTariff(alertId);
    revalidatePath("/admin");
    revalidatePath("/admin/mantenimiento");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo autorizar la tarifa anterior.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function rejectOldTariffAction(alertId: number): Promise<ActionResult> {
  try {
    await assertAdmin("Solo un administrador puede resolver alertas.");
    if (!Number.isInteger(alertId) || alertId <= 0) {
      throw new Error("Alerta invalida.");
    }
    await rejectOldTariff(alertId);
    revalidatePath("/admin");
    revalidatePath("/admin/mantenimiento");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo rechazar la solicitud.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
