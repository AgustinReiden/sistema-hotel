"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, ShieldCheck, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";

import { listManageableUsersAction, updateProfileAction } from "./actions";
import type { ManageableProfile, UserRole } from "@/lib/types";

type EditState = {
  full_name: string;
  role: UserRole;
};

export default function UsersPanel() {
  const [users, setUsers] = useState<ManageableProfile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      const result = await listManageableUsersAction();
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        setUsers([]);
        return;
      }
      setUsers(result.data ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateEdit = (userId: string, patch: Partial<EditState>, current: ManageableProfile) => {
    setEdits((prev) => ({
      ...prev,
      [userId]: {
        full_name: prev[userId]?.full_name ?? current.full_name ?? "",
        role: prev[userId]?.role ?? current.role,
        ...patch,
      },
    }));
  };

  const isDirty = (userId: string, current: ManageableProfile) => {
    const e = edits[userId];
    if (!e) return false;
    return (
      (e.full_name ?? "") !== (current.full_name ?? "") ||
      e.role !== current.role
    );
  };

  const save = async (user: ManageableProfile) => {
    const e = edits[user.id];
    if (!e) return;
    if (!e.full_name.trim()) {
      toast.error("El nombre no puede estar vacio.");
      return;
    }
    setSavingId(user.id);
    const result = await updateProfileAction(user.id, e.full_name.trim(), e.role);
    setSavingId(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Usuario actualizado.");
    // Optimista: reflejar cambios
    setUsers((prev) =>
      (prev ?? []).map((u) =>
        u.id === user.id ? { ...u, full_name: e.full_name.trim(), role: e.role } : u
      )
    );
    setEdits((prev) => {
      const next = { ...prev };
      delete next[user.id];
      return next;
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mt-8">
      <div className="p-5 border-b border-slate-100 flex items-center gap-3 bg-slate-50">
        <div className="p-2 rounded-lg bg-slate-100 text-slate-600">
          <UsersIcon size={18} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">Usuarios del sistema</h3>
          <p className="text-xs text-slate-500">
            Editá el nombre y rol de usuarios existentes. Para agregar un nuevo usuario, hacelo
            desde el dashboard de Supabase (Authentication → Users).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-500 flex items-center justify-center gap-2">
          <Loader2 size={18} className="animate-spin" />
          Cargando usuarios...
        </div>
      ) : error ? (
        <div className="p-10 text-center text-red-600 font-medium text-sm">{error}</div>
      ) : !users || users.length === 0 ? (
        <div className="p-10 text-center text-slate-500 text-sm">No hay usuarios registrados.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Email</th>
                <th className="text-left px-4 py-3 font-semibold">Nombre</th>
                <th className="text-left px-4 py-3 font-semibold">Rol</th>
                <th className="text-right px-4 py-3 font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const editName = edits[u.id]?.full_name ?? u.full_name ?? "";
                const editRole = edits[u.id]?.role ?? u.role;
                const dirty = isDirty(u.id, u);
                const saving = savingId === u.id;
                return (
                  <tr key={u.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-slate-700 text-sm font-medium">
                      {u.email}
                      {u.role === "admin" && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          <ShieldCheck size={10} />
                          ADMIN
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => updateEdit(u.id, { full_name: e.target.value }, u)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={editRole}
                        onChange={(e) => updateEdit(u.id, { role: e.target.value as UserRole }, u)}
                        className="px-3 py-2 rounded-lg border border-slate-200 focus:border-brand-500 focus:ring outline-none text-sm"
                      >
                        <option value="admin">Admin</option>
                        <option value="receptionist">Recepcionista</option>
                        <option value="client">Cliente</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => save(u)}
                        disabled={!dirty || saving}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Guardar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
