"use client";

import type { ReactNode } from "react";
import { Bell } from "lucide-react";

import { OPEN_ALERTS_EVENT } from "@/lib/admin-alerts";

type Props = {
  className?: string;
  children?: ReactNode;
};

// Abre la campana de avisos (AdminAlertsBell, en el marco del panel) desde cualquier
// pantalla: por ejemplo el cartel ámbar de Hoy. Solo dispara el evento; la campana es la
// que pide la lista.
export default function OpenAlertsButton({ className, children }: Props) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_ALERTS_EVENT))}
      className={className}
    >
      {children ?? (
        <>
          <Bell size={16} />
          Ver avisos
        </>
      )}
    </button>
  );
}
