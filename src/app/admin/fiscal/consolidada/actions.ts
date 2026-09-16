"use server";

import { revalidatePath } from "next/cache";

import { emitInvoice } from "@/lib/arca/emitter";
import { DATE_KEY } from "@/lib/date-range";
import { createConsolidatedInvoiceDraft, listCcAccountStays } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import type {
  ActionResult,
  CcAccountStayRow,
  ConsolidatedInvoicePayload,
  CtaCteClientKind,
  EmitInvoiceOutcome,
} from "@/lib/types";

function revalidateFiscalViews() {
  revalidatePath("/admin/fiscal/consolidada");
  revalidatePath("/admin/fiscal/control");
  revalidatePath("/admin/fiscal");
  revalidatePath("/admin/cuentas");
}

/**
 * Estadías de cuenta corriente del cliente: las pendientes de facturar y las que
 * ya salieron, con su comprobante (mig 90 y 93).
 *
 * `from`/`to` acotan el período (por fecha de salida). El filtro ya existía en la
 * base desde la mig 90 (`p_from`/`p_to` de rpc_list_cc_account_stays) pero la UI
 * nunca lo usaba: sin rango, se devuelve la cuenta entera, que es el caso normal.
 */
export async function loadCcAccountStaysAction(
  kind: CtaCteClientKind,
  clientId: string,
  from?: string,
  to?: string
): Promise<ActionResult<CcAccountStayRow[]>> {
  try {
    // Una clave de día mal formada se ignora en vez de rechazarse: el peor caso es
    // devolver de más, y de más no se factura nada (lo que no está en la lista no
    // se puede seleccionar). Rechazar dejaría la pantalla vacía sin explicar nada.
    const fromKey = from && DATE_KEY.test(from) ? from : undefined;
    const toKey = to && DATE_KEY.test(to) ? to : undefined;
    const rows = await listCcAccountStays(kind, clientId, fromKey, toKey);
    return { success: true, data: rows };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudieron cargar las estadías de la cuenta.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

/**
 * N estadías de cuenta corriente → UNA factura. Mismo patrón que
 * emitInvoiceForReservationAction: draft por RPC (valida todo) y emisión con el
 * emisor de siempre, que no distingue entre una factura de check-out y ésta.
 */
export async function emitConsolidatedInvoiceAction(
  payload: ConsolidatedInvoicePayload
): Promise<ActionResult<EmitInvoiceOutcome & { count: number }>> {
  try {
    const draft = await createConsolidatedInvoiceDraft(payload);
    const outcome = await emitInvoice(draft.invoiceId);
    revalidateFiscalViews();
    return { success: true, data: { ...outcome, count: draft.count } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo emitir la factura consolidada.");
    // 23505 = invoice_reservations_active_uq: otro admin facturó alguna de estas
    // estadías entre que se cargó la lista y se apretó el botón. El mensaje crudo
    // es técnico, así que lo reemplazamos por uno accionable.
    if (parsed.code === "23505") {
      return {
        success: false,
        error: "Alguna estadía ya fue facturada por otro usuario. Recargá la lista y volvé a intentar.",
        code: parsed.code,
      };
    }
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
