import { describe, it, expect } from 'vitest';
import { determineSmarterAvailableRooms } from '@/lib/data';
import type { Room } from '@/lib/types';

/**
 * Helper to create a mock Room for testing the room selection algorithm.
 */
function mockRoom(overrides: Partial<Room> & { id: number; capacity_adults: number; capacity_children: number }): Room {
    return {
        room_number: `${overrides.id}`,
        room_type: 'TEST',
        status: 'available',
        beds_configuration: '1 Double',
        amenities: [],
        description: null,
        image_url: null,
        base_price: 10000,
        half_day_price: 5000,
        is_active: true,
        ...overrides,
    };
}

describe('determineSmarterAvailableRooms', () => {
    it('returns empty array when no rooms available', () => {
        expect(determineSmarterAvailableRooms([], 2)).toEqual([]);
    });

    it('returns empty array when no rooms can satisfy guest count', () => {
        const rooms = [mockRoom({ id: 1, capacity_adults: 1, capacity_children: 0 })];
        // Need 5 guests but only 1 room with capacity 1
        expect(determineSmarterAvailableRooms(rooms, 5)).toEqual([]);
    });

    it('returns a single room when one room fits exactly', () => {
        const rooms = [
            mockRoom({ id: 1, capacity_adults: 2, capacity_children: 0 }),
            mockRoom({ id: 2, capacity_adults: 3, capacity_children: 0 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 2);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1); // capacity 2 is exact fit
    });

    it('for 2 guests, prefers 2 singles over 1 double (custom rule)', () => {
        const rooms = [
            mockRoom({ id: 1, capacity_adults: 1, capacity_children: 0 }),
            mockRoom({ id: 2, capacity_adults: 1, capacity_children: 0 }),
            mockRoom({ id: 3, capacity_adults: 2, capacity_children: 0 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 2);
        // Should prefer 2 singles (rooms 1+2) over 1 double (room 3)
        expect(result).toHaveLength(2);
        expect(result.every(r => r.capacity_adults === 1)).toBe(true);
    });

    it('for 3+ guests, prefers fewer rooms (1 triple over 1 double + 1 single)', () => {
        const rooms = [
            mockRoom({ id: 1, capacity_adults: 1, capacity_children: 0 }),
            mockRoom({ id: 2, capacity_adults: 2, capacity_children: 0 }),
            mockRoom({ id: 3, capacity_adults: 3, capacity_children: 0 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 3);
        // Should prefer 1 triple (room 3) over 1 double + 1 single
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(3);
    });

    it('combines rooms when single room cannot satisfy', () => {
        const rooms = [
            mockRoom({ id: 1, capacity_adults: 2, capacity_children: 0 }),
            mockRoom({ id: 2, capacity_adults: 2, capacity_children: 0 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 4);
        expect(result).toHaveLength(2);
    });

    it('considers capacity_children in total capacity', () => {
        const rooms = [
            mockRoom({ id: 1, capacity_adults: 2, capacity_children: 1 }), // cap = 3
            mockRoom({ id: 2, capacity_adults: 1, capacity_children: 0 }), // cap = 1
        ];
        const result = determineSmarterAvailableRooms(rooms, 3);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
    });

    it('returns closest to exact capacity (minimal waste)', () => {
        const rooms = [
            mockRoom({ id: 1, capacity_adults: 2, capacity_children: 0 }), // cap = 2
            mockRoom({ id: 2, capacity_adults: 4, capacity_children: 0 }), // cap = 4
        ];
        const result = determineSmarterAvailableRooms(rooms, 2);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1); // cap 2 is exact, cap 4 is overkill
    });

    it('limits combo to max 4 rooms', () => {
        // 5 rooms of capacity 1 each, looking for 5 guests
        const rooms = Array.from({ length: 5 }, (_, i) =>
            mockRoom({ id: i + 1, capacity_adults: 1, capacity_children: 0 })
        );
        const result = determineSmarterAvailableRooms(rooms, 5);
        // Should return empty because max combo is 4 rooms (4 cap) < 5 guests
        expect(result).toEqual([]);
    });

    it('handles single guest', () => {
        const rooms = [
            mockRoom({ id: 1, capacity_adults: 1, capacity_children: 0 }),
            mockRoom({ id: 2, capacity_adults: 2, capacity_children: 0 }),
        ];
        const result = determineSmarterAvailableRooms(rooms, 1);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
    });
});
