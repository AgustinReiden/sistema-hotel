/**
 * Abre un impreso de comandera (recibo, remito, factura) en una ventana chica, con la
 * misma firma que el resto de los impresos: la página se imprime sola con ?autoprint=1.
 *
 * Devuelve false si la ventana no abrió. Pasa cuando el navegador bloquea las
 * ventanas emergentes, y para ese momento el cobro o el check-out ya están asentados
 * en la base: el que llama tiene que mostrar que falta el papel (PrintBlockedModal)
 * en lugar de tragarse el bloqueo en silencio.
 */
export function openPrintWindow(path: string, name: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.open(path, name, "width=420,height=720"));
  } catch {
    return false;
  }
}
