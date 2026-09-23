// @vitest-environment node
// NextRequest necesita el Request nativo de Node; el de jsdom no alcanza.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

import { updateSession } from "@/lib/supabase/middleware";

async function visit(path: string) {
  const res = await updateSession(new NextRequest(new URL(path, "https://hotel.test")));
  const location = res.headers.get("location");
  return location ? new URL(location).pathname : null;
}

function loginAs(role: string) {
  H.user = { id: "u1" };
  H.role = role;
}

beforeEach(() => {
  H.user = null;
  H.role = null;
});

describe("middleware: /admin/finances es sólo admin", () => {
  it("recepción no entra a finanzas (ni a sus subrutas)", async () => {
    loginAs("receptionist");
    expect(await visit("/admin/finances")).toBe("/forbidden");
    expect(await visit("/admin/finances?date=2026-09-22")).toBe("/forbidden");
  });

  it("el admin sí entra", async () => {
    loginAs("admin");
    expect(await visit("/admin/finances")).toBeNull();
  });

  it("recepción sigue entrando a sus pantallas", async () => {
    loginAs("receptionist");
    expect(await visit("/admin")).toBeNull();
    expect(await visit("/admin/caja")).toBeNull();
    expect(await visit("/admin/calendario")).toBeNull();
  });

  it("sin sesión va al login", async () => {
    expect(await visit("/admin/finances")).toBe("/login");
  });
});
