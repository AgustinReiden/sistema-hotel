/**
 * Recarga la página entera, como F5. La usa el botón "Recargar" de la línea de Hoy y de la
 * pantalla de error de `/admin` cuando la sesión se cerró o el sistema no responde: el
 * celular y la tablet no tienen F5. La pide al servidor de nuevo, así que pasa por el proxy,
 * que lleva a la pantalla de ingreso si la sesión no sirve.
 *
 * Va en un archivo aparte para que los tests la puedan reemplazar: jsdom no deja espiar
 * `window.location.reload`.
 */
export function reloadPage(): void {
  window.location.reload();
}
