"use client";

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Guest } from "@/lib/types";
import { DollarSign } from "lucide-react";
import PaymentModal from "@/app/components/PaymentModal";

export default function GuestsClientTable({ initialGuests, searchQuery }: { initialGuests: Guest[], searchQuery: string }) {
    const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);

    return (
        <div className="bg-white border text-left border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                        <th className="px-6 py-4">Huesped</th>
                        <th className="px-6 py-4">Habitacion</th>
                        <th className="px-6 py-4">Fechas</th>
                        <th className="px-6 py-4">Estado</th>
                        <th className="px-6 py-4 text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {initialGuests.map((guest) => {
                        const isArchived = guest.status === "checked_out" || guest.status === "cancelled";
                        const debt = Math.max(0, guest.total_price - guest.paid_amount);

                        return (
                            <tr key={guest.id} className="hover:bg-slate-50/50 transition-colors group">
                                <td className="px-6 py-4">
                                    <div className="flex items-center space-x-3">
                                        <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs shrink-0">
                                            {guest.client_name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className={`font-medium ${isArchived ? "text-slate-600" : "text-slate-900"}`}>
                                                {guest.client_name}
                                            </span>
                                            {debt > 0 && !isArchived && (
                                                <span className="text-[10px] uppercase font-bold text-amber-600 tracking-wider">Deuda: ${debt.toLocaleString('en-US')}</span>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200">
                                        Hab. {guest.room_number}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <p className="text-sm text-slate-900 font-medium">{format(new Date(guest.check_in_target), "dd MMM, HH:mm", { locale: es })}</p>
                                    <p className="text-xs text-slate-500">{format(new Date(guest.check_out_target), "dd MMM yyyy", { locale: es })}</p>
                                </td>
                                <td className="px-6 py-4">
                                    {guest.status === "checked_in" && (
                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                                            Hospedado
                                        </span>
                                    )}
                                    {(guest.status === "pending" || guest.status === "confirmed") && (
                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                                            Por Llegar
                                        </span>
                                    )}
                                    {guest.status === "checked_out" && (
                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                            Finalizado
                                        </span>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    {!isArchived && (
                                        <button
                                            onClick={() => setSelectedGuest(guest)}
                                            className="inline-flex items-center justify-center p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                            title="Registrar Pago"
                                        >
                                            <DollarSign size={18} />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {initialGuests.length === 0 && (
                <div className="p-8 text-center text-slate-500">
                    {searchQuery
                        ? "No hay resultados para la busqueda indicada."
                        : "No hay huespedes registrados en el historial de reservas."}
                </div>
            )}

            {selectedGuest && (
                <PaymentModal
                    isOpen={!!selectedGuest}
                    onClose={() => setSelectedGuest(null)}
                    reservationId={selectedGuest.id}
                    clientName={selectedGuest.client_name}
                    totalPrice={selectedGuest.total_price}
                    paidAmount={selectedGuest.paid_amount}
                />
            )}
        </div>
    );
}
