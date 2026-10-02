import { redirect } from "next/navigation";
import { getCurrentUserRole, getFiscalSettings, getHotelSettings } from "@/lib/data";
import SettingsPanels from "./SettingsPanels";
import { parseSettingsTab, type SettingsTab } from "./tabs";
import { FileText, Settings, Users } from "lucide-react";

export const dynamic = 'force-dynamic';

const TAB_HEADERS: Record<SettingsTab, { title: string; description: string; icon: typeof Settings }> = {
    hotel: {
        title: "Hotel y mensajes",
        description: "Datos del hotel, horarios, contacto, mensaje de confirmación y la página principal.",
        icon: Settings,
    },
    arca: {
        title: "Facturación electrónica (ARCA)",
        description: "Ambiente, CUIT, punto de venta y datos que salen impresos en las facturas.",
        icon: FileText,
    },
    usuarios: {
        title: "Usuarios",
        description: "Nombre y rol de quienes usan el sistema.",
        icon: Users,
    },
};

export default async function SettingsPage({
    searchParams,
}: {
    searchParams: Promise<{ tab?: string | string[] }>;
}) {
    // Sólo admin: acá se cambian los datos del hotel, la facturación y los roles.
    const role = await getCurrentUserRole();
    if (role !== "admin") redirect("/forbidden");

    const tab = parseSettingsTab((await searchParams).tab);
    const header = TAB_HEADERS[tab];
    const Icon = header.icon;

    const settings = await getHotelSettings();
    const fiscalSettings = await getFiscalSettings().catch(() => null);

    return (
        <div className="flex flex-col h-full">
            {/* Header Módulo */}
            <header className="min-h-16 bg-white border-b border-slate-200 flex flex-wrap items-center gap-2 px-4 py-3 md:px-8 md:py-0 shrink-0">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-slate-100 rounded-lg">
                        <Icon size={20} className="text-slate-600" />
                    </div>
                    <h1 className="text-xl font-bold text-slate-800">{header.title}</h1>
                </div>
            </header>

            {/* Contenido */}
            <div className="flex-1 overflow-auto p-4 md:p-8 bg-slate-50">
                <div className="max-w-4xl mx-auto">
                    <div className="mb-6">
                        <p className="text-slate-500">{header.description}</p>
                    </div>

                    {/* Los tres paneles quedan montados: lo tipeado en uno sobrevive al cambio de pestaña. */}
                    <SettingsPanels tab={tab} settings={settings} fiscalSettings={fiscalSettings} />
                </div>
            </div>
        </div>
    );
}
