'use client';

import type { ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import SectionTabs from './SectionTabs';
import { findActiveNav, getNavSections, type NavState } from './nav-links';

type AdminTopBarProps = NavState & {
    role: string;
    /** A la derecha de la fila: la campana (F1-3) y el buscador (F1-5b). */
    actions?: ReactNode;
};

// La barra de arriba del contenido: la sección donde estás y sus pestañas a la izquierda,
// y a la derecha un lugar para acciones del panel. Con una sola pestaña no hay nada que
// elegir y no se dibuja (recepción en Facturación, Hoy); tampoco en un comprobante para
// imprimir, que no es ninguna pantalla del menú. En el celular queda solo la fila de
// pestañas: el nombre de la sección ya lo dice el menú de arriba.
//
// No busca datos: los numeritos los calcula el layout y llegan por props, igual que en los
// menús. `print:hidden` porque los recibos y las facturas se reimprimen desde el panel.
export default function AdminTopBar({ role, actions, ...navState }: AdminTopBarProps) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const sections = getNavSections(role, navState);
    const active = findActiveNav(sections, pathname, searchParams);

    const showTabs = !!active && active.section.tabs.length > 1;
    if (!active || (!showTabs && !actions)) return null;

    // Sin pestañas, en el celular la fila quedaría vacía: la campana del admin ahí va en
    // la barra negra de arriba (MobileTopBar), así que solo se dibuja en el escritorio.
    return (
        <div
            data-admin-topbar
            className={`${showTabs ? "flex" : "hidden md:flex"} h-12 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 md:px-6 print:hidden`}
        >
            <div className="flex min-w-0 flex-1 items-stretch self-stretch gap-4">
                <span className="hidden shrink-0 items-center text-sm font-bold text-slate-800 md:flex">
                    {active.section.label}
                </span>
                {showTabs && <SectionTabs tabs={active.section.tabs} activeTabId={active.tab.id} />}
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
    );
}
