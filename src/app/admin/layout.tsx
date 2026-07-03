import Sidebar from './Sidebar';
import { createClient } from "@/lib/supabase/server";
import { getActiveOpenShift } from "@/lib/data";
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
    let openShift: Awaited<ReturnType<typeof getActiveOpenShift>> | null = null;

    if (user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
        if (profile?.role) {
            role = profile.role;
        }
        openShift = await getActiveOpenShift().catch(() => null);
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
