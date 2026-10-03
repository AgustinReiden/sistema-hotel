// @vitest-environment node
// NextRequest y Response necesitan los de Node; los de jsdom no alcanzan.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: null as string | null,
}));

vi.mock("@/lib/env", () => ({
  getSupabaseEnv: () => ({ url: "https://example.supabase.co", anonKey: "anon" }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: H.role ? { role: H.role } : null }),
        }),
      }),
    }),
  }),
}));

import { GET, HEAD } from "@/app/admin/ping/route";
import { config as proxyConfig } from "@/proxy";
import { updateSession } from "@/lib/supabase/middleware";
import { PING_URL } from "@/app/admin/useAutoRefresh";

beforeEach(() => {
  H.user = null;
  H.role = null;
});

describe("/admin/ping — la pregunta de Hoy antes de recargar", () => {
  it.each([
    ["GET", GET],
    ["HEAD", HEAD],
  ] as const)("%s contesta 204, sin cuerpo y sin caché", async (_metodo, handler) => {
    const res = await handler();

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("es la ruta a la que le pregunta el hook", () => {
    expect(PING_URL).toBe("/admin/ping");
  });

  it("pasa por el proxy (el matcher la cubre), a diferencia del ícono de la pestaña", () => {
    expect(unstable_doesMiddlewareMatch({ config: proxyConfig, url: "/admin/ping" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config: proxyConfig, url: "/favicon.ico" })).toBe(false);
  });
});

describe("/admin/ping — lo que le contesta el proxy al hook (el proxy no cambia)", () => {
  async function preguntar() {
    const res = await updateSession(
      new NextRequest(new URL("/admin/ping", "https://hotel.test"), { method: "HEAD" })
    );
    const location = res.headers.get("location");
    return location ? new URL(location).pathname : null;
  }

  it("sin sesión (o si Auth no contesta) redirige a /login: el hook no recarga", async () => {
    expect(await preguntar()).toBe("/login");
  });

  it("si no se pudo leer el rol, redirige a /forbidden: el hook no recarga", async () => {
    H.user = { id: "u1" };
    H.role = null;
    expect(await preguntar()).toBe("/forbidden");
  });

  it.each(["receptionist", "admin"])("con la sesión de %s deja pasar hasta la ruta", async (rol) => {
    H.user = { id: "u1" };
    H.role = rol;
    expect(await preguntar()).toBeNull();
  });
});
