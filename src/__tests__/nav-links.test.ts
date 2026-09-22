import { describe, expect, it } from "vitest";

import { getNavSections } from "@/app/admin/nav-links";

describe("menu: remitos firmados", () => {
  it("el admin lo ve con el numerito de pendientes; recepcion no lo ve", () => {
    const admin = getNavSections("admin", { remitosPendientes: 3 }).flatMap((s) => s.items);
    const remitos = admin.find((i) => i.href === "/admin/remitos");
    expect(remitos?.label).toBe("Remitos firmados");
    expect(remitos?.badge?.text).toBe("3");
    const recepcion = getNavSections("receptionist", { remitosPendientes: 3 }).flatMap((s) => s.items);
    expect(recepcion.find((i) => i.href === "/admin/remitos")).toBeUndefined();
  });

  it("sin pendientes no hay numerito", () => {
    const admin = getNavSections("admin", {}).flatMap((s) => s.items);
    expect(admin.find((i) => i.href === "/admin/remitos")?.badge).toBeUndefined();
  });
});
