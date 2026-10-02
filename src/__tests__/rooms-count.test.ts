import { describe, expect, it } from "vitest";
import { roomsCountLabel } from "@/lib/rooms-count";

const rooms = (activas: number, inactivas: number) => [
  ...Array.from({ length: activas }, () => ({ is_active: true })),
  ...Array.from({ length: inactivas }, () => ({ is_active: false })),
];

describe("roomsCountLabel", () => {
  it("cuenta activas e inactivas", () => {
    expect(roomsCountLabel(rooms(14, 1))).toBe("14 activas · 1 inactiva");
    expect(roomsCountLabel(rooms(12, 3))).toBe("12 activas · 3 inactivas");
  });

  it("sin inactivas no las menciona", () => {
    expect(roomsCountLabel(rooms(15, 0))).toBe("15 activas");
  });

  it("singular cuando hay una sola activa", () => {
    expect(roomsCountLabel(rooms(1, 0))).toBe("1 activa");
  });

  it("sin habitaciones activas lo dice igual", () => {
    expect(roomsCountLabel(rooms(0, 2))).toBe("0 activas · 2 inactivas");
    expect(roomsCountLabel([])).toBe("0 activas");
  });
});
