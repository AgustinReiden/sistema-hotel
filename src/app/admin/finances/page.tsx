import { createClient } from "@/lib/supabase/server";
import { Wallet, TrendingUp, AlertCircle, Banknote, CreditCard, Landmark } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export const revalidate = 0; // Ensure fresh data on every load

function getPaymentIcon(method: string) {
    switch (method) {
        case 'cash': return <Banknote size={16} />;
        case 'credit_card':
        case 'debit_card': return <CreditCard size={16} />;
        case 'bank_transfer': return <Landmark size={16} />;
        case 'mercado_pago': return <Wallet size={16} className="text-blue-500" />;
        case 'vale_blanco': return <Banknote size={16} className="text-slate-400" />;
        case 'cuenta_corriente': return <Wallet size={16} className="text-purple-500" />;
        default: return <Wallet size={16} />;
    }
}

function getPaymentMethodName(method: string) {
    switch (method) {
        case 'cash': return "Efectivo";
        case 'credit_card': return "Tarjeta de Crédito";
        case 'debit_card': return "Tarjeta de Débito";
        case 'bank_transfer': return "Transferencia";
        case 'mercado_pago': return "Mercado Pago";
        case 'vale_blanco': return "Vale Blanco";
        case 'cuenta_corriente': return "Cuenta Corriente";
        default: return "Otro";
    }
}

export default async function FinancesPage() {
    const supabase = await createClient();

    // Fetch today's payments
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: paymentsData } = await supabase
        .from('payments')
        .select(`
            id, amount, payment_method, created_at, notes,
            reservation:reservations(id, client_name, rooms(room_number))
        `)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false });

    const payments = paymentsData || [];
    const todayIncome = payments.reduce((sum, p) => sum + Number(p.amount), 0);

    // Fetch active reservations with debt
    const { data: activeReservations } = await supabase
        .from('reservations')
        .select(`
            id, client_name, total_price, paid_amount, status, check_out_target,
            rooms(room_number)
        `)
        .in('status', ['confirmed', 'checked_in'])
        .order('check_out_target', { ascending: true });

    const { data: extraIncomeData } = await supabase.rpc('get_today_extra_income');
    const todayExtraIncome = Number(extraIncomeData || 0);

    const debts = (activeReservations || []).filter(r => Number(r.total_price) > Number(r.paid_amount));
    const totalDebtPending = debts.reduce((sum, r) => sum + (Number(r.total_price) - Number(r.paid_amount)), 0);

    return (
        <div className="p-8 pb-20 overflow-y-auto w-full">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">Resumen Financiero</h1>
                <p className="text-slate-500">
                    Monitorea la caja del día, ingresos registrados y saldos pendientes de huéspedes actuales.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-emerald-600 rounded-2xl p-6 shadow-lg relative overflow-hidden text-white flex flex-col justify-between">
                    <div className="absolute top-0 right-0 p-4 opacity-20">
                        <TrendingUp size={100} />
                    </div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 text-emerald-100 font-medium mb-1">
                            <Wallet size={16} />
                            Ingresos del Día
                        </div>
                        <h2 className="text-4xl font-bold tracking-tight">${todayIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                    </div>
                    <div className="relative z-10 mt-6 text-sm text-emerald-100 opacity-90">
                        Total en caja cobrado hoy (Efectivo/T.C/etc).
                    </div>
                </div>

                <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl p-6 shadow-lg relative overflow-hidden text-white flex flex-col justify-between">
                    <div className="absolute top-0 right-0 p-4 opacity-20">
                        <Banknote size={100} />
                    </div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 text-indigo-100 font-medium mb-1">
                            <TrendingUp size={16} />
                            Ingresos Extra (Medio Día)
                        </div>
                        <h2 className="text-4xl font-bold tracking-tight">${todayExtraIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                    </div>
                    <div className="relative z-10 mt-6 text-sm text-indigo-100 opacity-90">
                        Cargos generados por extensiones de reservas o walk-ins extra.
                    </div>
                </div>

                <div className="bg-amber-500 rounded-2xl p-6 shadow-lg relative overflow-hidden text-white flex flex-col justify-between">
                    <div className="absolute top-0 right-0 p-4 opacity-20">
                        <AlertCircle size={100} />
                    </div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 text-amber-100 font-medium mb-1">
                            <AlertCircle size={16} />
                            Saldos Por Cobrar
                        </div>
                        <h2 className="text-4xl font-bold tracking-tight">${totalDebtPending.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                    </div>
                    <div className="relative z-10 mt-6 text-sm text-amber-100 opacity-90">
                        Deuda pendiente de huéspedes activos no liquidados.
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Registry of Payments */}
                <div className="bg-white border text-left border-slate-200 shadow-sm rounded-xl overflow-hidden flex flex-col">
                    <div className="p-6 border-b border-slate-100 bg-slate-50">
                        <h3 className="text-lg font-bold text-slate-800">Pagos Recibidos Hoy</h3>
                    </div>
                    <div className="p-0 flex-1 overflow-y-auto max-h-[500px]">
                        {payments.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 font-medium">
                                No se ha registrado ningún ingreso en caja hoy.
                            </div>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {payments.map((payment) => {
                                    // Handle array return edge case in related tables
                                    const resData = Array.isArray(payment.reservation) ? payment.reservation[0] : payment.reservation;
                                    const roomRel = resData?.rooms;
                                    const roomNumber = Array.isArray(roomRel) ? (roomRel[0] as { room_number: string })?.room_number : (roomRel as { room_number: string })?.room_number;

                                    return (
                                        <li key={payment.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                                    {getPaymentIcon(payment.payment_method)}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-slate-800 text-sm">{resData?.client_name || "Desconocido"} (Hab. {roomNumber})</p>
                                                    <div className="flex gap-2 text-xs font-medium text-slate-500 mt-0.5">
                                                        <span>{format(new Date(payment.created_at), "h:mm a", { locale: es })}</span>
                                                        <span>•</span>
                                                        <span>{getPaymentMethodName(payment.payment_method)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="font-bold text-emerald-600">
                                                +${Number(payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Registry of Debts */}
                <div className="bg-white border text-left border-slate-200 shadow-sm rounded-xl overflow-hidden flex flex-col">
                    <div className="p-6 border-b border-slate-100 bg-slate-50">
                        <h3 className="text-lg font-bold text-slate-800">Huéspedes con Saldos Pendientes</h3>
                    </div>
                    <div className="p-0 flex-1 overflow-y-auto max-h-[500px]">
                        {debts.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 font-medium flex items-center justify-center flex-col gap-2">
                                <span className="bg-emerald-100 text-emerald-600 p-2 rounded-full">
                                    <TrendingUp size={24} />
                                </span>
                                Todos los huéspedes activos están al día con sus pagos.
                            </div>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {debts.map((debt) => {
                                    const roomRel = debt.rooms;
                                    const roomNumber = Array.isArray(roomRel) ? (roomRel[0] as { room_number: string })?.room_number : (roomRel as { room_number: string })?.room_number;
                                    const remaining = Number(debt.total_price) - Number(debt.paid_amount);

                                    return (
                                        <li key={debt.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between">
                                            <div>
                                                <p className="font-bold text-slate-800 text-sm">{debt.client_name} (Hab. {roomNumber})</p>
                                                <div className="text-xs text-slate-500 mt-0.5 space-x-2">
                                                    <span className="inline-flex items-center text-amber-600 font-medium">Debe: ${remaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="block text-xs text-slate-400">Total: ${Number(debt.total_price).toLocaleString()}</span>
                                                <span className="block text-xs font-bold text-emerald-600">Pagado: ${Number(debt.paid_amount).toLocaleString()}</span>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
