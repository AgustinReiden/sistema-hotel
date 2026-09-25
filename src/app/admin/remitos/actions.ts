"use server";

import { revalidatePath } from "next/cache";

import {
  assignRemitoPieza,
  lookupRemito,
  markRemito,
  requestRemitoPaquete,
  resolveRemitoPieza,
  saveRemitosAjustes,
  saveRemitosVencimiento,
} from "@/lib/data";
import { DATE_KEY } from "@/lib/date-range";
import { parseActionError } from "@/lib/error-utils";
import { assertAdmin } from "@/lib/server-auth";
import type { ActionResult, RemitoEstadoPersona, RemitoLookup } from "@/lib/types";

// Las funciones de la base ya exigen admin (mig 116); esto corta antes y con un
// mensaje en castellano, como el resto de las acciones del panel.
const assertRemitosAdmin = () => assertAdmin("Solo un administrador puede controlar los remitos.");

const ESTADOS: ReadonlySet<RemitoEstadoPersona> = new Set(["firmado", "sin_firma", "sin_remito", "a_revisar"]);

function revalidar() {
  revalidatePath("/admin/remitos");
  // El numerito del menú lo calcula el layout.
  revalidatePath("/admin", "layout");
}

function numeroValido(numero: number): boolean {
  return Number.isInteger(numero) && numero >= 1 && numero <= 999999;
}

export async function markRemitoAction(
  movimientoId: string,
  estado: RemitoEstadoPersona,
  nota: string
): Promise<ActionResult> {
  if (!ESTADOS.has(estado)) return { success: false, error: "Estado inválido." };
  try {
    await assertRemitosAdmin();
    await markRemito(movimientoId, estado, nota.trim().slice(0, 300) || undefined);
    revalidar();
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo cambiar el estado del remito.") };
  }
}

export async function lookupRemitoAction(numero: number): Promise<ActionResult<RemitoLookup>> {
  if (!numeroValido(numero)) return { success: false, error: "Número de remito inválido." };
  try {
    await assertRemitosAdmin();
    return { success: true, data: await lookupRemito(numero) };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo buscar el remito.") };
  }
}

export async function assignRemitoPiezaAction(piezaId: string, numero: number): Promise<ActionResult> {
  if (!numeroValido(numero)) return { success: false, error: "Número de remito inválido." };
  try {
    await assertRemitosAdmin();
    await assignRemitoPieza(piezaId, numero);
    revalidar();
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo vincular el escaneo.") };
  }
}

export async function resolveRemitoPiezaAction(
  piezaId: string,
  como: "reescaneada" | "descartada",
  nota: string
): Promise<ActionResult> {
  if (como !== "reescaneada" && como !== "descartada") return { success: false, error: "Opción inválida." };
  try {
    await assertRemitosAdmin();
    await resolveRemitoPieza(piezaId, como, nota.trim().slice(0, 300) || undefined);
    revalidar();
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo resolver la pieza.") };
  }
}

export async function saveRemitosAjustesAction(
  umbralPct: number,
  controlarDesde: number,
  horasVencimiento: number,
  alertarDesde: string
): Promise<ActionResult> {
  if (!Number.isFinite(umbralPct) || umbralPct < 50 || umbralPct > 100) {
    return { success: false, error: "El umbral tiene que estar entre 50 y 100." };
  }
  if (!numeroValido(controlarDesde)) return { success: false, error: "Número de remito inválido." };
  if (!Number.isInteger(horasVencimiento) || horasVencimiento < 1 || horasVencimiento > 720) {
    return { success: false, error: "Las horas para vencer tienen que estar entre 1 y 720." };
  }
  if (!DATE_KEY.test(alertarDesde)) return { success: false, error: "Fecha inválida." };
  try {
    await assertRemitosAdmin();
    await saveRemitosAjustes(Math.round(umbralPct) / 100, controlarDesde);
    await saveRemitosVencimiento(horasVencimiento, alertarDesde);
    revalidar();
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudieron guardar los ajustes.") };
  }
}

export async function pedirPaqueteAction(invoiceId: string): Promise<ActionResult> {
  try {
    await assertRemitosAdmin();
    await requestRemitoPaquete(invoiceId);
    revalidatePath("/admin/remitos");
    return { success: true };
  } catch (error: unknown) {
    return { success: false, ...parseActionError(error, "No se pudo pedir el paquete.") };
  }
}
