"use client";

import { useState } from "react";
import { Room } from "@/lib/types";
import { Edit, Trash2, Plus, BedDouble, Users, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import EditRoomModal from "./EditRoomModal";
import CreateRoomModal from "./CreateRoomModal";
import { deleteRoomAction } from "./actions";

export default function RoomsClientTable({ initialRooms, isAdmin }: { initialRooms: Room[], isAdmin: boolean }) {
    const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const handleDelete = async (id: number) => {
        if (!confirm("¿Seguro que deseas eliminar esta habitación? ¡Esta acción es irreversible y podría causar errores si tiene reservas vinculadas!")) return;

        setDeletingId(id);
        const result = await deleteRoomAction(id);
        if (result.success) {
            toast.success("Habitación eliminada exitosamente.");
        } else {
            toast.error(result.error);
        }
        setDeletingId(null);
    };

    return (
        <>
            {isAdmin && (
                <div className="p-4 border-b border-slate-200 flex justify-end bg-slate-50">
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-medium flex items-center transition-colors shadow-sm"
                    >
                        <Plus size={18} className="mr-2" />
                        Añadir Habitación
                    </button>
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Hab.</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tipo</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Camas</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Capacidad</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Imagen</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {initialRooms.map((room) => (
                            <tr key={room.id} className="hover:bg-slate-50/80 transition-colors group">
                                <td className="px-6 py-4 font-bold text-slate-800">
                                    {room.room_number}
                                </td>
                                <td className="px-6 py-4 text-slate-600 capitalize">
                                    {room.room_type}
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center text-slate-600 text-sm">
                                        <BedDouble size={16} className="mr-2 text-slate-400" />
                                        {room.beds_configuration}
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center text-slate-600 text-sm">
                                        <Users size={16} className="mr-2 text-slate-400" />
                                        {room.capacity_adults} Adult. {room.capacity_children > 0 && `+ ${room.capacity_children} Niñ.`}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    {room.image_url ? (
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
                                            onClick={() => setSelectedRoom(room)}
                                            className="inline-flex items-center justify-center p-2 text-brand-600 hover:bg-brand-50 rounded-lg transition-colors cursor-pointer"
                                            title="Editar Habitación"
                                        >
                                            <Edit size={18} />
                                        </button>

                                        {isAdmin && (
                                            <button
                                                onClick={() => handleDelete(room.id)}
                                                disabled={deletingId === room.id}
                                                className="inline-flex items-center justify-center p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                                title="Eliminar Habitación"
                                            >
                                                {deletingId === room.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {selectedRoom && (
                <EditRoomModal
                    isOpen={!!selectedRoom}
                    onClose={() => setSelectedRoom(null)}
                    room={selectedRoom}
                />
            )}

            {isCreateModalOpen && (
                <CreateRoomModal
                    isOpen={isCreateModalOpen}
                    onClose={() => setIsCreateModalOpen(false)}
                />
            )}
        </>
    );
}
