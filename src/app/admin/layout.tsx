import Sidebar from './Sidebar';
import { createClient } from "@/lib/supabase/server";
import { getOpenShiftForCurrentUser } from "@/lib/data";
import OpenShiftAgeAlert from "./OpenShiftAgeAlert";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email || "";

    let role = "receptionist";
    let openShift: Awaited<ReturnType<typeof getOpenShiftForCurrentUser>> | null = null;

    if (user) {
        const [profileResult, shiftResult] = await Promise.all([
            supabase.from('profiles').select('role').eq('id', user.id).single(),
            getOpenShiftForCurrentUser().catch(() => null),
        ]);
        if (profileResult.data?.role) {
            role = profileResult.data.role;
        }
        openShift = shiftResult;
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
            <Sidebar role={role} userEmail={userEmail} hasOpenShift={!!openShift} />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <OpenShiftAgeAlert openedAt={openShift?.opened_at ?? null} />
                {children}
            </main>
        </div>
    );
}
