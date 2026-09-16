"use server";

import { revalidatePath } from "next/cache";

import { markInvoicedExternally, unmarkInvoicedExternally } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";

function revalidateControlViews() {
  revalidatePath("/admin/fiscal/control");
  revalidatePath("/admin/fiscal/consolidada");
  revalidatePath("/admin/fiscal");
  revalidatePath("/admin");
}

/**
 * Resultado de una acción en lote. NO es un booleano a propósito: cada estadía se
 * resuelve por separado contra la base, así que el lote puede salir a medias y la
 * pantalla tiene que poder decir exactamente cuáles entraron y cuáles no. Un
 * "listo" a secas sobre un lote parcial dejaría estadías sin facturar que el
 * empleado cree resueltas.
 */
export type BulkActionResult = {
  ok: string[];
  failed: { id: string; error: string }[];
};

/** Descarta ids vacíos y repetidos: marcar dos veces la misma estadía no tiene sentido. */
function normalizeIds(reservationIds: string[]): string[] {
  return [...new Set((reservationIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
}

/**
 * "Ya se facturó por fuera": el contador emitió el comprobante desde el portal de
 * ARCA o desde otro sistema. No emite nada — sólo deja constancia de que esas
 * estadías están cubiertas, para que dejen de figurar como pendientes. Sólo admin
 * (lo enforcea la RPC, igual que en el camino de una sola fila).
 *
 * Itera secuencialmente y no en paralelo para que un error a mitad de camino deje
 * un resultado determinístico y no una carrera. Sin SQL nuevo: reusa la misma
 * primitiva del data layer.
 */
export async function markInvoicedExternallyBulkAction(
  reservationIds: string[],
  ref: string,
  fecha?: string,
  notes?: string
): Promise<BulkActionResult> {
  const result: BulkActionResult = { ok: [], failed: [] };

  for (const id of normalizeIds(reservationIds)) {
    try {
      await markInvoicedExternally(id, ref, fecha, notes);
      result.ok.push(id);
    } catch (error: unknown) {
      const parsed = parseActionError(error, "No se pudo registrar la facturación externa.");
      result.failed.push({ id, error: parsed.error });
    }
  }

  // Una sola revalidación al final: revalidar por fila recalcularía los listados
  // N veces para el mismo resultado.
  if (result.ok.length > 0) revalidateControlViews();
  return result;
}

/** Deshace la marca: las estadías vuelven a figurar como pendientes de facturar. */
export async function unmarkInvoicedExternallyBulkAction(
  reservationIds: string[]
): Promise<BulkActionResult> {
  const result: BulkActionResult = { ok: [], failed: [] };

  for (const id of normalizeIds(reservationIds)) {
    try {
      await unmarkInvoicedExternally(id);
      result.ok.push(id);
    } catch (error: unknown) {
      const parsed = parseActionError(error, "No se pudo deshacer la marca.");
      result.failed.push({ id, error: parsed.error });
    }
  }

  if (result.ok.length > 0) revalidateControlViews();
  return result;
}
