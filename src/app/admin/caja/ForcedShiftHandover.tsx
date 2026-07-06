"use client";

import CloseShiftModal from "./CloseShiftModal";
import type { PaymentMethod } from "@/lib/types";

type Props = {
  shiftId: string;
  shiftNumber: number;
  openedByName: string | null;
  totalsByMethod: Record<PaymentMethod, number>;
  checkoutsCount: number;
};

/**
 * Bloqueo de traspaso de caja: cuando un recepcionista entra y hay una caja abierta por
 * OTRO usuario, debe rendirla (a ciegas) antes de poder operar. Al cerrarla, se abre su
 * propia caja y sigue trabajando (afterClose="reopen"). No es descartable.
 */
export default function ForcedShiftHandover({
  shiftId,
  shiftNumber,
  openedByName,
  totalsByMethod,
  checkoutsCount,
}: Props) {
  const quien = openedByName ?? "otro usuario";
  return (
    <div className="min-h-screen w-full bg-slate-50">
      <CloseShiftModal
        isOpen
        onClose={() => {}}
        shiftId={shiftId}
        shiftNumber={shiftNumber}
        totalsByMethod={totalsByMethod}
        checkoutsCount={checkoutsCount}
        afterClose="reopen"
        dismissable={false}
        notice={`La caja abierta la dejó ${quien}. Rendila (efectivo a ciegas) antes de poder operar.`}
      />
    </div>
  );
}
