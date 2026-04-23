"use client";

import { Printer } from "lucide-react";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg inline-flex items-center gap-2"
    >
      <Printer size={16} />
      Imprimir
    </button>
  );
}
