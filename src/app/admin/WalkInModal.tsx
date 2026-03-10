"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

type WalkInModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (clientName: string, nights: number) => Promise<{ success: boolean, error?: string }>;
    roomNumber: string;
    basePrice?: number;
};

export default function WalkInModal({ isOpen, onClose, onSubmit, roomNumber, basePrice = 0 }: WalkInModalProps) {
    const [clientName, setClientName] = useState("");
    const [nights, setNights] = useState(1);
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const estimatedTotal = basePrice > 0 ? basePrice * nights : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!clientName.trim() || nights < 1) return;
        setIsSubmitting(true);
        try {
            const result = await onSubmit(clientName, nights);
            if (result.success) {
                toast.success("Habitación asignada correctamente.");
                setClientName("");
                setNights(1);
                onClose();
            } else {
                toast.error(result.error || "Ocurrió un error.");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
                    <h2 className="text-xl font-bold text-slate-800">Asignar Habitación {roomNumber}</h2>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div>
                        <label htmlFor="clientName" className="block text-sm font-semibold text-slate-700 mb-1.5">Nombre del Huésped</label>
                        <input
                            id="clientName"
                            type="text"
                            required
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                            placeholder="Ej. Juan Pérez"
                        />
                    </div>
                    <div>
                        <label htmlFor="nights" className="block text-sm font-semibold text-slate-700 mb-1.5">Cantidad de Noches</label>
                        <input
                            id="nights"
                            type="number"
                            min="1"
                            required
                            value={nights}
                            onChange={(e) => setNights(parseInt(e.target.value) || 1)}
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                        />
                    </div>

                    {estimatedTotal !== null && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide">Total estimado</p>
                                <p className="text-xs text-emerald-500 mt-0.5">{nights} noche{nights !== 1 ? "s" : ""} × ${basePrice.toLocaleString("es-AR")}</p>
                            </div>
                            <p className="text-2xl font-bold text-emerald-700">${estimatedTotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</p>
                        </div>
                    )}

                    <div className="pt-2 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !clientName.trim()}
                            className="flex-1 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 disabled:hover:bg-emerald-600 transition-colors shadow-md shadow-emerald-600/20"
                        >
                            {isSubmitting ? "Asignando..." : "Asignar"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
