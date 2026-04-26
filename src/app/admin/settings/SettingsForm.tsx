"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { updateHotelSettings } from "./actions";
import type { HotelSettings } from "@/lib/types";

export default function SettingsForm({ settings }: { settings: HotelSettings }) {
    const [isPending, startTransition] = useTransition();
    const whatsappPhone = settings?.contact_whatsapp_phone || settings?.contact_phone || "";
    const fixedPhone = settings?.contact_fixed_phone || "";

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        startTransition(async () => {
            const result = await updateHotelSettings(formData);
            if (result.success) {
                toast.success("Ajustes guardados correctamente");
            } else {
                toast.error(result.error);
            }
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl bg-white p-8 rounded-xl border border-slate-200 shadow-sm">
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-slate-800 border-b pb-2">Información General</h3>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nombre del Hotel</label>
                    <input
                        type="text"
                        name="name"
                        defaultValue={settings?.name || ""}
                        required
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Moneda (ej. USD, ARS)</label>
                    <input
                        type="text"
                        name="currency"
                        defaultValue={settings?.currency || "USD"}
                        required
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                    />
                </div>
            </div>

            <div className="space-y-4 pt-4">
                <h3 className="text-lg font-semibold text-slate-800 border-b pb-2">Horarios de Recepción</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Hora Base Check-In</label>
                        <input
                            type="time"
                            name="standard_check_in_time"
                            defaultValue={settings?.standard_check_in_time?.substring(0, 5) || "14:00"}
                            required
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Hora Base Check-Out</label>
                        <input
                            type="time"
                            name="standard_check_out_time"
                            defaultValue={settings?.standard_check_out_time?.substring(0, 5) || "10:00"}
                            required
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Límite Extendido (Medio Día penalidad)</label>
                    <input
                        type="time"
                        name="late_check_out_time"
                        defaultValue={settings?.late_check_out_time?.substring(0, 5) || "18:00"}
                        required
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                        Si un huésped se queda después de esta hora, se le cobrará el día completo en lugar de medio día.
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Zona Horaria</label>
                    <select
                        name="timezone"
                        defaultValue={settings?.timezone || "America/Argentina/Tucuman"}
                        required
                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                    >
                        <option value="America/Argentina/Buenos_Aires">Argentina - Buenos Aires</option>
                        <option value="America/Argentina/Tucuman">Argentina - Tucumán</option>
                        <option value="America/Argentina/Cordoba">Argentina - Córdoba</option>
                        <option value="America/Argentina/Mendoza">Argentina - Mendoza</option>
                        <option value="America/Argentina/Salta">Argentina - Salta</option>
                        <option value="America/Montevideo">Uruguay - Montevideo</option>
                        <option value="America/Santiago">Chile - Santiago</option>
                        <option value="America/Sao_Paulo">Brasil - São Paulo</option>
                        <option value="America/Asuncion">Paraguay - Asunción</option>
                        <option value="America/La_Paz">Bolivia - La Paz</option>
                    </select>
                    <p className="text-xs text-slate-500 mt-1">
                        Zona horaria usada para calcular horarios de check-in/check-out y medio día.
                    </p>
                </div>
            </div>

            <div className="space-y-4 pt-4">
                <h3 className="text-lg font-semibold text-slate-800 border-b pb-2">Información de Contacto</h3>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email de Contacto</label>
                    <input type="email" name="contact_email" defaultValue={settings?.contact_email || ""} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" placeholder="contacto@hotel.com" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Instagram (@usuario o link)</label>
                        <input type="text" name="contact_instagram" defaultValue={settings?.contact_instagram || ""} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp (horario comercial)</label>
                        <input type="text" name="contact_whatsapp_phone" defaultValue={whatsappPhone} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" placeholder="+54 381 4000000" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Telefono fijo (24 horas)</label>
                        <input type="text" name="contact_fixed_phone" defaultValue={fixedPhone} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" placeholder="+54 381 4000001" />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Dirección Física</label>
                    <input type="text" name="address" defaultValue={settings?.address || ""} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" />
                </div>
            </div>

            <div className="space-y-4 pt-4">
                <h3 className="text-lg font-semibold text-slate-800 border-b pb-2">Identidad y Página Principal</h3>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Logo del Hotel (URL)</label>
                    <input type="text" name="logo_url" defaultValue={settings?.logo_url || ""} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" placeholder="https://... o /images/logo.png" />
                    <p className="text-xs text-slate-500 mt-1">Si se deja vacío, se mostrará un icono de Estrella por defecto.</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Título Principal (Hero)</label>
                    <input type="text" name="hero_title" defaultValue={settings?.hero_title || ""} required className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Subtítulo (Hero)</label>
                    <textarea name="hero_subtitle" defaultValue={settings?.hero_subtitle || ""} required rows={3} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all resize-none"></textarea>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">URL de la Imagen de Fondo (Hero)</label>
                    <input type="text" name="hero_image_url" defaultValue={settings?.hero_image_url || ""} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" placeholder="https://... o /images/..." />
                    <p className="text-xs text-slate-500 mt-1">
                        Puedes pegar un link directo a una imagen (ej. Unsplash) o usar una imagen guardada localmente arrancando con <code>/</code> (ej. <code>/images/fondo.jpg</code>).
                    </p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">URL de la Imagen de Servicios</label>
                    <input type="text" name="services_image_url" defaultValue={settings?.services_image_url || ""} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all" placeholder="https://... o /images/..." />
                    <p className="text-xs text-slate-500 mt-1">
                        Imagen que aparece a la derecha de las facilidades. El formato debe ser igual que arriba.
                    </p>
                </div>
            </div>

            <div className="pt-4 flex justify-end">
                <button
                    type="submit"
                    disabled={isPending}
                    className="px-6 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg transition-colors shadow-sm focus:ring-4 focus:ring-brand-500/20 disabled:opacity-50"
                >
                    {isPending ? "Guardando..." : "Guardar Ajustes"}
                </button>
            </div>
        </form>
    );
}
