'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { NavBadge, NavTab } from './nav-links';

const BADGE_TONE: Record<NavBadge['tone'], string> = {
    ok: 'text-emerald-700 bg-emerald-50',
    warn: 'text-amber-700 bg-amber-50',
    alert: 'text-rose-700 bg-rose-50',
};

/**
 * El link de una pestaña, llevándose de la URL actual los parámetros que la pestaña
 * declara (`keepParams`) y que la URL de la pantalla actual trae con valor. Los que el
 * link ya trae (el ?view= de la pestaña de destino) no se pisan.
 */
export function tabHref(
    tab: Pick<NavTab, 'href' | 'keepParams'>,
    current?: { get(name: string): string | null } | null
): string {
    if (!tab.keepParams?.length || !current) return tab.href;
    const [path, query = ''] = tab.href.split('?');
    const params = new URLSearchParams(query);
    for (const name of tab.keepParams) {
        const value = current.get(name);
        if (value && !params.has(name)) params.set(name, value);
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
}

type SectionTabsProps = {
    tabs: NavTab[];
    activeTabId: string | undefined;
};

// Las pestañas de la sección activa, en una sola fila arriba del contenido. Es de cliente
// porque lleva el rango de fechas de la URL a la pestaña que se toca. En el celular la
// fila scrollea hacia el costado en vez de partirse en dos renglones.
export default function SectionTabs({ tabs, activeTabId }: SectionTabsProps) {
    const searchParams = useSearchParams();
    return (
        <nav aria-label="Pestañas de la sección" className="flex items-stretch self-stretch gap-1 overflow-x-auto min-w-0">
            {tabs.map((tab) => {
                const active = tab.id === activeTabId;
                return (
                    <Link
                        key={tab.id}
                        href={tabHref(tab, searchParams)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm transition-colors ${
                            active
                                ? 'border-brand-700 font-semibold text-brand-700'
                                : 'border-transparent font-medium text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        {tab.label}
                        {tab.badge && (
                            <span
                                title={tab.badge.title}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${BADGE_TONE[tab.badge.tone]}`}
                            >
                                {tab.badge.text}
                            </span>
                        )}
                    </Link>
                );
            })}
        </nav>
    );
}
