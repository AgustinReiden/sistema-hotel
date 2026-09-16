"use client";

// Botón de descarga de CSV genérico para pantallas que ya tienen el dato en
// memoria (a diferencia de caja/ExportCsvButton, que va por server action porque
// exporta un turno entero, no lo que hay en pantalla).

import { Download } from "lucide-react";
import { toast } from "sonner";

type Props = {
  filename: string;
  build: () => string;
  label?: string;
  disabled?: boolean;
  className?: string;
};

/** Un CSV armado con buildCsv trae al menos el header: sin filas de datos, el BOM + header no traen "\r\n". */
function hasDataRows(csv: string): boolean {
  return csv.replace(/^﻿/, "").includes("\r\n");
}

export default function DownloadCsvButton({ filename, build, label, disabled, className }: Props) {
  const handleDownload = () => {
    const csv = build();
    if (!hasDataRows(csv)) {
      toast.info("No hay nada para exportar.");
      return;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={disabled}
      className={
        className ??
        "px-5 py-2.5 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
      }
    >
      <Download size={18} />
      {label ?? "Exportar CSV"}
    </button>
  );
}
