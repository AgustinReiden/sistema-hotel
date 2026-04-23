"use client";

import { useEffect } from "react";

/**
 * Dispara window.print() al montarse. En Chrome en modo kiosk
 * (flag --kiosk-printing), el navegador imprime directamente sin
 * diálogo. Para desarrollo/config inicial, el diálogo se abre y el
 * usuario solo apreta Enter.
 */
export default function ReceiptAutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        // noop
      }
    }, 250);
    return () => clearTimeout(t);
  }, []);
  return null;
}
