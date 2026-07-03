import {
  getActiveOpenShift,
  getCurrentUserRole,
  getHotelSettings,
  getShiftSummary,
} from "@/lib/data";
import type { ShiftSummary } from "@/lib/types";
import CajaClient from "./CajaClient";

export const revalidate = 0;

// Arqueo a ciegas: recepcion NO debe ver el efectivo esperado antes de cerrar.
// Se borra el efectivo del resumen ANTES de mandarlo al navegador (no solo en la UI),
// asi el numero no viaja en el payload. El admin sigue viendo todo.
function blindCash(summary: ShiftSummary): ShiftSummary {
  return {
    ...summary,
    cashIncome: 0,
    totalIncome: summary.totalIncome - summary.cashIncome,
    totalsByMethod: { ...summary.totalsByMethod, cash: 0 },
    payments: summary.payments.map((p) =>
      p.payment_method === "cash" ? { ...p, amount: 0 } : p
    ),
  };
}

export default async function CajaPage() {
  const [role, hotelSettings] = await Promise.all([
    getCurrentUserRole(),
    getHotelSettings().catch(() => null),
  ]);
  const canSeeCash = role === "admin";
  const shift = await getActiveOpenShift();
  let summary = shift ? await getShiftSummary(shift.id) : null;
  if (summary && !canSeeCash) {
    summary = blindCash(summary);
  }
  return (
    <CajaClient
      summary={summary}
      isAdmin={role === "admin"}
      canSeeCash={canSeeCash}
      hotelTimezone={hotelSettings?.timezone || "America/Argentina/Tucuman"}
    />
  );
}
