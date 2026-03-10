import Sidebar from './Sidebar';
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let role = "receptionist";
    let userEmail = user?.email || "";
    if (user) {
        const { data: profile } = await supabase.from('profiles').select('role, email').eq('id', user.id).single();
        if (profile?.role) {
            role = profile.role;
        }
        if (profile?.email) userEmail = profile.email;
    }

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
            <Sidebar role={role} userEmail={userEmail} />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {children}
            </main>
        </div>
    );
}
