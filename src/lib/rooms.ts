import type { PublicRoomOffer, PublicRoomOfferMode, Room } from "@/lib/types";

const roomNumberCollator = new Intl.Collator("es-AR", {
  numeric: true,
  sensitivity: "base",
});

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

export function compareRoomNumbers(a: string, b: string): number {
  return roomNumberCollator.compare(a, b);
}

export function sortRoomTypes(roomTypes: string[]): string[] {
  return [...roomTypes].sort((a, b) =>
    a.localeCompare(b, "es-AR", { sensitivity: "base" })
  );
}

export function getUniqueRoomTypes<T extends Pick<Room, "room_type">>(rooms: T[]): string[] {
  return sortRoomTypes(
    Array.from(
      new Set(
        rooms
          .map((room) => room.room_type.trim())
          .filter(Boolean)
      )
    )
  );
}

export function sortRoomsByNumber<T extends Pick<Room, "room_number">>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) => compareRoomNumbers(a.room_number, b.room_number));
}

function summarizeBeds(rooms: Room[]): string {
  const uniqueConfigurations = Array.from(
    new Set(rooms.map((room) => room.beds_configuration.trim()).filter(Boolean))
  );

  if (uniqueConfigurations.length === 0) {
    return "Configuracion flexible";
  }

  if (uniqueConfigurations.length === 1) {
    return uniqueConfigurations[0];
  }

  if (uniqueConfigurations.length === 2) {
    return uniqueConfigurations.join(" o ");
  }

  return `${uniqueConfigurations[0]} y otras opciones`;
}

export function buildPublicRoomOffers(
  rooms: Room[],
  mode: PublicRoomOfferMode
): PublicRoomOffer[] {
  const groupedByType = new Map<string, Room[]>();

  for (const room of sortRoomsByNumber(rooms)) {
    const typeKey = room.room_type.trim();
    const existingRooms = groupedByType.get(typeKey);

    if (existingRooms) {
      existingRooms.push(room);
      continue;
    }

    groupedByType.set(typeKey, [room]);
  }

  return Array.from(groupedByType.entries())
    .map(([roomType, groupedRooms]) => {
      const sortedGroupedRooms = sortRoomsByNumber(groupedRooms);
      const representativeRoom =
        [...sortedGroupedRooms].sort(
          (a, b) =>
            a.base_price - b.base_price || compareRoomNumbers(a.room_number, b.room_number)
        )[0] ?? sortedGroupedRooms[0];

      const amenities = Array.from(
        new Set(sortedGroupedRooms.flatMap((room) => room.amenities))
      ).sort((a, b) => a.localeCompare(b, "es-AR", { sensitivity: "base" }));

      return {
        id: `${mode}-${roomType.toLowerCase().replace(/\s+/g, "-")}`,
        roomType,
        mode,
        representativeRoom,
        roomCount: sortedGroupedRooms.length,
        priceFrom: Math.min(...sortedGroupedRooms.map((room) => room.base_price)),
        maxCapacity: Math.max(...sortedGroupedRooms.map((room) => getRoomCapacity(room))),
        bedsSummary: summarizeBeds(sortedGroupedRooms),
        description:
          representativeRoom.description ??
          sortedGroupedRooms.find((room) => room.description)?.description ??
          null,
        imageUrl:
          representativeRoom.image_url ??
          sortedGroupedRooms.find((room) => room.image_url)?.image_url ??
          null,
        amenities,
      };
    })
    .sort(
      (a, b) =>
        compareRoomNumbers(
          a.representativeRoom.room_number,
          b.representativeRoom.room_number
        ) || a.roomType.localeCompare(b.roomType, "es-AR", { sensitivity: "base" })
    );
}
