"use client";

import CloseShiftModal from "./CloseShiftModal";
import type { PaymentMethod, ShiftCreditChargeRow } from "@/lib/types";

type Props = {
  shiftId: string;
  shiftNumber: number;
  openedByName: string | null;
  /** Con qué usuario se entró: si no es quien está frente a la caja, puede cerrar sesión. */
  currentUserName: string;
  totalsByMethod: Record<PaymentMethod, number>;
  /** Fiado a cuenta corriente del turno que se está rindiendo. */
  creditCharged: number;
  /** Las estadías detrás de ese total. */
  creditCharges: ShiftCreditChargeRow[];
  checkoutsCount: number;
};

/**
 * Bloqueo de traspaso de caja: cuando un recepcionista entra y hay una caja abierta por
 * OTRO usuario, debe rendirla (a ciegas) antes de poder operar. Al cerrarla, se abre su
 * propia caja y sigue trabajando (afterClose="reopen"). No es descartable, pero dice con
 * qué usuario se entró y deja cerrar sesión sin rendir ("¿No sos vos?").
 */
export default function ForcedShiftHandover({
  shiftId,
  shiftNumber,
  openedByName,
  currentUserName,
  totalsByMethod,
  creditCharged,
  creditCharges,
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
        creditCharged={creditCharged}
        creditCharges={creditCharges}
        checkoutsCount={checkoutsCount}
        afterClose="reopen"
        dismissable={false}
        context="handover"
        notice={`La caja abierta la dejó ${quien}. Rendila (efectivo a ciegas) antes de poder operar.`}
        identity={{ name: currentUserName }}
      />
    </div>
  );
}
