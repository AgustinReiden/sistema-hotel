// Las tres solapas de /admin/fiscal. Viven acá y no en la página porque las arma el
// servidor (qué listas traer) y las pinta el cliente (las pastillas), y el nombre de
// cada una tiene que ser el mismo en los dos lados: viaja en la URL como ?view=.

export type FiscalView = "sin_facturar" | "emitidas" | "pendientes";

export const FISCAL_VIEWS: { label: string; value: FiscalView }[] = [
  { label: "Sin facturar", value: "sin_facturar" },
  { label: "Emitidas", value: "emitidas" },
  { label: "Pendientes con error", value: "pendientes" },
];

/**
 * Un ?view= inválido o ausente cae siempre en una solapa con contenido, nunca en una
 * pantalla en blanco. El recepcionista tiene una sola solapa (ver el gate `isAdmin`),
 * así que cualquier ?view= que le llegue —de un link viejo o compartido— termina ahí.
 */
export function parseFiscalView(value: string | undefined, isAdmin: boolean): FiscalView {
  if (!isAdmin) return "pendientes";
  if (value === "emitidas" || value === "pendientes") return value;
  return "sin_facturar";
}
