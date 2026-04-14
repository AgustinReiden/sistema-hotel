import { createClient } from "@/lib/supabase/server";
import { getRoomCategoriesWithUsage } from "@/lib/data";
import CategoriesClientTable from "./CategoriesClientTable";

export default async function CategoriesPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let isAdmin = false;
    if (user) {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
        isAdmin = profile?.role === "admin";
    }

    const categories = await getRoomCategoriesWithUsage();

    return (
        <div className="p-8">
            <div className="mb-8 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Categorias de Habitaciones</h1>
                    <p className="text-slate-500">
                        Administra las caracteristicas comerciales y visuales que heredan las habitaciones fisicas.
                    </p>
                </div>
                <div className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg font-bold text-sm">
                    Total: {categories.length} categorias
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <CategoriesClientTable initialCategories={categories} isAdmin={isAdmin} />
            </div>
        </div>
    );
}
