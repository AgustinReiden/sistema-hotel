import { getAllRooms } from "@/lib/data";
import RoomsClientTable from "./RoomsClientTable";
import { createClient } from "@/lib/supabase/server";

export default async function RoomsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let isAdmin = false;
    if (user) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
        isAdmin = profile?.role === "admin";
    }

    const rooms = await getAllRooms();

    return (
        <div className="p-8">
            <div className="mb-8 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Gestión de Habitaciones</h1>
                    <p className="text-slate-500">
                        Edita las características, cupos y comodidades de las habitaciones del hotel.
                    </p>
                </div>
                <div className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg font-bold text-sm">
                    Total: {rooms.length} habitaciones
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <RoomsClientTable initialRooms={rooms} isAdmin={isAdmin} />
            </div>
        </div>
    );
}
