import Link from 'next/link';
import { Clock, CalendarCheck, BedDouble, Users, BarChart3, Settings, Wallet, ClipboardList } from 'lucide-react';
import LogoutButton from './LogoutButton';

export default function Sidebar({ role, userEmail }: { role: string; userEmail: string }) {
    const isAdmin = role === 'admin';

    return (
        <aside className="w-full md:w-64 bg-slate-900 text-slate-300 md:min-h-screen flex flex-col border-r border-slate-800 shrink-0 shadow-2xl z-10 transition-all duration-300">
            <div className="h-16 flex items-center px-6 bg-slate-950/50 border-b border-slate-800">
                <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center mr-3 shadow-lg shadow-emerald-500/20">
                    <BedDouble size={18} className="text-white" />
                </div>
                <Link href="/">
                    <span className="text-white font-bold text-lg tracking-wide hover:opacity-80 transition-opacity">Hotel<span className="text-emerald-400">Sync</span></span>
                </Link>
            </div>

            <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
                <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Recepción</p>
                <Link href="/admin" className="flex items-center px-3 py-2.5 hover:bg-slate-800 rounded-lg group transition-colors focus:bg-brand-500/10 focus:text-emerald-400">
                    <CalendarCheck size={18} className="mr-3" />
                    <span className="font-medium">Dashboard Hoy</span>
                </Link>
                <Link href="/admin/timeline" className="flex items-center px-3 py-2.5 hover:bg-slate-800 rounded-lg group transition-colors">
                    <Clock size={18} className="mr-3 group-hover:text-emerald-400 transition-colors" />
                    <span className="font-medium">Time-Line</span>
                </Link>
                <Link href="/admin/solicitudes" className="flex items-center px-3 py-2.5 hover:bg-slate-800 rounded-lg group transition-colors">
                    <ClipboardList size={18} className="mr-3 group-hover:text-emerald-400 transition-colors" />
                    <span className="font-medium">Solicitudes</span>
                </Link>
                <Link href="/admin/guests" className="flex items-center px-3 py-2.5 hover:bg-slate-800 rounded-lg group transition-colors">
                    <Users size={18} className="mr-3 group-hover:text-emerald-400 transition-colors" />
                    <span className="font-medium">Huéspedes</span>
                </Link>

                {isAdmin && (
                    <>
                        <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 mt-6">Administración</p>
                        <Link href="/admin/finances" className="flex items-center px-3 py-2.5 hover:bg-slate-800 rounded-lg group transition-colors">
                            <Wallet size={18} className="mr-3 group-hover:text-emerald-400 transition-colors" />
                            <span className="font-medium">Finanzas</span>
                        </Link>
                        <Link href="/admin/rooms" className="flex items-center px-3 py-2.5 hover:bg-slate-800 rounded-lg group transition-colors">
                            <BedDouble size={18} className="mr-3 group-hover:text-emerald-400 transition-colors" />
                            <span className="font-medium">Habitaciones</span>
                        </Link>
                        <Link href="/admin/settings" className="flex items-center px-3 py-2.5 hover:bg-slate-800 rounded-lg group transition-colors">
                            <Settings size={18} className="mr-3 group-hover:text-emerald-400 transition-colors" />
                            <span className="font-medium">Ajustes</span>
                        </Link>
                        <a href="#" className="flex items-center px-3 py-2.5 hover:bg-slate-800 rounded-lg group transition-colors hidden">
                            <BarChart3 size={18} className="mr-3 group-hover:text-emerald-400 transition-colors" />
                            <span className="font-medium">Reportes</span>
                        </a>
                    </>
                )}
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
