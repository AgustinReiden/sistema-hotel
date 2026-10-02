"use server";

import { revalidatePath } from "next/cache";

import { emitInvoice } from "@/lib/arca/emitter";
import { DATE_KEY } from "@/lib/date-range";
import { createConsolidatedInvoiceDraft, listCcAccountStays } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import { assertAdmin } from "@/lib/server-auth";
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
 * Nombre y DNI de la ficha de un huésped, para «Revisá antes de emitir». Con consumidor
 * final, la RPC factura con el nombre y el DNI que tiene la ficha al emitir (mig 103), y
 * la página los leyó al abrirse: si los corrigieron en Huéspedes con la consolidada
 * abierta, el cuadro mostraba los viejos (y un DNI viejo inválido lo trababa hasta
 * recargar la página, que pierde lo tildado y los textos). El cuadro los vuelve a leer
 * con esto cada vez que se abre.
 *
 * Sólo admin, como la consolidada. Sólo lee: esos dos datos, de ese huésped.
 */
export async function loadGuestDocumentAction(
  guestId: string
): Promise<ActionResult<{ fullName: string; documentId: string | null }>> {
  try {
    const supabase = await assertAdmin("Solo el administrador emite facturas consolidadas.");
    const { data, error } = await supabase
      .from("guests")
      .select("full_name, document_id")
      .eq("id", guestId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { success: false, error: "No se encontró el huésped." };
    const ficha = data as { full_name: string; document_id: string | null };
    return {
      success: true,
      data: { fullName: ficha.full_name, documentId: ficha.document_id ?? null },
    };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo leer la ficha del huésped.");
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
