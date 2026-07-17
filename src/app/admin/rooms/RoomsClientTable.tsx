"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit, Trash2, Plus, BedDouble, Users, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getRoomCapacity } from "@/lib/rooms";
import { Room, RoomCategory } from "@/lib/types";
import EditRoomModal from "./EditRoomModal";
import CreateRoomModal from "./CreateRoomModal";
import { deleteRoomAction, setRoomActiveAction } from "./actions";

export default function RoomsClientTable({
    initialRooms,
    initialCategories,
    isAdmin,
}: {
    initialRooms: Room[];
    initialCategories: RoomCategory[];
    isAdmin: boolean;
}) {
    const router = useRouter();
    const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [togglingId, setTogglingId] = useState<number | null>(null);

    const handleSaved = () => {
        router.refresh();
    };

    const handleToggleActive = async (room: Room) => {
        const nextActive = !room.is_active;
        setTogglingId(room.id);
        const result = await setRoomActiveAction(room.id, nextActive);

        if (result.success) {
            toast.success(nextActive ? "Habitacion activada." : "Habitacion desactivada.");
            router.refresh();
        } else {
            toast.error(result.error);
        }

        setTogglingId(null);
    };

    const handleDelete = async (id: number) => {
        if (!confirm("Seguro que deseas eliminar esta habitacion? Esta accion es irreversible y podria causar errores si tiene reservas vinculadas.")) {
            return;
        }

        setDeletingId(id);
        const result = await deleteRoomAction(id);

        if (result.success) {
            toast.success("Habitacion eliminada exitosamente.");
            router.refresh();
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
                        Anadir Habitacion
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
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Estado</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {initialRooms.map((room) => (
                            <tr key={room.id} className={`transition-colors group ${room.is_active ? "hover:bg-slate-50/80" : "bg-slate-100/70"}`}>
                                <td className="px-6 py-4 font-bold text-slate-800">{room.room_number}</td>
                                <td className="px-6 py-4 text-slate-600 capitalize">{room.room_type}</td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center text-slate-600 text-sm">
                                        <BedDouble size={16} className="mr-2 text-slate-400" />
                                        {room.beds_configuration}
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center text-slate-600 text-sm">
                                        <Users size={16} className="mr-2 text-slate-400" />
                                        {getRoomCapacity(room)} personas
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
                                <td className="px-6 py-4">
                                    <div className="flex items-center justify-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleToggleActive(room)}
                                            disabled={togglingId === room.id}
                                            role="switch"
                                            aria-checked={room.is_active}
                                            title={room.is_active ? "Activa (click para desactivar)" : "Inactiva (click para activar)"}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${room.is_active ? "bg-emerald-500" : "bg-slate-300"}`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${room.is_active ? "translate-x-6" : "translate-x-1"}`}
                                            />
                                        </button>
                                        <span className={`text-xs font-semibold w-14 ${room.is_active ? "text-emerald-600" : "text-slate-400"}`}>
                                            {togglingId === room.id ? "..." : room.is_active ? "Activa" : "Inactiva"}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => setSelectedRoom(room)}
                                            className="inline-flex items-center justify-center p-2 text-brand-600 hover:bg-brand-50 rounded-lg transition-colors cursor-pointer"
                                            title="Editar Habitacion"
                                        >
                                            <Edit size={18} />
                                        </button>

                                        {isAdmin && (
                                            <button
                                                onClick={() => handleDelete(room.id)}
                                                disabled={deletingId === room.id}
                                                className="inline-flex items-center justify-center p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                                title="Eliminar Habitacion"
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
                    categories={initialCategories}
                    onSaved={handleSaved}
                />
            )}

            {isCreateModalOpen && (
                <CreateRoomModal
                    isOpen={isCreateModalOpen}
                    onClose={() => setIsCreateModalOpen(false)}
                    categories={initialCategories}
                    onSaved={handleSaved}
                />
            )}
        </>
    );
}
