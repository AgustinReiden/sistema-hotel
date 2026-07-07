import { describe, expect, it } from "vitest";

import { formatHotelWeekdayDate, hotelDateKey } from "@/lib/time";

const TZ = "America/Argentina/Tucuman";

describe("formatHotelWeekdayDate (zona horaria del hotel)", () => {
  it("de noche en Argentina muestra el día de HOY, no el de mañana (UTC)", () => {
    // 2026-07-06 23:30 ART == 2026-07-07 02:30 UTC. Debe decir 06 jul, no 07 jul.
    const iso = "2026-07-07T02:30:00Z";
    const out = formatHotelWeekdayDate(iso, TZ);
    expect(out).toContain("06 jul");
    expect(out).not.toContain("07 jul");
  });

  it("a la mañana respeta el mismo día", () => {
    const out = formatHotelWeekdayDate("2026-07-06T13:00:00Z", TZ); // 10:00 ART del 6
    expect(out).toContain("06 jul");
  });
});

describe("hotelDateKey (clave de día en zona del hotel)", () => {
  it("no se corre de día en la franja nocturna argentina", () => {
    // Mismo instante que arriba: en UTC es el 07, en Tucumán sigue siendo el 06.
    expect(hotelDateKey("2026-07-07T02:30:00Z", TZ)).toBe("2026-07-06");
  });
});
