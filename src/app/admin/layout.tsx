import Sidebar from './Sidebar';
import { createClient } from "@/lib/supabase/server";
import { getActiveOpenShift, getShiftSummary } from "@/lib/data";
import OpenShiftAgeAlert from "./OpenShiftAgeAlert";
import IdleLogout from "./IdleLogout";
import ForcedShiftHandover from "./caja/ForcedShiftHandover";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email || "";

    let role = "receptionist";
    let openShift: Awaited<ReturnType<typeof getActiveOpenShift>> | null = null;

    if (user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
        if (profile?.role) {
            role = profile.role;
        }
        openShift = await getActiveOpenShift().catch(() => null);
    }

    // Traspaso de caja: si un recepcionista entra y la caja abierta la dejó OTRO usuario,
    // debe rendirla (a ciegas) antes de operar. Se renderiza SOLO el bloqueo, sin sidebar
    // ni children, para que no pueda tocar nada más. El admin mantiene su lógica actual.
    const forceHandover =
        role === "receptionist" &&
        !!openShift &&
        !!user &&
        openShift.opened_by !== user.id;

    if (forceHandover && openShift) {
        const summary = await getShiftSummary(openShift.id).catch(() => null);
        return (
            <ForcedShiftHandover
                shiftId={openShift.id}
                shiftNumber={openShift.shift_number}
                openedByName={summary?.openedByEmail ?? null}
                totalsByMethod={
                    summary
                        ? { ...summary.totalsByMethod, cash: 0 }
                        : {
                              cash: 0,
                              credit_card: 0,
                              debit_card: 0,
                              bank_transfer: 0,
                              mercado_pago: 0,
                              vale_blanco: 0,
                              cuenta_corriente: 0,
                              other: 0,
                          }
                }
                checkoutsCount={summary?.checkoutsCount ?? 0}
            />
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
            {role === "receptionist" && <IdleLogout />}
            <Sidebar role={role} userEmail={userEmail} hasOpenShift={!!openShift} />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <OpenShiftAgeAlert openedAt={openShift?.opened_at ?? null} />
                {children}
            </main>
        </div>
    );
}
