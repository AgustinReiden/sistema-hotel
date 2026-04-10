import type { Room } from "@/lib/types";

export function getRoomCapacity(room: Pick<Room, "capacity" | "capacity_adults" | "capacity_children">): number {
  if (typeof room.capacity === "number" && Number.isFinite(room.capacity) && room.capacity > 0) {
    return room.capacity;
  }

  const adults =
    typeof room.capacity_adults === "number" && Number.isFinite(room.capacity_adults)
      ? room.capacity_adults
      : 0;
  const children =
    typeof room.capacity_children === "number" && Number.isFinite(room.capacity_children)
      ? room.capacity_children
      : 0;

  return Math.max(1, adults + children);
}
