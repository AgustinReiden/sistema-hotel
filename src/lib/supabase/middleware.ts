import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv } from "@/lib/env";

type RoleName = "admin" | "receptionist" | "client" | "maintenance";

function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "receptionist";
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const { url, anonKey } = getSupabaseEnv();
  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname.startsWith("/login");
  const isAdminPath = pathname.startsWith("/admin");
  const isMaintenancePath = pathname.startsWith("/maintenance");
  const isSettingsPath = pathname.startsWith("/admin/settings");
  // Facturación consolidada y control fiscal: sólo admin (mig 79). Las páginas ya
  // redirigen por su cuenta; esto es defensa en profundidad.
  const isAdminOnlyFiscalPath =
    pathname.startsWith("/admin/fiscal/consolidada") ||
    pathname.startsWith("/admin/fiscal/control");
  // Panel de remitos firmados: sólo admin (mig 116). La página también redirige.
  const isAdminOnlyRemitosPath = pathname.startsWith("/admin/remitos");
  // Finanzas: sólo admin. Muestra el efectivo del día, que la caja le oculta a recepción
  // (arqueo a ciegas). La página también redirige. registerPaymentAction vive en
  // finances/actions.ts pero no pasa por acá: una server action se postea a la URL de
  // la pantalla que la llama (/admin, /admin/calendario...), no a /admin/finances.
  const isAdminOnlyFinancesPath = pathname.startsWith("/admin/finances");
  // Habitaciones, categorías (los precios) y limpiezas: sólo admin. Las páginas también
  // redirigen y las acciones de habitaciones y categorías rechazan a recepción.
  const isAdminOnlyConfigPath =
    pathname.startsWith("/admin/rooms") ||
    pathname.startsWith("/admin/categorias") ||
    pathname.startsWith("/admin/mantenimiento");
  const isForbiddenPath = pathname.startsWith("/forbidden");
  const isProtectedPath = isAdminPath || isMaintenancePath;

  if (!isAuthRoute && !isProtectedPath && !isForbiddenPath) {
    return supabaseResponse;
  }

  if (!user) {
    if (isProtectedPath || isForbiddenPath) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return supabaseResponse;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = (profile?.role as RoleName | undefined) ?? "client";
  const isStaff = isStaffRole(role);
  const isMaintenance = role === "maintenance";

  // Post-login: redirigir según rol
  if (isAuthRoute) {
    if (isStaff) return NextResponse.redirect(new URL("/admin", request.url));
    if (isMaintenance) return NextResponse.redirect(new URL("/maintenance", request.url));
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  // /admin/* — sólo staff (admin o receptionist). Maintenance va a su propio dashboard.
  if (isAdminPath) {
    if (isMaintenance) {
      return NextResponse.redirect(new URL("/maintenance", request.url));
    }
    if (!isStaff) {
      return NextResponse.redirect(new URL("/forbidden", request.url));
    }
  }

  // /admin/settings, facturación consolidada/control, remitos, finanzas, habitaciones,
  // categorías y limpiezas — sólo admin
  if (
    (isSettingsPath ||
      isAdminOnlyFiscalPath ||
      isAdminOnlyRemitosPath ||
      isAdminOnlyFinancesPath ||
      isAdminOnlyConfigPath) &&
    role !== "admin"
  ) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  // /maintenance — sólo admin o maintenance
  if (isMaintenancePath) {
    if (role !== "admin" && !isMaintenance) {
      return NextResponse.redirect(new URL("/forbidden", request.url));
    }
  }

  // /forbidden: redirigir si ya está autorizado a algún panel
  if (isForbiddenPath) {
    if (isStaff) return NextResponse.redirect(new URL("/admin", request.url));
    if (isMaintenance) return NextResponse.redirect(new URL("/maintenance", request.url));
  }

  return supabaseResponse;
}
