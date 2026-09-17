import Link from 'next/link';
import { BedDouble } from 'lucide-react';
import LogoutButton from './LogoutButton';
import { getNavSections, type NavBadge } from './nav-links';

const BADGE_TONE: Record<NavBadge['tone'], string> = {
    ok: 'text-emerald-400 bg-emerald-950/40',
    warn: 'text-amber-400 bg-amber-950/40',
    alert: 'text-rose-300 bg-rose-950/50',
};

export default function Sidebar({ role, userEmail, hasOpenShift, unbilledCount = 0 }: { role: string; userEmail: string; hasOpenShift?: boolean; unbilledCount?: number }) {
    const isAdmin = role === 'admin';
    const sections = getNavSections(role, { hasOpenShift, unbilledCount });

    // Sólo escritorio: abajo de 768px el menú lo manejan <MobileTopBar> y <MobileTabBar>.
    // Antes este mismo <aside> se estiraba a w-full y se apilaba arriba del contenido, así
    // que en el celular había que scrollear medio metro de links para ver el primer dato.
    //
    // h-dvh (no min-h-screen) para que el sidebar mida exactamente lo mismo que el shell:
    // con el min-height mandando, el pie con el usuario y "Cerrar sesión" queda fuera de la
    // ventana y el <nav flex-1 overflow-y-auto> nunca llega a scrollear solo.
    return (
        <aside className="hidden md:flex md:w-64 md:h-dvh bg-slate-900 text-slate-300 flex-col border-r border-slate-800 shrink-0 shadow-2xl z-10">
            <div className="h-16 flex items-center px-6 bg-slate-950/50 border-b border-slate-800">
                <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center mr-3 shadow-lg shadow-emerald-500/20">
                    <BedDouble size={18} className="text-white" />
                </div>
                <Link href="/">
                    <span className="text-white font-bold text-lg tracking-wide hover:opacity-80 transition-opacity">El <span className="text-emerald-400">Refugio</span></span>
                </Link>
            </div>

            <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
                {sections.map((section, sectionIndex) => (
                    <div key={section.title}>
                        <p className={`px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 ${sectionIndex > 0 ? 'mt-6' : ''}`}>
                            {section.title}
                        </p>
                        {section.items.map((item) => {
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className="flex items-center px-3 py-2.5 hover:bg-slate-800 rounded-lg group transition-colors"
                                >
                                    <Icon
                                        size={18}
                                        className={`mr-3 shrink-0 transition-colors ${item.highlighted ? 'text-emerald-400' : 'group-hover:text-emerald-400'}`}
                                    />
                                    <span className="font-medium flex-1">{item.label}</span>
                                    {item.badge && (
                                        <span
                                            title={item.badge.title}
                                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${BADGE_TONE[item.badge.tone]}`}
                                        >
                                            {item.badge.text}
                                        </span>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </nav>

            <div className="p-4 border-t border-slate-800">
                <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center w-full px-2">
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center mr-3 border border-slate-600 shrink-0">
                            <span className="text-xs font-bold text-white">{isAdmin ? 'AD' : 'RC'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{isAdmin ? 'Admin' : 'Recepcionista'}</p>
                            <p className="text-xs text-slate-500 truncate">{userEmail || 'Recepción'}</p>
                        </div>
                    </div>
                    <div className="w-full">
                        <LogoutButton />
                    </div>
                </div>
            </div>
        </aside>
    );
}
