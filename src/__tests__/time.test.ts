import { describe, expect, it } from "vitest";

import {
  formatHotelDateTime,
  formatHotelShortDate,
  formatHotelShortDateTime,
  formatHotelTime,
  formatHotelWeekdayDate,
  hotelDateKey,
} from "@/lib/time";
import { conIcuDeChrome } from "./icu-chrome";

const TZ = "America/Argentina/Tucuman";

// Error #418 de React en Mantenimiento (y en toda pantalla que dibuje una hora desde un
// componente de cliente): el servidor escribía "p.", espacio duro, "m." (ICU de Node) y el
// navegador "p. m." (ICU de Chrome), así que React tiraba el HTML del servidor y
// redibujaba todo.
describe("formatHotelTime y formatHotelDateTime (no dependen del ICU)", () => {
  // 17:30 UTC = 14:30 en Tucumán.
  const TARDE = "2026-09-26T17:30:00Z";

  // Entre "p." y "m." va un espacio duro, como lo escribía el servidor: se ve igual que
  // uno común y en el ticket no deja cortar la hora en dos renglones.
  it("escriben la hora de 12 h que ya se veía", () => {
    expect(formatHotelTime(TARDE, TZ)).toBe("02:30 p.\xa0m.");
    expect(formatHotelDateTime(TARDE, TZ)).toBe("26/09/2026, 02:30 p.\xa0m.");
  });

  it("la medianoche es 12 a. m. y el mediodía 12 p. m., en la zona del hotel", () => {
    // 03:05 UTC = 00:05 en Tucumán; 15:07 UTC = 12:07.
    expect(formatHotelTime("2026-09-26T03:05:00Z", TZ)).toBe("12:05 a.\xa0m.");
    expect(formatHotelTime("2026-09-26T15:07:00Z", TZ)).toBe("12:07 p.\xa0m.");
    expect(formatHotelTime("2026-01-05T12:00:00Z", TZ)).toBe("09:00 a.\xa0m.");
    // 02:59 UTC del 26 todavía es el 25 a las 23:59 en Tucumán.
    expect(formatHotelDateTime("2026-09-26T02:59:00Z", TZ)).toBe("25/09/2026, 11:59 p.\xa0m.");
  });

  it("dan lo mismo con el ICU de Node que con el de Chrome", async () => {
    const horarios = ["2026-09-26T17:30:00Z", "2026-09-26T03:05:00Z", "2026-12-31T23:45:00Z"];
    const formatear = () =>
      horarios.flatMap((iso) => [formatHotelTime(iso, TZ), formatHotelDateTime(iso, TZ)]);

    const enNode = formatear();
    const enChrome = await conIcuDeChrome(formatear);

    expect(enChrome).toEqual(enNode);
    expect(enNode).toEqual([
      "02:30 p.\xa0m.",
      "26/09/2026, 02:30 p.\xa0m.",
      "12:05 a.\xa0m.",
      "26/09/2026, 12:05 a.\xa0m.",
      "08:45 p.\xa0m.",
      "31/12/2026, 08:45 p.\xa0m.",
    ]);
  });

  it("sin fecha, o con una que no se puede leer, muestran la raya", () => {
    expect(formatHotelTime(null, TZ)).toBe("—");
    expect(formatHotelDateTime(undefined, TZ)).toBe("—");
    expect(formatHotelTime("no es una fecha", TZ)).toBe("—");
    expect(formatHotelDateTime("no es una fecha", TZ)).toBe("—");
  });
});

// Los demás helpers ya daban igual en Node y en Chrome: esto los deja atados.
describe("helpers de fecha corta (iguales en Node y en Chrome)", () => {
  it("formatHotelShortDateTime, formatHotelShortDate y formatHotelWeekdayDate", async () => {
    const iso = "2026-09-26T17:30:00Z";
    const formatear = () => [
      formatHotelShortDateTime(iso, TZ),
      formatHotelShortDate(iso, TZ),
      formatHotelWeekdayDate(iso, TZ),
    ];

    const enNode = formatear();
    expect(await conIcuDeChrome(formatear)).toEqual(enNode);
    enNode.forEach((texto) => expect(texto).not.toMatch(/[\xa0\u{202f}]/u));
  });
});

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
