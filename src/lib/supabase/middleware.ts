import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
  const isProtectedPath = pathname.startsWith("/admin");
  const isSettingsPath = pathname.startsWith("/admin/settings");
  const isForbiddenPath = pathname.startsWith("/forbidden");

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

  const isStaff = isStaffRole(profile?.role);

  if (isAuthRoute) {
    return NextResponse.redirect(new URL(isStaff ? "/admin" : "/forbidden", request.url));
  }

  if (isProtectedPath && !isStaff) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  if (isSettingsPath && profile?.role !== "admin") {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  if (isForbiddenPath && isStaff) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return supabaseResponse;
}
