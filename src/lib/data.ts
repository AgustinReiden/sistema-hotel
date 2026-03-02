import "server-only";

import { createClient } from "./supabase/server";
import type {
  Guest,
  HotelSettings,
  Reservation,
  ReservationStatus,
  Room,
} from "./types";

const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = [
  "pending",
  "confirmed",
  "checked_in",
];

type DashboardData = {
  rooms: Room[];
  reservations: {
    id: string;
    room_id: number;
    client_name: string;
    status: ReservationStatus;
    check_in_target: string;
    check_out_target: string;
    actual_check_in: string | null;
    actual_check_out: string | null;
    total_price: number;
    paid_amount: number;
  }[];
  todayIncome: number;
  hotelSettings: HotelSettings;
};

type TimelineData = {
  rooms: Room[];
  reservations: Reservation[];
  startDate: Date;
  endDate: Date;
  daysCount: number;
};

type GuestReservationRow = {
  id: string;
  client_name: string;
  status: ReservationStatus;
  check_in_target: string;
  check_out_target: string;
  total_price: number;
  paid_amount: number;
  rooms: { room_number: string } | { room_number: string }[] | null;
};

type CreateReservationInput = {
  roomId: number;
  clientName: string;
  checkIn: string;
  checkOut: string;
};

export async function getHotelSettings(): Promise<HotelSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("hotel_settings").select("*").single();
  if (error) throw error;
  return data as HotelSettings;
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();

  const [roomsResult, reservationsResult, incomeResult, settingsResult] =
    await Promise.all([
      supabase.from("rooms").select("*").order("room_number"),
      supabase
        .from("reservations")
        .select("*")
        .in("status", ACTIVE_RESERVATION_STATUSES)
        .order("check_in_target", { ascending: true }),
      supabase.rpc("get_today_extra_income"),
      supabase.from("hotel_settings").select("*").single(),
    ]);

  if (roomsResult.error) throw roomsResult.error;
  if (reservationsResult.error) throw reservationsResult.error;
  if (settingsResult.error) throw settingsResult.error;

  const rooms = (roomsResult.data ?? []) as Room[];
  const reservations = (reservationsResult.data ?? []).map((r: {
    id: string;
    room_id: number;
    client_name: string;
    status: ReservationStatus;
    check_in_target: string;
    check_out_target: string;
    actual_check_in: string | null;
    actual_check_out: string | null;
    total_price: number | string;
    paid_amount: number | string;
  }) => ({
    id: r.id,
    room_id: r.room_id,
    client_name: r.client_name,
    status: r.status,
    check_in_target: r.check_in_target,
    check_out_target: r.check_out_target,
    actual_check_in: r.actual_check_in,
    actual_check_out: r.actual_check_out,
    total_price: Number(r.total_price) || 0,
    paid_amount: Number(r.paid_amount) || 0,
  }));
  const todayIncome = incomeResult.error ? 0 : Number(incomeResult.data || 0);
  const hotelSettings = settingsResult.data as HotelSettings;

  return { rooms, reservations, todayIncome, hotelSettings };
}

export async function getTimelineData(days = 7): Promise<TimelineData> {
  const supabase = await createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const end = new Date(today);
  end.setDate(end.getDate() + days);

  const [roomsResult, reservationsResult] = await Promise.all([
    supabase.from("rooms").select("*").order("room_number"),
    supabase
      .from("reservations")
      .select("*")
      .in("status", ACTIVE_RESERVATION_STATUSES)
      .or(
        `and(check_in_target.lte.${end.toISOString()},check_out_target.gte.${today.toISOString()})`
      ),
  ]);

  if (roomsResult.error) throw roomsResult.error;
  if (reservationsResult.error) throw reservationsResult.error;

  return {
    rooms: (roomsResult.data ?? []) as Room[],
    reservations: (reservationsResult.data ?? []) as Reservation[],
    startDate: today,
    endDate: end,
    daysCount: days,
  };
}

export async function getGuestsData(searchTerm = ""): Promise<Guest[]> {
  const supabase = await createClient();
  const normalizedSearch = searchTerm.trim();

  let query = supabase
    .from("reservations")
    .select(
      `
      id,
      client_name,
      status,
      check_in_target,
      check_out_target,
      total_price,
      paid_amount,
      rooms ( room_number )
      `
    )
    .order("check_in_target", { ascending: false });

  if (normalizedSearch) {
    query = query.ilike("client_name", `%${normalizedSearch}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as GuestReservationRow[];
  return rows.map((reservation) => {
    const roomRelation = reservation.rooms;
    const roomNumber = Array.isArray(roomRelation)
      ? roomRelation[0]?.room_number ?? "N/A"
      : roomRelation?.room_number ?? "N/A";

    return {
      id: reservation.id,
      client_name: reservation.client_name,
      status: reservation.status,
      check_in_target: reservation.check_in_target,
      check_out_target: reservation.check_out_target,
      room_number: roomNumber,
      total_price: reservation.total_price || 0,
      paid_amount: reservation.paid_amount || 0,
    };
  });
}

export async function applyLateCheckOut(reservationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_staff_apply_late_checkout", {
    p_reservation_id: reservationId,
  });

  if (error) throw error;
}

export async function doCheckout(reservationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_staff_checkout_reservation", {
    p_reservation_id: reservationId,
  });

  if (error) throw error;
}

export async function markRoomAsAvailable(roomId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("rooms")
    .update({ status: "available" })
    .eq("id", roomId);

  if (error) throw error;
}

export async function checkRoomAvailability(
  roomId: number,
  checkInTarget: string,
  checkOutTarget: string
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("id")
    .eq("room_id", roomId)
    .in("status", ACTIVE_RESERVATION_STATUSES)
    .or(`and(check_in_target.lt.${checkOutTarget},check_out_target.gt.${checkInTarget})`);

  if (error) throw error;
  return (data ?? []).length === 0;
}

export async function assignWalkIn(
  roomId: number,
  clientName: string,
  nights: number
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_staff_assign_walk_in", {
    p_room_id: roomId,
    p_client_name: clientName,
    p_nights: nights,
  });

  if (error) throw error;
  return String(data);
}

export async function publicCreateReservation({
  roomId,
  clientName,
  checkIn,
  checkOut,
}: CreateReservationInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_public_create_reservation", {
    p_room_id: roomId,
    p_client_name: clientName,
    p_check_in: checkIn,
    p_check_out: checkOut,
  });

  if (error) throw error;
  return String(data);
}

export async function staffCreateReservation({
  roomId,
  clientName,
  checkIn,
  checkOut,
}: CreateReservationInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_staff_create_reservation", {
    p_room_id: roomId,
    p_client_name: clientName,
    p_check_in: checkIn,
    p_check_out: checkOut,
  });

  if (error) throw error;
  return String(data);
}

export async function getAllRooms(): Promise<Room[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("rooms").select("*").order("room_number");
  if (error) throw error;
  return data as Room[];
}

export async function getAvailableRooms(
  checkInTarget: string,
  checkOutTarget: string,
  guestsStr?: string
): Promise<Room[]> {
  const supabase = await createClient();

  // Find reservations that overlap with the requested dates
  const { data: overlappingReservations, error: resError } = await supabase
    .from("reservations")
    .select("room_id")
    .in("status", ACTIVE_RESERVATION_STATUSES)
    .or(`and(check_in_target.lt.${checkOutTarget},check_out_target.gt.${checkInTarget})`);

  if (resError) throw resError;

  const occupiedRoomIds = overlappingReservations.map((r) => r.room_id);

  let query = supabase
    .from("rooms")
    .select("*")
    .eq("is_active", true)
    .eq("status", "available")
    .order("room_number");

  if (occupiedRoomIds.length > 0) {
    query = query.not("id", "in", `(${occupiedRoomIds.join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  let rooms = data as Room[];

  if (guestsStr) {
    const requestedGuests = parseInt(guestsStr, 10);
    if (!isNaN(requestedGuests) && requestedGuests > 0) {
      rooms = determineSmarterAvailableRooms(rooms, requestedGuests);
    }
  }

  return rooms;
}

function determineSmarterAvailableRooms(availableRooms: Room[], targetGuests: number): Room[] {
  const capMap = new Map<number, Room[]>();
  for (const r of availableRooms) {
    const cap = r.capacity_adults + r.capacity_children;
    if (!capMap.has(cap)) capMap.set(cap, []);
    capMap.get(cap)!.push(r);
  }

  const uniqueCaps = Array.from(capMap.keys()).sort((a, b) => a - b);
  const validTemplates: number[][] = [];

  const search = (capIndex: number, currentCombo: number[], currentSum: number) => {
    if (currentSum >= targetGuests) {
      validTemplates.push([...currentCombo]);
      return;
    }
    // Limit to max 4 rooms in a combo to prevent ridiculous recommendations
    if (currentCombo.length >= 4) return;

    for (let i = capIndex; i < uniqueCaps.length; i++) {
      const cap = uniqueCaps[i];
      const countNeeded = currentCombo.filter(c => c === cap).length + 1;

      // Only proceed if we actually have enough physical rooms of this capacity
      if (countNeeded <= capMap.get(cap)!.length) {
        currentCombo.push(cap);
        search(i, currentCombo, currentSum + cap);
        currentCombo.pop();
      }
    }
  };

  search(0, [], 0);

  if (validTemplates.length === 0) return [];

  validTemplates.sort((a, b) => {
    const sumA = a.reduce((s, c) => s + c, 0);
    const sumB = b.reduce((s, c) => s + c, 0);

    // 1. Closest to exact capacity is best
    if (sumA !== sumB) return sumA - sumB;

    // 2. Custom rule: For 2 guests, prefer 2 singles over 1 double
    if (targetGuests === 2) {
      const aIsTwoSingles = a.length === 2 && sumA === 2;
      const bIsTwoSingles = b.length === 2 && sumB === 2;
      if (aIsTwoSingles && !bIsTwoSingles) return -1;
      if (!aIsTwoSingles && bIsTwoSingles) return 1;
    }

    // 3. Otherwise, prefer FEWER rooms (e.g. 1 triple > 1 double + 1 single)
    if (a.length !== b.length) return a.length - b.length;

    return 0;
  });

  const bestTemplate = validTemplates[0];
  const requiredCounts = new Map<number, number>();
  for (const cap of bestTemplate) {
    requiredCounts.set(cap, (requiredCounts.get(cap) || 0) + 1);
  }

  const resultRooms: Room[] = [];
  for (const [cap, count] of requiredCounts.entries()) {
    const matchingRooms = capMap.get(cap)!;
    // Push exactly the required amount of rooms for this capacity
    resultRooms.push(...matchingRooms.slice(0, count));
  }

  return resultRooms;
}

export async function cancelReservation(reservationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_cancel_reservation", {
    p_reservation_id: reservationId,
  });

  if (error) throw error;
}

export async function extendReservation(reservationId: string, extraNights: number): Promise<void> {
  const supabase = await createClient();

  // 1. Get current reservation
  const { data: res, error: fetchErr } = await supabase
    .from("reservations")
    .select("room_id, check_out_target")
    .eq("id", reservationId)
    .single();

  if (fetchErr) throw fetchErr;

  const currentOut = new Date(res.check_out_target);
  const newOut = new Date(currentOut);
  newOut.setDate(newOut.getDate() + extraNights);
  const newOutString = newOut.toISOString();

  // 2. Check overlap logic specifically for the extended days
  const { data: overlapping, error: overlapErr } = await supabase
    .from("reservations")
    .select("id")
    .eq("room_id", res.room_id)
    .in("status", ACTIVE_RESERVATION_STATUSES)
    .neq("id", reservationId) // Ignore itself
    .or(`and(check_in_target.lt.${newOutString},check_out_target.gt.${currentOut.toISOString()})`);

  if (overlapErr) throw overlapErr;

  if (overlapping && overlapping.length > 0) {
    throw new Error("No se puede ampliar la reserva porque la habitación ya está comprometida para esas fechas.");
  }

  // 3. Update reservation
  const { error: updateErr } = await supabase
    .from("reservations")
    .update({ check_out_target: newOutString })
    .eq("id", reservationId);

  if (updateErr) throw updateErr;
}
