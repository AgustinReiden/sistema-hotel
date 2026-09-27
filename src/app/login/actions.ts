"use server";

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function login(formData: FormData) {
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    const supabase = await createClient();

    const { error, data } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        return { error: error.message };
    }

    // Determinar destino según rol
    let target = "/forbidden";
    if (data?.user) {
        const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", data.user.id)
            .maybeSingle();
        const role = profile?.role as string | undefined;
        if (role === "admin" || role === "receptionist") target = "/admin";
        else if (role === "maintenance") target = "/maintenance";

        // El recepcionista trabaja con la caja abierta: al iniciar sesion se abre
        // automaticamente. Si ya tenia una abierta, el RPC devuelve error y se ignora.
        if (role === "receptionist") {
            await supabase.rpc("rpc_open_cash_shift");
        }
    }
    redirect(target);
}

/**
 * "Salir" (`LogoutButton`): cierra la sesión solo en este dispositivo. Sin scope,
 * Supabase la cierra en todos lados (la otra PC, el celular). Es el único camino que
 * pasa por acá; los demás usan `logoutEverywhere()`.
 * Si una recepcionista toca "Salir" sin haber rendido su caja, su sesión en otro
 * dispositivo sigue abierta hasta que la cierre la inactividad de ese dispositivo (que
 * cierra en todos lados) o hasta que salga ahí.
 */
export async function logout() {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: 'local' });
    redirect('/login');
}

/**
 * Cierra la sesión en todos los dispositivos del usuario, como hacía `logout()` antes de
 * que "Salir" pasara a cerrar solo este (decisión de Agustín del 27/09). La usan:
 *  - el cierre por inactividad de recepción (`IdleLogout`);
 *  - "¿No sos vos? → Cerrar sesión" del traspaso forzado (`CloseShiftModal`);
 *  - "Listo" después de rendir la caja propia al fin de turno (`CloseShiftModal`).
 * Una sesión de esa recepcionista que quedara abierta en otra PC o en el celular caería
 * en la rendición forzada de la caja que abre la siguiente y podría cerrarla a ciegas a
 * nombre de quien ya se fue.
 */
export async function logoutEverywhere() {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: 'global' });
    redirect('/login');
}
