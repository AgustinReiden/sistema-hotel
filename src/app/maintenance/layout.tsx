import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import LogoutButton from "../admin/LogoutButton";

export default async function MaintenanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const role = profile?.role as string | undefined;
  if (role !== "admin" && role !== "maintenance") {
    redirect("/forbidden");
  }

  const cleanerName =
    profile?.full_name || user.email?.split("@")[0] || "Mantenimiento";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500 flex items-center justify-center shadow-md shadow-sky-500/20">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800">Mantenimiento</p>
            <p className="text-xs text-slate-500 -mt-0.5">Hola, {cleanerName}</p>
          </div>
        </div>
        <div className="w-44">
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
