"use server";

import { revalidatePath } from "next/cache";

import {
  closeCashShift,
  getCloseShiftBlockers,
  getHotelSettings,
  getShiftCheckoutExport,
  openCashShift,
  reportShiftCloseConflict,
} from "@/lib/data";
import { buildCheckoutCsv } from "@/lib/csv";
import { parseActionError } from "@/lib/error-utils";
import type { ActionResult, CloseShiftBlockersResult } from "@/lib/types";
import { closeShiftSchema, reportShiftConflictSchema } from "@/lib/validations";

function revalidateCajaViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/caja");
  revalidatePath("/admin/caja/rendiciones");
  revalidatePath("/admin/finances");
}

export async function openShiftAction(): Promise<ActionResult<{ shiftId: string }>> {
  try {
    const shiftId = await openCashShift();
    revalidateCajaViews();
    return { success: true, data: { shiftId } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo abrir la caja.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function closeShiftAction(input: {
  shiftId: string;
  actualCash: number;
  notes?: string;
}): Promise<
  ActionResult<{
    expected_cash: number;
    actual_cash: number;
    discrepancy: number;
    shouldLogout: boolean;
  }>
> {
  try {
    const { shiftId, actualCash, notes } = closeShiftSchema.parse(input);
    const result = await closeCashShift(shiftId, actualCash, notes);

    // Caja unica por hotel: cerrar la caja YA NO cierra sesion. Quien la cierra
    // sigue trabajando; para el proximo turno se abre una caja nueva (a mano con
    // "Abrir Caja", o sola en el proximo login). shouldLogout se conserva en el
    // contrato por compatibilidad, siempre false.
    const shouldLogout = false;

    // IMPORTANTE: no revalidamos aca. Cualquier revalidatePath dispara un re-render
    // de /admin/caja que pasa a summary=null y DESMONTA el modal de cierre antes de
    // que el usuario pueda imprimir el comprobante o apretar "Listo". El front
    // refresca con router.refresh() al apretar "Listo".
    return { success: true, data: { ...result, shouldLogout } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cerrar la caja.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * Reservas vencidas que bloquean el cierre + aviso de alertas de limpieza.
 * Sin revalidate: es una lectura para el modal de cierre.
 */
export async function getCloseShiftBlockersAction(): Promise<
  ActionResult<CloseShiftBlockersResult>
> {
  try {
    const result = await getCloseShiftBlockers();
    return { success: true, data: result };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudieron verificar las salidas pendientes.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * Salida "reportar al admin" del guard de cierre: registra el conflicto de la
 * reserva vencida (admin_alert) y desbloquea el cierre de caja.
 */
export async function reportShiftConflictAction(input: {
  reservationId: string;
  notes: string;
}): Promise<ActionResult<{ alertId: number; alreadyReported: boolean }>> {
  try {
    const { reservationId, notes } = reportShiftConflictSchema.parse(input);
    const result = await reportShiftCloseConflict(reservationId, notes);
    revalidatePath("/admin/mantenimiento"); // el panel de alertas del admin
    return { success: true, data: result };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo reportar el conflicto.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * Genera el CSV fiscal de los check-outs del turno (1 fila por check-out). El texto ya viene
 * formateado (formato AR); el cliente sólo arma el Blob y dispara la descarga.
 */
export async function getCheckoutCsvAction(
  shiftId: string
): Promise<ActionResult<{ csv: string; rowCount: number }>> {
  try {
    const [rows, hotelSettings] = await Promise.all([
      getShiftCheckoutExport(shiftId),
      getHotelSettings().catch(() => null),
    ]);
    const tz = hotelSettings?.timezone || "America/Argentina/Tucuman";
    const csv = buildCheckoutCsv(rows, tz);
    return { success: true, data: { csv, rowCount: rows.length } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo generar el CSV.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
