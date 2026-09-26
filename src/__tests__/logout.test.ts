import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Salir" cierra la sesión solo en el dispositivo donde se tocó.
 *
 * `signOut()` de Supabase usa alcance global por defecto: cierra la sesión del usuario
 * en todos sus dispositivos (la PC de recepción, el celular, la otra PC). Con
 * `{ scope: 'local' }` se cierra solo esta. "Salir", el cierre por inactividad y
 * "Cerrar sesión" del traspaso forzado usan esta misma acción.
 */

const H = vi.hoisted(() => ({
  calls: [] as string[],
  signOut: vi.fn(),
  signOutError: null as { message: string } | null,
}));

vi.mock("next/navigation", () => ({
  // Como en Next: redirect corta la ejecución tirando una excepción.
  redirect: (url: string) => {
    H.calls.push(`redirect ${url}`);
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signOut: async (options?: unknown) => {
        H.calls.push("signOut");
        H.signOut(options);
        return { error: H.signOutError };
      },
    },
  }),
}));

import { logout } from "@/app/login/actions";

describe("logout", () => {
  beforeEach(() => {
    H.calls = [];
    H.signOut.mockReset();
    H.signOutError = null;
  });

  it("cierra solo la sesión de este dispositivo, no las de los otros", async () => {
    await expect(logout()).rejects.toThrow("redirect /login");

    expect(H.signOut).toHaveBeenCalledTimes(1);
    expect(H.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("después de cerrar la sesión lleva al login", async () => {
    await expect(logout()).rejects.toThrow("redirect /login");

    expect(H.calls).toEqual(["signOut", "redirect /login"]);
  });

  it("si Supabase devuelve un error al cerrar, igual lleva al login (como hasta ahora)", async () => {
    H.signOutError = { message: "Auth session missing!" };

    await expect(logout()).rejects.toThrow("redirect /login");

    expect(H.calls).toEqual(["signOut", "redirect /login"]);
  });
});
