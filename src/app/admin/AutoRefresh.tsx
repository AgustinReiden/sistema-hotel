"use client";

import { useAutoRefresh } from "./useAutoRefresh";

/**
 * Pone al día Hoy cada 30 segundos y al volver a la pestaña, sin interrumpir a quien
 * está escribiendo. Existe para poder usar el hook desde una página que es server
 * component: no pinta nada.
 */
export default function AutoRefresh() {
  useAutoRefresh();
  return null;
}
