import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import LogoutButton from "@/app/admin/LogoutButton";

export const dynamic = "force-dynamic";

export default function ForbiddenPage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-sm p-8 text-center">
        <div className="mx-auto mb-4 h-14 w-14 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
          <ShieldAlert size={28} />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Acceso restringido</h1>
        <p className="text-slate-600 mb-6">
          Tu cuenta esta autenticada, pero no tiene permisos de staff para usar el panel
          administrativo.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors font-semibold text-sm"
          >
            Volver al inicio
          </Link>
          <div className="inline-flex justify-center">
            <LogoutButton />
          </div>
        </div>
      </div>
    </main>
  );
}
