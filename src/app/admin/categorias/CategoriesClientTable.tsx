"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit, Image as ImageIcon, Layers3, Loader2, Plus, Tag, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import type { RoomCategory, RoomCategoryUsage } from "@/lib/types";
import CategoryModal from "./CategoryModal";
import {
    createRoomCategoryAction,
    deleteRoomCategoryAction,
    updateRoomCategoryAction,
} from "./actions";

type CategoriesClientTableProps = {
    initialCategories: RoomCategoryUsage[];
    isAdmin: boolean;
};

export default function CategoriesClientTable({
    initialCategories,
    isAdmin,
}: CategoriesClientTableProps) {
    const router = useRouter();
    const [selectedCategory, setSelectedCategory] = useState<RoomCategoryUsage | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const handleRefresh = () => {
        router.refresh();
    };

    const handleDelete = async (category: RoomCategoryUsage) => {
        if (category.room_count > 0) {
            toast.error("No puedes eliminar una categoria con habitaciones asignadas.");
            return;
        }

        if (!confirm(`Seguro que deseas eliminar la categoria "${category.name}"?`)) {
            return;
        }

        setDeletingId(category.id);
        const result = await deleteRoomCategoryAction(category.id);
        setDeletingId(null);

        if (result.success) {
            toast.success("Categoria eliminada correctamente.");
            handleRefresh();
            return;
        }

        toast.error(result.error || "No se pudo eliminar la categoria.");
    };

    const mapCategoryForModal = (category: RoomCategoryUsage | null): RoomCategory | null => {
        if (!category) return null;
        return {
            id: category.id,
            name: category.name,
            capacity: category.capacity,
            capacity_adults: category.capacity_adults,
            capacity_children: category.capacity_children,
            beds_configuration: category.beds_configuration,
            amenities: category.amenities,
            description: category.description,
            image_url: category.image_url,
            base_price: category.base_price,
            half_day_price: category.half_day_price,
            is_active: category.is_active,
        };
    };

    return (
        <>
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <div>
                    <p className="text-sm font-semibold text-slate-700">Categorias de habitaciones</p>
                    <p className="text-xs text-slate-500">
                        Administra la informacion publica y comercial que heredan las habitaciones.
                    </p>
                </div>
                {isAdmin && (
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-medium flex items-center transition-colors shadow-sm"
                    >
                        <Plus size={18} className="mr-2" />
                        Nueva Categoria
                    </button>
                )}
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Categoria</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Capacidad</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Precio</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Habitaciones</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Imagen</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {initialCategories.map((category) => (
                            <tr key={category.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                                            <Tag size={16} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className="font-semibold text-slate-800">{category.name}</p>
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${category.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                                                    {category.is_active ? "Activa" : "Inactiva"}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-500 line-clamp-2">
                                                {category.description || "Sin descripcion configurada."}
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1 text-sm text-slate-600">
                                        <span className="inline-flex items-center gap-2">
                                            <Users size={15} className="text-slate-400" />
                                            {category.capacity} personas
                                        </span>
                                        <span className="inline-flex items-center gap-2 text-slate-500">
                                            <Layers3 size={15} className="text-slate-400" />
                                            {category.beds_configuration}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-slate-600">
                                    <div className="font-semibold text-slate-800">
                                        ${category.base_price.toLocaleString("es-AR")}
                                    </div>
                                    <div className="text-slate-500">
                                        Medio dia: ${category.half_day_price.toLocaleString("es-AR")}
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                                        {category.room_count}
                                        <span className="text-slate-500 font-medium">
                                            {category.room_count === 1 ? "habitacion" : "habitaciones"}
                                        </span>
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    {category.image_url ? (
                                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-600">
                                            <ImageIcon size={16} />
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-400">
                                            <ImageIcon size={16} />
                                        </span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => setSelectedCategory(category)}
                                            className="inline-flex items-center justify-center p-2 text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                                            title="Editar categoria"
                                        >
                                            <Edit size={18} />
                                        </button>
                                        {isAdmin && (
                                            <button
                                                onClick={() => handleDelete(category)}
                                                disabled={deletingId === category.id || category.room_count > 0}
                                                className="inline-flex items-center justify-center p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                title={category.room_count > 0 ? "No se puede eliminar con habitaciones asignadas" : "Eliminar categoria"}
                                            >
                                                {deletingId === category.id ? (
                                                    <Loader2 size={18} className="animate-spin" />
                                                ) : (
                                                    <Trash2 size={18} />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {selectedCategory && (
                <CategoryModal
                    isOpen={Boolean(selectedCategory)}
                    onClose={() => setSelectedCategory(null)}
                    category={mapCategoryForModal(selectedCategory)}
                    title={`Editar Categoria ${selectedCategory.name}`}
                    onSubmit={async (data) => {
                        const result = await updateRoomCategoryAction(selectedCategory.id, data);
                        if (result.success) handleRefresh();
                        return result;
                    }}
                />
            )}

            {isCreateModalOpen && (
                <CategoryModal
                    isOpen
                    onClose={() => setIsCreateModalOpen(false)}
                    title="Nueva Categoria"
                    onSubmit={async (data) => {
                        const result = await createRoomCategoryAction(data);
                        if (result.success) handleRefresh();
                        return result;
                    }}
                />
            )}
        </>
    );
}
