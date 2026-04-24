"use client";

import { useEffect, useRef } from "react";

type ThermalAutoPrintProps = {
  nextUrl?: string;
  closeOnDone?: boolean;
};

export default function ThermalAutoPrint({
  nextUrl,
  closeOnDone = false,
}: ThermalAutoPrintProps) {
  const handledRef = useRef(false);

  useEffect(() => {
    const handleDone = () => {
      if (handledRef.current) return;
      handledRef.current = true;

      if (nextUrl) {
        window.location.replace(nextUrl);
        return;
      }

      if (closeOnDone) {
        window.close();
      }
    };

    const printTimer = window.setTimeout(() => {
      try {
        window.print();
      } catch {
        // noop
      }
    }, 250);

    const onAfterPrint = () => {
      window.setTimeout(handleDone, 150);
    };

    window.addEventListener("afterprint", onAfterPrint);

    return () => {
      clearTimeout(printTimer);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [closeOnDone, nextUrl]);

  return null;
}
