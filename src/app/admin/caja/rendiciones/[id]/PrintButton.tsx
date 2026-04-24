"use client";

import { usePathname } from "next/navigation";
import { Printer } from "lucide-react";

export default function PrintButton() {
  const pathname = usePathname();

  const handlePrint = () => {
    const url = new URL(window.location.origin + pathname);
    url.searchParams.set("autoprint", "1");
    url.searchParams.set("copy", "original");

    window.open(url.toString(), `rendicion-${Date.now()}`, "width=420,height=720");
  };

  return (
    <button
      onClick={handlePrint}
      className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg inline-flex items-center gap-2"
    >
      <Printer size={16} />
      Imprimir
    </button>
  );
}
