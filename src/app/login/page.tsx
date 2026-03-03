"use client";

import { useState } from "react";
import { login } from "./actions";
import { Shield, KeyRound } from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        const formData = new FormData();
        formData.append("email", email);
        formData.append("password", password);

        const result = await login(formData);

        // login hace redirect si sale exitoso.
        // Si hay error retorna el mensaje.
        if (result?.error) {
            toast.error(result.error);
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-slate-900 p-8 text-center border-b border-brand-500/30">
                    <div className="w-16 h-16 bg-brand-500/15 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-brand-500/25">
                        <Shield className="text-brand-400" size={32} />
                    </div>
                    <h1 className="text-2xl font-bold text-white tracking-wide">
                        El Refugio
                    </h1>
                    <p className="text-slate-400 text-sm mt-2">Acceso al Panel Administrativo</p>
                </div>

                <div className="p-8">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Correo Electr&oacute;nico</label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                                placeholder="usuario@hotel.com"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Contrase&ntilde;a</label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all"
                                placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-brand-600/50 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-brand-600/20 flex items-center justify-center gap-2 mt-4 cursor-pointer"
                        >
                            {isLoading ? "Verificando..." : (
                                <>
                                    <KeyRound size={18} />
                                    Acceder al Sistema
                                </>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
