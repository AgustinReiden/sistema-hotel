import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type RoleName = "admin" | "receptionist" | "client" | "maintenance";

function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "receptionist";
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // /admin/settings — sólo admin
  if (isSettingsPath && role !== "admin") {
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
