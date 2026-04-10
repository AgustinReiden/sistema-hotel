"use client";

import { useState } from "react";
import { X, Loader2, Save } from "lucide-react";
import { createRoomAction } from "./actions";

interface CreateRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function CreateRoomModal({ isOpen, onClose }: CreateRoomModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [roomNumber, setRoomNumber] = useState("");
    const [roomType, setRoomType] = useState("Standard");
    const [capacityAdults, setCapacityAdults] = useState("2");
    const [capacityChildren, setCapacityChildren] = useState("0");
    const [bedsConfiguration, setBedsConfiguration] = useState("1 Cama King");
    const [description, setDescription] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [amenities, setAmenities] = useState("wifi, tv");
    const [basePrice, setBasePrice] = useState("50");

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (!roomNumber) {
            setError("El número de habitación es obligatorio.");
            setLoading(false);
            return;
        }

        const parsedAdults = parseInt(capacityAdults, 10);
        const parsedChildren = parseInt(capacityChildren, 10);

        if (isNaN(parsedAdults) || parsedAdults < 1) {
            setError("La capacidad de adultos debe ser al menos 1.");
            setLoading(false);
            return;
        }

        const parsedPrice = parseFloat(basePrice);
        if (isNaN(parsedPrice) || parsedPrice < 0) {
            setError("El precio base debe ser un número positivo.");
            setLoading(false);
            return;
        }

        const parsedAmenities = amenities
            .split(",")
            .map((a) => a.trim())
            .filter((a) => a.length > 0);

        try {
            const payload = {
                room_number: roomNumber,
                room_type: roomType,
                capacity_adults: parsedAdults,
                capacity_children: isNaN(parsedChildren) ? 0 : parsedChildren,
                beds_configuration: bedsConfiguration,
                description: description,
                image_url: imageUrl,
                amenities: parsedAmenities,
                base_price: parsedPrice,
            };

            const result = await createRoomAction({
                ...payload,
            });

            if (result.success) {
                onClose();
            } else {
                console.error("Room creation failed:", {
                    error: result.error,
                    code: "code" in result ? result.code : undefined,
                    payload,
                });
                setError(result.error);
            }
        } catch (error) {
            console.error("Unexpected error creating room:", error);
            setError("Ocurrio un error inesperado al crear la habitacion.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden relative max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <h2 className="text-2xl font-bold text-slate-800">
                        Crear Nueva Habitación
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    <form id="create-room-form" onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Número de Hab.</label>
                                <input
                                    type="text"
                                    value={roomNumber}
                                    onChange={(e) => setRoomNumber(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    placeholder="Ej. A-101"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Tipo Original</label>
                                <input
                                    type="text"
                                    value={roomType}
                                    onChange={(e) => setRoomType(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    placeholder="Ej. standard, suite, matrimonial"
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Precio x Noche (Base $)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={basePrice}
                                    onChange={(e) => setBasePrice(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Cap. Adultos</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={capacityAdults}
                                        onChange={(e) => setCapacityAdults(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Cap. Niños</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={capacityChildren}
                                        onChange={(e) => setCapacityChildren(e.target.value)}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Configuración de Camas</label>
                            <input
                                type="text"
                                value={bedsConfiguration}
                                onChange={(e) => setBedsConfiguration(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                placeholder="Ej. 1 Cama King + 1 Sofá Cama"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Descripción</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all resize-none"
                                placeholder="Descripción pública de la habitación."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Comodidades (Separadas por comas)</label>
                            <input
                                type="text"
                                value={amenities}
                                onChange={(e) => setAmenities(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                placeholder="wifi, tv, minibar, ocean_view"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">URL de Imagen (Opcional)</label>
                            <input
                                type="url"
                                value={imageUrl}
                                onChange={(e) => setImageUrl(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                placeholder="https://images.unsplash.com/..."
                            />
                        </div>

                        {error && <p className="text-red-500 text-sm font-medium bg-red-50 p-3 rounded-lg">{error}</p>}
                    </form>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        form="create-room-form"
                        disabled={loading}
                        className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-70"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                        Añadir Habitación
                    </button>
                </div>
            </div>
        </div>
    );
}
