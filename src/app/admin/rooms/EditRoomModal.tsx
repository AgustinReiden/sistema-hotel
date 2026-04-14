"use client";

import { useState } from "react";
import { X, Loader2, Save } from "lucide-react";
import type { Room, RoomCategory } from "@/lib/types";
import { getRoomCapacity } from "@/lib/rooms";
import { updateRoomAction } from "./actions";
import RoomTypeSelector from "./RoomTypeSelector";

interface EditRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
    room: Room;
    categories: RoomCategory[];
    onSaved: () => void;
}

type CategoryOption = Omit<RoomCategory, "id"> & {
    id: number | null;
};

function getDefaultCategoryOption(name = "Standard"): CategoryOption {
    return {
        id: null,
        name,
        capacity: 2,
        capacity_adults: 2,
        capacity_children: 0,
        beds_configuration: "1 Cama King",
        amenities: ["wifi", "tv"],
        description: "",
        image_url: "",
        base_price: 50,
        half_day_price: 50,
        is_active: true,
    };
}

function toCategoryOption(category: RoomCategory): CategoryOption {
    return { ...category };
}

export default function EditRoomModal({
    isOpen,
    onClose,
    room,
    categories,
    onSaved,
}: EditRoomModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const initialCategoryOptions = categories.length > 0 ? categories.map(toCategoryOption) : [getDefaultCategoryOption()];

    const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>(initialCategoryOptions);
    const [roomType, setRoomType] = useState(room.room_type);
    const [capacity, setCapacity] = useState(getRoomCapacity(room).toString());
    const [bedsConfiguration, setBedsConfiguration] = useState(room.beds_configuration);
    const [description, setDescription] = useState(room.description || "");
    const [imageUrl, setImageUrl] = useState(room.image_url || "");
    const [basePrice, setBasePrice] = useState(room.base_price ? room.base_price.toString() : "50");
    const [amenities, setAmenities] = useState(room.amenities.join(", "));

    if (!isOpen) return null;

    const applyCategory = (categoryName: string) => {
        const selectedCategory = categoryOptions.find((category) => category.name === categoryName);
        if (!selectedCategory) {
            setRoomType(categoryName);
            return;
        }

        setRoomType(selectedCategory.name);
        setCapacity(String(selectedCategory.capacity || 2));
        setBedsConfiguration(selectedCategory.beds_configuration || "1 Cama King");
        setDescription(selectedCategory.description || "");
        setImageUrl(selectedCategory.image_url || "");
        setAmenities(selectedCategory.amenities.join(", ") || "");
        setBasePrice(String(selectedCategory.base_price || 0));
    };

    const handleAddCategory = (categoryName: string) => {
        setCategoryOptions((current) => [
            ...current,
            {
                ...getDefaultCategoryOption(categoryName),
                capacity: parseInt(capacity, 10) || 2,
                beds_configuration: bedsConfiguration || "1 Cama King",
                description,
                image_url: imageUrl,
                amenities: amenities
                    .split(",")
                    .map((amenity) => amenity.trim())
                    .filter(Boolean),
                base_price: parseFloat(basePrice) || 50,
                half_day_price: parseFloat(basePrice) || 50,
            },
        ]);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (!roomType.trim()) {
            setError("La categoria es obligatoria.");
            setLoading(false);
            return;
        }

        const parsedCapacity = parseInt(capacity, 10);

        if (isNaN(parsedCapacity) || parsedCapacity < 1) {
            setError("La capacidad debe ser al menos 1.");
            setLoading(false);
            return;
        }

        const parsedPrice = parseFloat(basePrice);
        if (isNaN(parsedPrice) || parsedPrice < 0) {
            setError("El precio base debe ser un numero positivo.");
            setLoading(false);
            return;
        }

        const parsedAmenities = amenities
            .split(",")
            .map((amenity) => amenity.trim())
            .filter((amenity) => amenity.length > 0);

        const result = await updateRoomAction(room.id, {
            room_type: roomType,
            capacity: parsedCapacity,
            beds_configuration: bedsConfiguration,
            description,
            image_url: imageUrl,
            amenities: parsedAmenities,
            base_price: parsedPrice,
        });

        setLoading(false);

        if (result.success) {
            onSaved();
            onClose();
        } else {
            setError(result.error);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden relative max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <h2 className="text-2xl font-bold text-slate-800">Editar Habitacion {room.room_number}</h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    <form id="edit-room-form" onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <RoomTypeSelector
                                value={roomType}
                                roomTypes={categoryOptions.map((category) => category.name)}
                                onChange={applyCategory}
                                onAddCategory={handleAddCategory}
                                label="Categoria"
                            />
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                            <p className="text-sm font-semibold text-slate-800 mb-1">Datos heredados de la categoria</p>
                            <p className="text-xs text-slate-500">
                                Si cambias estos datos, se actualizara la categoria y heredaran el cambio todas las habitaciones asignadas a ella.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Capacidad</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={capacity}
                                    onChange={(e) => setCapacity(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                    required
                                />
                            </div>
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
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Configuracion de Camas</label>
                            <input
                                type="text"
                                value={bedsConfiguration}
                                onChange={(e) => setBedsConfiguration(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                placeholder="Ej. 1 Cama King + 1 Sofa Cama"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Descripcion</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={3}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all resize-none"
                                placeholder="Descripcion publica de la categoria."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Comodidades (Separadas por comas)</label>
                            <input
                                type="text"
                                value={amenities}
                                onChange={(e) => setAmenities(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-brand-500 focus:ring focus:ring-brand-200 outline-none transition-all"
                                placeholder="wifi, tv, minibar"
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
                        form="edit-room-form"
                        disabled={loading}
                        className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-70"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                        Guardar Cambios
                    </button>
                </div>
            </div>
        </div>
    );
}
