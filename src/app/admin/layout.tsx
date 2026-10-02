import { Suspense } from "react";
import Sidebar from './Sidebar';
import AdminTopBar from './AdminTopBar';
import { MobileTabBar, MobileTopBar } from './MobileNav';
import { MobileMenuProvider } from './MobileMenuContext';
import type { NavState } from "./nav-links";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
    countBillingPending,
    getActiveOpenShift,
    getPendingSolicitudesCount,
    getRemitosSalud,
    getShiftSummary,
    getUnresolvedAdminAlertsCount,
    listPendingInvoices,
} from "@/lib/data";
import { BILLING_PENDING_DAYS, facturasConError, totalPendingBilling } from "@/lib/billing";
import { remitosParaRevisar } from "@/lib/remitos";
import OpenShiftAgeAlert from "./OpenShiftAgeAlert";
import IdleLogout from "./IdleLogout";
import ForcedShiftHandover from "./caja/ForcedShiftHandover";
import AdminAlertsBell from "./AdminAlertsBell";

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
        .select('role, full_name')
        .eq('id', user.id)
        .single();
    if (profile?.role) {
        role = profile.role;
    }
    // Con qué usuario se entró, para el "¿No sos vos?" del traspaso forzado. Si el perfil
    // no tiene nombre cargado va el email: la salida tiene que estar igual.
    const currentUserName: string = profile?.full_name?.trim() || userEmail;
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
        // El cierre por inactividad va también acá, igual que en el panel: una PC olvidada
        // en Hoy pasa sola a este bloqueo cuando otra recepcionista abre la caja, y sin esto
        // la sesión de la que se fue no vencía nunca. Va primero en el fragmento, en el
        // mismo lugar que en el panel: si cambia de lugar en el árbol, React lo desmonta y
        // lo vuelve a montar al pasar de una rama a la otra, y los 30 minutos arrancan de
        // cero sin que nadie haya tocado nada.
        return (
            <>
                {role === "receptionist" && <IdleLogout />}
                <ForcedShiftHandover
                    shiftId={openShift.id}
                    shiftNumber={openShift.shift_number}
                    openedByName={summary?.openedByName ?? null}
                    currentUserName={currentUserName}
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
            </>
        );
    }

    // Contador de "falta facturar" para el badge del admin: el listado de control
    // sólo sirve si alguien lo mira, y este número es lo que hace que lo miren.
    //
    // Misma ventana y misma suma que el control, que es la pantalla que este badge
    // abre. Antes el badge miraba 60 días y sólo `falta` mientras la pantalla sumaba
    // las dos mitades sobre todo el historial: 165 acá y 286 allá, para el mismo dato.
    //
    // Remitos a revisar + vencidos + piezas sin resolver (migs 116 y 124), para el
    // numerito de Remitos: el mismo total que la línea "Para revisar" del panel.
    //
    // Solicitudes sin responder y facturas que no salieron (rechazadas o trabadas más de
    // 15 minutos) van para los dos roles: a recepción la RPC ya le trae solo las de su
    // turno. Lo del dueño (falta facturar y remitos) no se le pide a recepción.
    //
    // Los avisos sin revisar de la campana son solo del dueño (`admin_alerts` tiene RLS de
    // admin): a recepción ni se le piden ni se le dibuja la campana.
    //
    // Las cinco cuentas corren a la vez, y si una falla ese numerito queda en 0 y el
    // menú sigue: el layout envuelve todo el panel.
    const isAdmin = role === "admin";
    const now = new Date();
    const [unbilledCount, remitosPendientes, solicitudesPendientes, facturasConErrorCount, adminAlertsCount] = await Promise.all([
        isAdmin
            ? countBillingPending(BILLING_PENDING_DAYS)
                  .then(totalPendingBilling)
                  .catch(() => 0)
            : 0,
        isAdmin
            ? getRemitosSalud()
                  .then((s) => remitosParaRevisar(s).total)
                  .catch(() => 0)
            : 0,
        getPendingSolicitudesCount().catch(() => 0),
        listPendingInvoices()
            .then((rows) => facturasConError(rows, now).length)
            .catch(() => 0),
        isAdmin ? getUnresolvedAdminAlertsCount().catch(() => 0) : 0,
    ]);
    const navState: NavState = {
        hasOpenShift: !!openShift,
        unbilledCount,
        remitosPendientes,
        solicitudesPendientes,
        facturasConError: facturasConErrorCount,
    };
    // La campana va en los dos lugares (la barra de arriba en el escritorio y, en el
    // celular, a la izquierda de la hamburguesa); cada una se esconde en el otro tamaño.
    const alertsBell = (placement: "desktop" | "mobile") =>
        isAdmin ? <AdminAlertsBell initialCount={adminAlertsCount} placement={placement} /> : undefined;

    return (
        // Shell de alto fijo: sin una altura definida en este ancestro, los h-full y los
        // flex-1 overflow-auto que traen las páginas no acotan nada y termina scrolleando la
        // ventana entera, con el menú yéndose hacia arriba y position:sticky inútil en todo
        // el panel. h-dvh y no h-screen porque 100vh mide el viewport con la barra de URL
        // retraída y taparía el pie del sidebar; md:min-h-0 es obligatorio porque si sobrevive
        // el min-h-screen, cuando 100vh > 100dvh gana el min-height y vuelve el problema.
        //
        // IdleLogout va primero y fuera del shell, en el mismo lugar que en la rendición
        // forzada (ver arriba): así, cuando un refresco pasa la PC de una rama a la otra,
        // React conserva el componente y el conteo de inactividad sigue corriendo. No dibuja
        // nada: el shell queda igual.
        <>
            {role === "receptionist" && <IdleLogout />}
            {/* El provider va dentro del fragmento y no por fuera: IdleLogout tiene que seguir
                siendo el primer hijo de la raíz, como en la rendición forzada. */}
            <MobileMenuProvider>
            <div data-admin-shell className="h-dvh bg-slate-50 flex flex-col md:flex-row overflow-hidden">
                {/* Los dos menús leen ?view= con useSearchParams, y eso pide un <Suspense>
                    alrededor o `next build` falla. Los reemplazos ocupan el mismo lugar
                    que el menú para que nada salte mientras cargan. */}
                <Suspense
                    fallback={
                        <div
                            aria-hidden
                            className="md:hidden shrink-0 h-14 border-b border-slate-800 bg-slate-900 print:hidden"
                        />
                    }
                >
                    <MobileTopBar role={role} userEmail={userEmail} {...navState} actions={alertsBell("mobile")} />
                </Suspense>
                <Suspense
                    fallback={
                        <aside
                            aria-hidden
                            className="hidden md:block md:w-64 md:h-dvh bg-slate-900 border-r border-slate-800 shrink-0"
                        />
                    }
                >
                    <Sidebar role={role} userEmail={userEmail} {...navState} />
                </Suspense>
                <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                    {/* Las pestañas de la sección van arriba de todo y fuera del wrapper que
                        scrollea: son parte del marco, no del contenido. Lee la ruta y ?view=
                        como los menús, así que también pide su <Suspense>; no ocupa lugar
                        mientras carga porque con una sola pestaña no se dibuja. */}
                    <Suspense fallback={null}>
                        <AdminTopBar role={role} {...navState} actions={alertsBell("desktop")} />
                    </Suspense>
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
                {/* Lee la ruta y ?view= para marcar la sección actual, así que pide su
                    <Suspense>; el reemplazo ocupa el alto de la barra (con padding de 10 px
                    + icono de 20 + texto: unos 56 px) para que nada salte al cargar. */}
                <Suspense
                    fallback={
                        <div
                            aria-hidden
                            className="md:hidden shrink-0 h-14 border-t border-slate-800 bg-slate-900 print:hidden"
                        />
                    }
                >
                    <MobileTabBar role={role} {...navState} />
                </Suspense>
            </div>
            </MobileMenuProvider>
        </>
    );
}
