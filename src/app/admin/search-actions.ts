"use server";

import { searchGlobal } from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import {
  classifySearchTerm,
  EMPTY_GLOBAL_SEARCH,
  shapeGlobalSearch,
} from "@/lib/global-search";
import { assertStaff, isCurrentUserAdmin } from "@/lib/server-auth";
import type { ActionResult, GlobalSearchResult } from "@/lib/types";

/**
 * Buscador global (F1-5a): nombre, DNI, CUIT o número de habitación, para admin y
 * recepción. Recepción recibe un resumen de solo lectura ("Debe" / "No debe", sin
 * monto y sin links); el admin, además el monto y los links con el filtro puesto.
 * Si no se puede saber si es admin, responde como a recepción.
 */
export async function globalSearchAction(
  term: string
): Promise<ActionResult<GlobalSearchResult>> {
  try {
    await assertStaff("No tenés permiso para usar el buscador.");
    const text = typeof term === "string" ? term.slice(0, 100) : "";
    // Menos de 2 caracteres no busca, salvo un número de habitación.
    if (!classifySearchTerm(text)) {
      return { success: true, data: EMPTY_GLOBAL_SEARCH };
    }
    const [esAdmin, matches] = await Promise.all([isCurrentUserAdmin(), searchGlobal(text)]);
    return { success: true, data: shapeGlobalSearch(matches, { esAdmin }) };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo buscar. Probá de nuevo.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
