"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import type { RoomCategory } from "@/lib/types";

type CategoryModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: Partial<RoomCategory>) => Promise<{ success: boolean; error?: string }>;
    category?: RoomCategory | null;
    title: string;
};

type CategoryFormState = {
    name: string;
    capacity: string;
    capacityAdults: string;
    capacityChildren: string;
    bedsConfiguration: string;
    description: string;
    amenities: string;
    imageUrl: string;
    basePrice: string;
    halfDayPrice: string;
    isActive: boolean;
};

function buildFormState(category?: RoomCategory | null): CategoryFormState {
    return {
        name: category?.name ?? "",
        capacity: String(category?.capacity ?? 2),
        capacityAdults: String(category?.capacity_adults ?? category?.capacity ?? 2),
        capacityChildren: String(category?.capacity_children ?? 0),
        bedsConfiguration: category?.beds_configuration ?? "1 Cama King",
        description: category?.description ?? "",
        amenities: category?.amenities.join(", ") ?? "wifi, tv",
        imageUrl: category?.image_url ?? "",
        basePrice: String(category?.base_price ?? 50),
        halfDayPrice: String(category?.half_day_price ?? category?.base_price ?? 50),
        isActive: category?.is_active ?? true,
    };
}

export default function CategoryModal({
    isOpen,
    onClose,
    onSubmit,
    category,
    title,
}: CategoryModalProps) {
    const [form, setForm] = useState<CategoryFormState>(() => buildFormState(category));
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setForm(buildFormState(category));
    }, [category, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!form.name.trim()) {
            toast.error("El nombre de la categoria es obligatorio.");
            return;
        }

        const capacity = parseInt(form.capacity, 10);
        const capacityAdults = parseInt(form.capacityAdults, 10);
        const capacityChildren = parseInt(form.capacityChildren, 10);
        const basePrice = parseFloat(form.basePrice);
        const halfDayPrice = parseFloat(form.halfDayPrice);

        if ([capacity, capacityAdults, capacityChildren].some((value) => Number.isNaN(value))) {
            toast.error("Las capacidades deben ser numeros validos.");
            return;
        }

        if ([basePrice, halfDayPrice].some((value) => Number.isNaN(value) || value < 0)) {
            toast.error("Los precios deben ser numeros positivos.");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await onSubmit({
                name: form.name.trim(),
                capacity,
                capacity_adults: capacityAdults,
                capacity_children: capacityChildren,
                beds_configuration: form.bedsConfiguration.trim(),
                description: form.description.trim() || null,
                amenities: form.amenities
                    .split(",")
                    .map((amenity) => amenity.trim())
                    .filter(Boolean),
                image_url: form.imageUrl.trim() || null,
                base_price: basePrice,
                half_day_price: halfDayPrice,
                is_active: form.isActive,
            });

            if (result.success) {
                toast.success(category ? "Categoria actualizada." : "Categoria creada.");
                onClose();
                return;
            }

            toast.error(result.error || "No se pudo guardar la categoria.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden max-h-[92vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <h2 className="text-xl font-bold text-slate-800">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    <form id="category-form" onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Nombre</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    placeholder="Ej. Suite Premium"
                                    required
                                />
                            </div>
                            <div className="flex items-end">
                                <label className="inline-flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={form.isActive}
                                        onChange={(e) => setForm((current) => ({ ...current, isActive: e.target.checked }))}
                                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                                    />
                                    Categoria activa
                                </label>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Precio x Noche</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.basePrice}
                                    onChange={(e) => setForm((current) => ({ ...current, basePrice: e.target.value }))}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Precio Medio Dia</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.halfDayPrice}
                                    onChange={(e) => setForm((current) => ({ ...current, halfDayPrice: e.target.value }))}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Capacidad Total</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={form.capacity}
                                    onChange={(e) => setForm((current) => ({ ...current, capacity: e.target.value }))}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Adultos</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={form.capacityAdults}
                                    onChange={(e) => setForm((current) => ({ ...current, capacityAdults: e.target.value }))}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Ninos</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={form.capacityChildren}
                                    onChange={(e) => setForm((current) => ({ ...current, capacityChildren: e.target.value }))}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Configuracion de Camas</label>
                            <input
                                type="text"
                                value={form.bedsConfiguration}
                                onChange={(e) => setForm((current) => ({ ...current, bedsConfiguration: e.target.value }))}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                placeholder="Ej. 1 Cama King + 1 Sofa Cama"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Descripcion</label>
                            <textarea
                                rows={3}
                                value={form.description}
                                onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all resize-none"
                                placeholder="Descripcion publica de la categoria."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Comodidades (Separadas por comas)</label>
                            <input
                                type="text"
                                value={form.amenities}
                                onChange={(e) => setForm((current) => ({ ...current, amenities: e.target.value }))}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                placeholder="wifi, tv, frigobar"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">URL de Imagen</label>
                            <input
                                type="url"
                                value={form.imageUrl}
                                onChange={(e) => setForm((current) => ({ ...current, imageUrl: e.target.value }))}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                placeholder="https://images.unsplash.com/..."
                            />
                        </div>
                    </form>
                </div>

                <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        form="category-form"
                        disabled={isSubmitting}
                        className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-all shadow-sm flex items-center gap-2 disabled:opacity-70"
                    >
                        {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                        Guardar Categoria
                    </button>
                </div>
            </div>
        </div>
    );
}
