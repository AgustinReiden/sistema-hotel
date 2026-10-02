import { describe, expect, it } from "vitest";
import { parseSettingsTab } from "@/app/admin/settings/tabs";

describe("parseSettingsTab", () => {
  it("sin valor abre Hotel y mensajes", () => {
    expect(parseSettingsTab(undefined)).toBe("hotel");
    expect(parseSettingsTab("")).toBe("hotel");
  });

  it("reconoce las pestañas que existen", () => {
    expect(parseSettingsTab("hotel")).toBe("hotel");
    expect(parseSettingsTab("arca")).toBe("arca");
    expect(parseSettingsTab("usuarios")).toBe("usuarios");
  });

  it("un valor desconocido cae en Hotel y mensajes", () => {
    expect(parseSettingsTab("cualquiera")).toBe("hotel");
    expect(parseSettingsTab("ARCA")).toBe("hotel");
  });

  it("si el parámetro viene repetido toma el primero", () => {
    expect(parseSettingsTab(["usuarios", "arca"])).toBe("usuarios");
    expect(parseSettingsTab([])).toBe("hotel");
  });
});
