import { describe, it, expect } from "vitest";
import { determineSmarterAvailableRooms } from "@/lib/data";
import type { Room } from "@/lib/types";

function mockRoom(overrides: Partial<Room> & { id: number; capacity: number }): Room {
    const { id, capacity, ...rest } = overrides;

    return {
        id,
        room_number: `${id}`,
        room_type: "TEST",
        status: "available",
        capacity,
        capacity_adults: capacity,
        capacity_children: 0,
        beds_configuration: "1 Double",
        amenities: [],
        description: null,
        image_url: null,
        base_price: 10000,
        half_day_price: 5000,
        is_active: true,
        ...rest,
    };
}

describe("determineSmarterAvailableRooms", () => {
    it("returns empty array when no rooms available", () => {
        expect(determineSmarterAvailableRooms([], 2)).toEqual([]);
    });

    it("returns empty array when no rooms can satisfy guest count", () => {
        const rooms = [mockRoom({ id: 1, capacity: 1 })];
        expect(determineSmarterAvailableRooms(rooms, 5)).toEqual([]);
    });

    it("returns a single room when one room fits exactly", () => {
        const rooms = [
            mockRoom({ id: 1, capacity: 2 }),
            mockRoom({ id: 2, capacity: 3 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 2);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
    });

    it("for 2 guests, prefers 2 singles over 1 double (custom rule)", () => {
        const rooms = [
            mockRoom({ id: 1, capacity: 1 }),
            mockRoom({ id: 2, capacity: 1 }),
            mockRoom({ id: 3, capacity: 2 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 2);
        expect(result).toHaveLength(2);
        expect(result.every((room) => room.capacity === 1)).toBe(true);
    });

    it("for 3+ guests, prefers fewer rooms (1 triple over 1 double + 1 single)", () => {
        const rooms = [
            mockRoom({ id: 1, capacity: 1 }),
            mockRoom({ id: 2, capacity: 2 }),
            mockRoom({ id: 3, capacity: 3 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 3);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(3);
    });

    it("combines rooms when single room cannot satisfy", () => {
        const rooms = [
            mockRoom({ id: 1, capacity: 2 }),
            mockRoom({ id: 2, capacity: 2 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 4);
        expect(result).toHaveLength(2);
    });

    it("uses total room capacity consistently", () => {
        const rooms = [
            mockRoom({ id: 1, capacity: 3, capacity_adults: 2, capacity_children: 1 }),
            mockRoom({ id: 2, capacity: 1 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 3);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
    });

    it("returns closest to exact capacity (minimal waste)", () => {
        const rooms = [
            mockRoom({ id: 1, capacity: 2 }),
            mockRoom({ id: 2, capacity: 4 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 2);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
    });

    it("limits combo to max 4 rooms", () => {
        const rooms = Array.from({ length: 5 }, (_, i) =>
            mockRoom({ id: i + 1, capacity: 1 })
        );
        const result = determineSmarterAvailableRooms(rooms, 5);
        expect(result).toEqual([]);
    });

    it("handles single guest", () => {
        const rooms = [
            mockRoom({ id: 1, capacity: 1 }),
            mockRoom({ id: 2, capacity: 2 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 1);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
    });
});
