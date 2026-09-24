import Sidebar from './Sidebar';
import { MobileTabBar, MobileTopBar } from './MobileNav';
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { countBillingPending, getActiveOpenShift, getRemitosSalud, getShiftSummary } from "@/lib/data";
import { BILLING_PENDING_DAYS, totalPendingBilling } from "@/lib/billing";
import { remitosParaRevisar } from "@/lib/remitos";
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

    // Defensa en profundidad: el middleware ya bloquea /admin sin sesion. Si alguna vez
    // fallara, sin esto el panel se renderizaba igual con el rol "receptionist" por defecto.
    if (!user) redirect("/login");

    const userEmail = user.email || "";

    let role = "receptionist";
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    if (profile?.role) {
        role = profile.role;
    }
    const openShift = await getActiveOpenShift().catch(() => null);

    // Traspaso de caja: si un recepcionista entra y la caja abierta la dejó OTRO usuario,
    // debe rendirla (a ciegas) antes de operar. Se renderiza SOLO el bloqueo, sin sidebar
    // ni children, para que no pueda tocar nada más. El admin mantiene su lógica actual.
    const forceHandover =
        role === "receptionist" &&
        !!openShift &&
        openShift.opened_by !== user.id;

    if (forceHandover && openShift) {
        const summary = await getShiftSummary(openShift.id).catch(() => null);
        return (
            <ForcedShiftHandover
                shiftId={openShift.id}
                shiftNumber={openShift.shift_number}
                openedByName={summary?.openedByName ?? null}
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
                creditCharged={summary?.creditCharged ?? 0}
                creditCharges={summary?.creditCharges ?? []}
                checkoutsCount={summary?.checkoutsCount ?? 0}
            />
        );
    }

    // Contador de "falta facturar" para el badge del admin: el listado de control
    // sólo sirve si alguien lo mira, y este número es lo que hace que lo miren.
    //
    // Misma ventana y misma suma que el control, que es la pantalla que este badge
    // abre. Antes el badge miraba 60 días y sólo `falta` mientras la pantalla sumaba
    // las dos mitades sobre todo el historial: 165 acá y 286 allá, para el mismo dato.
    //
    // Remitos a revisar + piezas sin resolver (mig 116), para el numerito de "Remitos
    // firmados". Si la consulta falla, el menú sigue igual: 0. Las dos cuentas corren a
    // la vez: son una consulta más en cada pantalla del admin.
    const [unbilledCount, remitosPendientes] =
        role === "admin"
            ? await Promise.all([
                  countBillingPending(BILLING_PENDING_DAYS)
                      .then(totalPendingBilling)
                      .catch(() => 0),
                  getRemitosSalud()
                      .then((s) => remitosParaRevisar(s).total)
                      .catch(() => 0),
              ])
            : [0, 0];

    return (
        // Shell de alto fijo: sin una altura definida en este ancestro, los h-full y los
        // flex-1 overflow-auto que traen las páginas no acotan nada y termina scrolleando la
        // ventana entera, con el menú yéndose hacia arriba y position:sticky inútil en todo
        // el panel. h-dvh y no h-screen porque 100vh mide el viewport con la barra de URL
        // retraída y taparía el pie del sidebar; md:min-h-0 es obligatorio porque si sobrevive
        // el min-h-screen, cuando 100vh > 100dvh gana el min-height y vuelve el problema.
        <div data-admin-shell className="h-dvh bg-slate-50 flex flex-col md:flex-row overflow-hidden">
            {role === "receptionist" && <IdleLogout />}
            <MobileTopBar
                role={role}
                userEmail={userEmail}
                hasOpenShift={!!openShift}
                unbilledCount={unbilledCount}
                remitosPendientes={remitosPendientes}
            />
            <Sidebar
                role={role}
                userEmail={userEmail}
                hasOpenShift={!!openShift}
                unbilledCount={unbilledCount}
                remitosPendientes={remitosPendientes}
            />
            <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                <OpenShiftAgeAlert openedAt={openShift?.opened_at ?? null} />
                {/* El que scrollea es este wrapper y no <main> para dejar el aviso de turno
                    viejo FUERA del área scrolleable: adentro, cualquier página con h-full
                    mediría h-full + el alto del banner y aparecería una segunda scrollbar
                    inútil cada vez que hay un turno abierto hace rato. Es flex-col porque
                    varias páginas devuelven un fragmento (<header shrink-0> + <div flex-1
                    overflow-auto>) y dependen de que el padre sea columna flex.
                    Vale para TODOS los tamaños, también el celular: mientras ahí scrolleaba
                    la ventana, la barra de arriba y la de abajo se movían de lugar al
                    scrollear, porque en iOS la barra de URL se contrae, el viewport cambia
                    de alto y todo lo sticky/fixed se reacomoda. Con el alto fijo acá, esas
                    dos barras dejan de ser fijas: son el marco, y el marco no scrollea. */}
                <div data-admin-scroll className="flex-1 min-h-0 flex flex-col overflow-y-auto">
                    {children}
                </div>
            </main>
            <MobileTabBar hasOpenShift={!!openShift} />
        </div>
    );
}
