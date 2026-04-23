import { getHotelSettings } from "@/lib/data";
import SettingsForm from "./SettingsForm";
import UsersPanel from "./UsersPanel";
import { Settings } from "lucide-react";

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
    const settings = await getHotelSettings();

    return (
        <div className="flex flex-col h-full">
            {/* Header Módulo */}
            <header className="h-16 bg-white border-b border-slate-200 flex items-center px-8 shrink-0">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-slate-100 rounded-lg">
                        <Settings size={20} className="text-slate-600" />
                    </div>
                    <h1 className="text-xl font-bold text-slate-800">Ajustes del Sistema</h1>
                </div>
            </header>

            {/* Contenido */}
            <div className="flex-1 overflow-auto p-8 bg-slate-50">
                <div className="max-w-4xl mx-auto">
                    <div className="mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">Configuración Global</h2>
                        <p className="text-slate-500">Administra las reglas de negocio del hotel, horarios y moneda operativa.</p>
                    </div>

                    <SettingsForm settings={settings} />
                    <UsersPanel />
                </div>
            </div>
        </div>
    );
}
