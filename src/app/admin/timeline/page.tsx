import { getTimelineData } from '@/lib/data';
import { format, addDays, isSameDay, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function TimelinePage() {
    const { rooms, reservations, startDate, daysCount } = await getTimelineData(14); // Siguientes 14 días

    const days = Array.from({ length: daysCount }).map((_, i) => addDays(startDate, i));

    return (
        <div className="flex flex-col h-full bg-slate-50">
            <header className="h-16 bg-white border-b border-slate-200 flex items-center px-8 shrink-0">
                <div className="flex items-center space-x-3">
                    <div className="p-2 bg-slate-100 rounded-lg">
                        <Calendar size={20} className="text-slate-600" />
                    </div>
                    <h1 className="text-xl font-bold text-slate-800">Time-Line de Reservas (Próximos {daysCount} días)</h1>
                </div>
            </header>

            <div className="flex-1 overflow-auto p-8">
                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
                    {/* Fila de Encabezados (Días) */}
                    <div className="flex border-b border-slate-200 min-w-max">
                        <div className="w-48 shrink-0 p-4 font-semibold text-slate-700 bg-slate-50 border-r border-slate-200 sticky left-0 z-20 shadow-[1px_0_0_0_#e2e8f0]">
                            Habitación
                        </div>
                        {days.map((day, i) => (
                            <div key={i} className="w-32 shrink-0 p-3 text-center border-r border-slate-200 bg-slate-50/50">
                                <p className="text-xs text-slate-500 uppercase font-medium">{format(day, 'E', { locale: es })}</p>
                                <p className="text-sm font-bold text-slate-800">{format(day, 'dd MMM', { locale: es })}</p>
                            </div>
                        ))}
                    </div>

                    {/* Filas de Habitaciones */}
                    <div className="min-w-max">
                        {rooms.map(room => (
                            <div key={room.id} className="flex border-b border-slate-100 hover:bg-slate-50/50 group">
                                <div className="w-48 shrink-0 p-4 font-medium text-slate-800 bg-white group-hover:bg-slate-50 border-r border-slate-200 sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0]">
                                    Hab. {room.room_number} <span className="text-xs text-slate-500 block">{room.room_type}</span>
                                </div>

                                <div className="flex relative">
                                    {/* Grilla de fondo para columnas */}
                                    {days.map((_, i) => (
                                        <div key={i} className="w-32 shrink-0 border-r border-slate-100 h-20"></div>
                                    ))}

                                    {/* Bloques de Reserva Superpuestos */}
                                    {reservations
                                        .filter(res => res.room_id === room.id)
                                        .map(res => {
                                            const cin = startOfDay(new Date(res.check_in_target));
                                            const cout = startOfDay(new Date(res.check_out_target));

                                            // Calcular posiciones
                                            let startIndex = days.findIndex(d => isSameDay(d, cin));
                                            let endIndex = days.findIndex(d => isSameDay(d, cout));

                                            // Manejo de reservas que empiezan antes o terminan después del rango visible
                                            if (startIndex === -1 && cin < startDate) startIndex = 0;
                                            if (endIndex === -1 && cout > addDays(startDate, daysCount)) endIndex = daysCount;

                                            // Si completamente fuera de rango
                                            if (startIndex === -1 && endIndex === -1) return null;

                                            const span = endIndex - startIndex;
                                            if (span <= 0) return null;

                                            // w-32 en Tailwind es 8rem = 128px
                                            const leftPos = startIndex * 128;
                                            const width = span * 128;

                                            const isPending = res.status === 'pending';
                                            const colorClasses = isPending
                                                ? "bg-slate-100 border-slate-300 text-slate-700"
                                                : "bg-emerald-50 border-emerald-200 text-emerald-800";

                                            return (
                                                <div
                                                    key={res.id}
                                                    className={`absolute top-2 bottom-2 border rounded-lg p-2 overflow-hidden shadow-sm transition-all hover:shadow-md cursor-pointer ${colorClasses}`}
                                                    style={{ left: `${leftPos + 4}px`, width: `${width - 8}px` }}
                                                    title={`Cliente: ${res.client_name}\nReserva: ${res.status}`}
                                                >
                                                    <p className="text-xs font-bold truncate">{res.client_name}</p>
                                                    <p className="text-[10px] opacity-80 truncate">{format(cin, "dd/MM")} - {format(cout, "dd/MM")}</p>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
