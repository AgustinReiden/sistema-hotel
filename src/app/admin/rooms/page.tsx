import { redirect } from "next/navigation";
import { getAllRooms, getCurrentUserRole, getRoomCategories } from "@/lib/data";
import { roomsCountLabel } from "@/lib/rooms-count";
import RoomsClientTable from "./RoomsClientTable";
import RoomsSubNav from "./RoomsSubNav";

export default async function RoomsPage() {
    // Sólo admin: acá se activan, desactivan y renombran habitaciones.
    const role = await getCurrentUserRole();
    if (role !== "admin") redirect("/forbidden");

    const [rooms, categories] = await Promise.all([
        getAllRooms(),
        getRoomCategories(),
    ]);

    return (
        <div className="p-8">
            <RoomsSubNav current="habitaciones" />
            <div className="mb-8 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Gestión de Habitaciones</h1>
                    <p className="text-slate-500">
                        Edita las características, cupos y comodidades de las habitaciones del hotel.
                    </p>
                </div>
                <div className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg font-bold text-sm">
                    {roomsCountLabel(rooms)}
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <RoomsClientTable initialRooms={rooms} initialCategories={categories} isAdmin />
            </div>
        </div>
    );
}
