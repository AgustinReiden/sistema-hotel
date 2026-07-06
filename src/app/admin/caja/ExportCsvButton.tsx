"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getCheckoutCsvAction } from "./actions";
import { formatShiftCode } from "@/lib/format";

type Props = {
  shiftId: string;
  shiftNumber: number;
  className?: string;
};

export default function ExportCsvButton({ shiftId, shiftNumber, className }: Props) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    const result = await getCheckoutCsvAction(shiftId);
    setLoading(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    if (result.data!.rowCount === 0) {
      toast.info("Este turno no tiene check-outs para exportar.");
      return;
    }

    // Descarga como Blob (síncrono): sobrevive a un logout posterior.
    const blob = new Blob([result.data!.csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reservas-turno-${formatShiftCode(shiftNumber)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading}
      className={
        className ??
        "flex-1 px-5 py-2.5 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
      }
    >
      {loading ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
      Exportar CSV
    </button>
  );
}
