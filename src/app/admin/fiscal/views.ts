// Las dos solapas de /admin/fiscal. Viven acá y no en la página porque las arma el
// servidor (qué listas traer) y las pinta el cliente, y el nombre de cada una tiene que
// ser el mismo en los dos lados: viaja en la URL como ?view=. "Sin facturar" ya no es una
// solapa: es el atajo "Últimos 10 días" de Por facturar (/admin/fiscal/control).

export type FiscalView = "emitidas" | "pendientes";

export const FISCAL_VIEWS: { label: string; value: FiscalView }[] = [
  { label: "Emitidas", value: "emitidas" },
  { label: "Pendientes con error", value: "pendientes" },
];

/**
 * Un ?view= inválido o ausente cae siempre en una solapa con contenido, nunca en una
 * pantalla en blanco: "Con error", para los dos roles. El recepcionista tiene una sola
 * solapa (ver el gate `isAdmin`), así que cualquier ?view= que le llegue —de un link
 * viejo o compartido— termina ahí. (El ?view=sin_facturar del dueño lo redirige la
 * página antes de llegar acá.)
 */
export function parseFiscalView(value: string | undefined, isAdmin: boolean): FiscalView {
  if (!isAdmin) return "pendientes";
  return value === "emitidas" ? "emitidas" : "pendientes";
}
