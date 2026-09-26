import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Salir" cierra la sesión solo en el dispositivo donde se tocó.
 *
 * `signOut()` de Supabase usa alcance global por defecto: cierra la sesión del usuario
 * en todos sus dispositivos (la PC de recepción, el celular, la otra PC). Con
 * `{ scope: 'local' }` se cierra solo esta. "Salir", el cierre por inactividad y
 * "Cerrar sesión" del traspaso forzado usan `logout()`.
 *
 * El cuarto camino, "Listo" después de rendir la caja propia al fin de turno, sigue
 * cerrando en todos lados (`logoutEverywhere()`): la recepcionista se va, y una sesión
 * suya que quedó abierta en otra PC o en el celular no puede terminar rindiendo la caja
 * que abre la siguiente. Los otros tres caminos no cubren ese riesgo: si la recepcionista
 * se va por ahí sin tocar "Listo", sus otras sesiones siguen abiertas.
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

import { logout, logoutEverywhere } from "@/app/login/actions";

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

describe("logoutEverywhere (Listo al fin de turno)", () => {
  beforeEach(() => {
    H.calls = [];
    H.signOut.mockReset();
    H.signOutError = null;
  });

  it("cierra la sesión en todos los dispositivos, como antes", async () => {
    await expect(logoutEverywhere()).rejects.toThrow("redirect /login");

    expect(H.signOut).toHaveBeenCalledTimes(1);
    expect(H.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("después de cerrar la sesión lleva al login, también si Supabase devuelve un error", async () => {
    await expect(logoutEverywhere()).rejects.toThrow("redirect /login");
    expect(H.calls).toEqual(["signOut", "redirect /login"]);

    H.calls = [];
    H.signOutError = { message: "Auth session missing!" };
    await expect(logoutEverywhere()).rejects.toThrow("redirect /login");
    expect(H.calls).toEqual(["signOut", "redirect /login"]);
  });
});
