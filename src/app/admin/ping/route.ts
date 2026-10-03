/**
 * "¿Está el panel?": lo que pregunta Hoy antes de cada recarga automática, y el botón
 * "Reintentar" de la pantalla de error de `/admin` (`probeServer`, en `../useAutoRefresh.ts`).
 *
 * Contesta 204, sin datos. Lo que importa es el camino: como está dentro de `/admin`, pasa
 * por el proxy (`src/proxy.ts` → `src/lib/supabase/middleware.ts`), que lee la sesión y el
 * rol igual que en la recarga de verdad. Si Supabase no contesta o la sesión no sirve, el
 * proxy redirige a `/login` o a `/forbidden` y Hoy no se recarga: se queda en el panel, con
 * los datos de antes y el cierre por inactividad andando.
 *
 * No lee nada ni decide permisos: quién llega hasta acá lo decide el proxy, como siempre.
 */

// Que se ejecute en cada pedido: una respuesta armada en el build no diría nada del servidor.
export const dynamic = "force-dynamic";

function estoy(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export function GET(): Response {
  return estoy();
}

export function HEAD(): Response {
  return estoy();
}
