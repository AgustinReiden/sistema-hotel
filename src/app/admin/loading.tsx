import { Loader2 } from "lucide-react";

export default function AdminLoading() {
    return (
        <div className="flex-1 flex items-center justify-center min-h-[40vh] p-8">
            <div className="flex items-center gap-3 text-slate-400">
                <Loader2 className="animate-spin" size={22} />
                <span className="text-sm font-medium">Cargando…</span>
            </div>
        </div>
    );
}
