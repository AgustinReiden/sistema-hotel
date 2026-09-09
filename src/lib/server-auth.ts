import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Chequeo de rol para server actions.
 *
 * Por qué existe: la RLS sola no alcanza. Un UPDATE bloqueado por RLS no devuelve
 * error, afecta 0 filas, y la accion terminaria respondiendo "guardado" sin haber
 * guardado nada. El chequeo explicito corta antes y con un mensaje en castellano.
 * Ademas hace visible en el codigo que la accion es solo para admin.
 */
async function loadCurrentRole() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No autorizado.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error) throw error;

  return { supabase, role: profile?.role as string | undefined };
}

/**
 * Exige rol admin y devuelve el cliente de Supabase ya autenticado.
 * `forbiddenMessage` permite el mensaje puntual de cada seccion ("Permisos
 * insuficientes para administrar huespedes.") sin duplicar el helper.
 */
export async function assertAdmin(forbiddenMessage = "No autorizado.") {
  const { supabase, role } = await loadCurrentRole();
  if (role !== "admin") throw new Error(forbiddenMessage);
  return supabase;
}

/**
 * Exige rol de mostrador (admin o recepcionista). Para las acciones que un
 * recepcionista tambien puede correr, donde pedir admin seria de mas.
 */
export async function assertStaff(forbiddenMessage = "No autorizado.") {
  const { supabase, role } = await loadCurrentRole();
  if (role !== "admin" && role !== "receptionist") throw new Error(forbiddenMessage);
  return supabase;
}

/**
 * "¿El que esta mirando es admin?", sin lanzar. Los assert* de arriba son para
 * server actions, donde cortar con un error ES la respuesta correcta. Un server
 * component que solo quiere decidir si hace algo de mas (por ejemplo, disparar el
 * barrido de facturas trabadas en /admin/fiscal) no puede romper la pantalla por
 * eso: si no se puede resolver el rol, la respuesta es false y la pagina sigue.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    const { role } = await loadCurrentRole();
    return role === "admin";
  } catch {
    return false;
  }
}
