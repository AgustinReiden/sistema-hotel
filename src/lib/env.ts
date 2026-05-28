/**
 * Validación centralizada de las variables de entorno requeridas.
 * Falla con un mensaje claro en español si falta configuración, en vez de
 * romper con un error críptico de "undefined" más adelante.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Configuración incompleta: faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Definilas en las variables de entorno antes de iniciar la app."
    );
  }

  return { url, anonKey };
}
