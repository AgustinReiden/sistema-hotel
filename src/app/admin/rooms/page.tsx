import { redirect } from "next/navigation";
import { getAllRooms, getCurrentUserRole, getRoomCategories } from "@/lib/data";
import RoomsClientTable from "./RoomsClientTable";
import Link from "next/link";

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
            <div className="mb-8 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Gestión de Habitaciones</h1>
                    <p className="text-slate-500">
                        Edita las características, cupos y comodidades de las habitaciones del hotel.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href="/admin/categorias"
                        className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors"
                    >
                        Gestionar Categorias
                    </Link>
                    <div className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg font-bold text-sm">
                        Total: {rooms.length} habitaciones
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <RoomsClientTable initialRooms={rooms} initialCategories={categories} isAdmin />
            </div>
        </div>
    );
}
