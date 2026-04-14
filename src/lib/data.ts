import "server-only";

import { createClient } from "./supabase/server";
import { getRoomCapacity, sortRoomsByNumber } from "./rooms";
import type {
  AssignWalkInPayload,
  AssociatedClient,
  CreateReservationPayload,
  Guest,
  HotelSettings,
  PendingReservation,
  PaymentMethod,
  Reservation,
  ReservationStatus,
  RoomCategory,
  RoomCategoryUsage,
  Room,
  UserRole,
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
    base_total_price: number;
    discount_percent: number;
    discount_amount: number;
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
  clientDni: string;
  clientPhone?: string;
};

type AssociatedClientRow = {
  id: string;
  display_name: string;
  document_id: string;
  phone: string | null;
  discount_percent: number | string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type CheckoutReservationInput = {
  reservationId: string;
  paymentAmount?: number;
  paymentMethod?: PaymentMethod;
  paymentNotes?: string;
};

function toAssociatedClient(row: AssociatedClientRow): AssociatedClient {
  return {
    id: row.id,
    display_name: row.display_name,
    document_id: row.document_id,
    phone: row.phone,
    discount_percent: Number(row.discount_percent) || 0,
    notes: row.notes,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getHotelSettings(): Promise<HotelSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("hotel_settings").select("*").single();
  if (error) throw error;
  return data as HotelSettings;
}

export async function getCurrentUserRole(): Promise<UserRole> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return "client";

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error) throw error;
  return (data?.role as UserRole | undefined) ?? "client";
}

export async function getActiveAssociatedClients(): Promise<AssociatedClient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("associated_clients")
    .select("*")
    .eq("is_active", true)
    .order("display_name");

  if (error) throw error;
  return ((data ?? []) as AssociatedClientRow[]).map(toAssociatedClient);
}

export async function getAssociatedClients(searchTerm = ""): Promise<AssociatedClient[]> {
  const supabase = await createClient();
  const normalizedSearch = searchTerm.trim();

  let query = supabase
    .from("associated_clients")
    .select("*")
    .order("is_active", { ascending: false })
    .order("display_name");

  if (normalizedSearch) {
    query = query.or(
      `display_name.ilike.%${normalizedSearch}%,document_id.ilike.%${normalizedSearch}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as AssociatedClientRow[]).map(toAssociatedClient);
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();

  const [roomsResult, reservationsResult, incomeResult, settingsResult] =
    await Promise.all([
      supabase.from("rooms").select("*").order("room_number"),
      supabase
        .from("reservations")
        .select("*")
        .in("status", ["checked_in", "confirmed"])
        .order("check_in_target", { ascending: true }),
      supabase.rpc("get_today_extra_income"),
      supabase.from("hotel_settings").select("*").single(),
    ]);

  if (roomsResult.error) throw roomsResult.error;
  if (reservationsResult.error) throw reservationsResult.error;
  if (settingsResult.error) throw settingsResult.error;

  const rooms = sortRoomsByNumber((roomsResult.data ?? []) as Room[]);
  const reservations = (reservationsResult.data ?? []).map((r: {
    id: string;
    room_id: number;
    client_name: string;
    status: ReservationStatus;
    check_in_target: string;
    check_out_target: string;
    actual_check_in: string | null;
    actual_check_out: string | null;
    base_total_price: number | string | null;
    discount_percent: number | string | null;
    discount_amount: number | string | null;
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
    base_total_price: Number(r.base_total_price) || 0,
    discount_percent: Number(r.discount_percent) || 0,
    discount_amount: Number(r.discount_amount) || 0,
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

  const reservations = (reservationsResult.data ?? []).map((reservation: Reservation & {
    base_total_price: number | string | null;
    discount_percent: number | string | null;
    discount_amount: number | string | null;
    total_price: number | string;
    paid_amount: number | string;
  }) => ({
    ...reservation,
    base_total_price: Number(reservation.base_total_price) || 0,
    discount_percent: Number(reservation.discount_percent) || 0,
    discount_amount: Number(reservation.discount_amount) || 0,
    total_price: Number(reservation.total_price) || 0,
    paid_amount: Number(reservation.paid_amount) || 0,
  })) as Reservation[];

  return {
    rooms: sortRoomsByNumber((roomsResult.data ?? []) as Room[]),
    reservations,
    startDate: today,
    endDate: end,
    daysCount: days,
  };
}

export async function getGuestsData(searchTerm = "", statusFilter = ""): Promise<Guest[]> {
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

  if (statusFilter) {
    query = query.eq("status", statusFilter);
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

export async function doCheckIn(reservationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_staff_checkin_reservation", {
    p_reservation_id: reservationId,
  });
  if (error) throw error;
}

export async function doCheckout({
  reservationId,
  paymentAmount,
  paymentMethod,
  paymentNotes,
}: CheckoutReservationInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_staff_checkout_reservation", {
    p_reservation_id: reservationId,
    p_payment_amount: paymentAmount ?? null,
    p_payment_method: paymentMethod ?? null,
    p_payment_notes: paymentNotes ?? null,
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

export async function assignWalkIn(input: AssignWalkInPayload): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_staff_assign_walk_in", {
    p_room_id: input.roomId,
    p_client_name: input.customerMode === "manual" ? input.clientName : null,
    p_nights: input.nights,
    p_associated_client_id:
      input.customerMode === "associated" ? input.associatedClientId : null,
  });

  if (error) throw error;
  return String(data);
}

export async function publicCreateReservation({
  roomId,
  clientName,
  checkIn,
  checkOut,
  clientPhone,
  clientDni,
}: CreateReservationInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_public_create_reservation", {
    p_room_id: roomId,
    p_client_name: clientName,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_client_phone: clientPhone || null,
    p_client_dni: clientDni || null,
  });

  if (error) throw error;
  return String(data);
}

export async function publicCreateReservationByType(
  input: Omit<CreateReservationInput, "roomId"> & { roomType: string }
): Promise<string> {
  const availableRooms = await getAvailableRooms(input.checkIn, input.checkOut);
  const matchingRoom = availableRooms.find(
    (room) => room.room_type.trim().toLowerCase() === input.roomType.trim().toLowerCase()
  );

  if (!matchingRoom) {
    throw new Error(
      "Ya no quedan habitaciones disponibles en esa categoria para las fechas seleccionadas."
    );
  }

  return publicCreateReservation({
    roomId: matchingRoom.id,
    clientName: input.clientName,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    clientPhone: input.clientPhone,
    clientDni: input.clientDni,
  });
}

export async function staffCreateReservation(
  input: CreateReservationPayload
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_staff_create_reservation", {
    p_room_id: input.roomId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_client_name: input.customerMode === "manual" ? input.clientName : null,
    p_client_dni: input.customerMode === "manual" ? input.clientDni : null,
    p_client_phone:
      input.customerMode === "manual" ? input.clientPhone || null : null,
    p_associated_client_id:
      input.customerMode === "associated" ? input.associatedClientId : null,
  });

  if (error) throw error;
  return String(data);
}

export async function getAllRooms(): Promise<Room[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("rooms").select("*");
  if (error) throw error;
  return sortRoomsByNumber((data ?? []) as Room[]);
}

export async function getRoomCategories(): Promise<RoomCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("room_categories")
    .select("*")
    .order("name");

  if (error) throw error;

  return (data ?? []).map((category) => ({
    ...category,
    capacity: Number(category.capacity) || 0,
    capacity_adults: Number(category.capacity_adults) || 0,
    capacity_children: Number(category.capacity_children) || 0,
    base_price: Number(category.base_price) || 0,
    half_day_price: Number(category.half_day_price) || 0,
    amenities: Array.isArray(category.amenities)
      ? (category.amenities as string[])
      : [],
  })) as RoomCategory[];
}

export async function getRoomCategoriesWithUsage(): Promise<RoomCategoryUsage[]> {
  const supabase = await createClient();
  const [categories, roomsResult] = await Promise.all([
    getRoomCategories(),
    supabase.from("rooms").select("category_id"),
  ]);

  if (roomsResult.error) throw roomsResult.error;

  const roomCounts = new Map<number, number>();
  for (const room of roomsResult.data ?? []) {
    if (typeof room.category_id !== "number") continue;
    roomCounts.set(room.category_id, (roomCounts.get(room.category_id) || 0) + 1);
  }

  return categories.map((category) => ({
    ...category,
    room_count: roomCounts.get(category.id) || 0,
  }));
}

export async function getAvailableRooms(
  checkInTarget: string,
  checkOutTarget: string
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

  // Only filter by is_active, not by current status (cleaning/maintenance are temporary)
  let query = supabase
    .from("rooms")
    .select("*")
    .eq("is_active", true);

  if (occupiedRoomIds.length > 0) {
    query = query.not("id", "in", `(${occupiedRoomIds.join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return sortRoomsByNumber((data ?? []) as Room[]);
}

export function determineSmarterAvailableRooms(availableRooms: Room[], targetGuests: number): Room[] {
  const capMap = new Map<number, Room[]>();
  for (const r of availableRooms) {
    const cap = getRoomCapacity(r);
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

export async function cancelReservation(reservationId: string, reason: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_cancel_reservation", {
    p_reservation_id: reservationId,
    p_reason: reason,
  });

  if (error) throw error;
}

export async function extendReservation(reservationId: string, extraNights: number): Promise<void> {
  const supabase = await createClient();

  // 1. Get current reservation
  const { data: res, error: fetchErr } = await supabase
    .from("reservations")
    .select(
      "room_id, check_in_target, check_out_target, total_price, base_total_price, discount_percent"
    )
    .eq("id", reservationId)
    .single();

  if (fetchErr) throw fetchErr;

  const currentIn = new Date(res.check_in_target);
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

  // 3. Compute the actual nightly rate from the existing reservation
  const currentTotal = Number(res.total_price) || 0;
  const currentBaseTotal = Number(res.base_total_price) || currentTotal;
  const currentDiscountPercent = Number(res.discount_percent) || 0;
  // Duration in ms → days (using floor to avoid floating-point issues with half-day checkout)
  const existingNights = Math.max(1, Math.round(
    (currentOut.getTime() - currentIn.getTime()) / (1000 * 60 * 60 * 24)
  ));
  const nightlyBaseRate = currentBaseTotal / existingNights;
  const newBaseTotal = currentBaseTotal + extraNights * nightlyBaseRate;
  const newDiscountAmount =
    Math.round(((newBaseTotal * currentDiscountPercent) / 100) * 100) / 100;
  const newTotal = newBaseTotal - newDiscountAmount;

  // 4. Update reservation
  const { error: updateErr } = await supabase
    .from("reservations")
    .update({
      check_out_target: newOutString,
      base_total_price: newBaseTotal,
      discount_percent: currentDiscountPercent,
      discount_amount: newDiscountAmount,
      total_price: newTotal,
    })
    .eq("id", reservationId);

  if (updateErr) throw updateErr;
}

// ---- Solicitudes de Reserva ----

type PendingReservationRow = {
  id: string;
  client_name: string;
  client_phone: string | null;
  client_dni: string | null;
  status: ReservationStatus;
  check_in_target: string;
  check_out_target: string;
  total_price: number;
  whatsapp_notified: boolean;
  rooms: { room_number: string; room_type: string } | { room_number: string; room_type: string }[] | null;
};

export async function getSolicitudesData(): Promise<PendingReservation[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("reservations")
    .select(`
      id,
      client_name,
      client_phone,
      client_dni,
      status,
      check_in_target,
      check_out_target,
      total_price,
      whatsapp_notified,
      rooms ( room_number, room_type )
    `)
    .in("status", ["pending", "confirmed", "cancelled"])
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as PendingReservationRow[];
  return rows.map((r) => {
    const roomRelation = r.rooms;
    const room = Array.isArray(roomRelation) ? roomRelation[0] : roomRelation;

    return {
      id: r.id,
      client_name: r.client_name,
      client_phone: r.client_phone,
      client_dni: r.client_dni,
      status: r.status,
      check_in_target: r.check_in_target,
      check_out_target: r.check_out_target,
      total_price: Number(r.total_price) || 0,
      whatsapp_notified: r.whatsapp_notified ?? false,
      room_number: room?.room_number ?? "N/A",
      room_type: room?.room_type ?? "N/A",
    };
  });
}

export async function confirmReservation(reservationId: string): Promise<Record<string, unknown>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_confirm_reservation", {
    p_reservation_id: reservationId,
  });

  if (error) throw error;
  return data as Record<string, unknown>;
}

export async function getReservationWithRoom(reservationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(`
      id,
      client_name,
      client_phone,
      client_dni,
      status,
      check_in_target,
      check_out_target,
      total_price,
      whatsapp_notified,
      rooms ( room_number, room_type )
    `)
    .eq("id", reservationId)
    .single();

  if (error) throw error;

  type RoomJoin = { room_number: string; room_type: string };
  const roomRelation = data.rooms as RoomJoin | RoomJoin[] | null;
  const room = Array.isArray(roomRelation) ? roomRelation[0] : roomRelation;

  return {
    ...data,
    room_number: room?.room_number ?? "N/A",
    room_type: room?.room_type ?? "N/A",
  };
}

export async function updateWhatsappStatus(reservationId: string, notified: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reservations")
    .update({ whatsapp_notified: notified })
    .eq("id", reservationId);

  if (error) throw error;
}

// ---- Analytics Dashboard ----

export type DailyIncome = { date: string; total: number };
export type RoomTypeOccupancy = { room_type: string; count: number };
export type PaymentMethodBreakdown = { method: string; total: number };
export type StatusBreakdown = { status: string; count: number };

export type AnalyticsData = {
  // KPIs
  occupancyRate: number;
  totalIncome: number;
  totalReservations: number;
  averageTicket: number;
  totalCheckIns: number;
  totalCancellations: number;
  // Chart data
  dailyIncome: DailyIncome[];
  roomTypeOccupancy: RoomTypeOccupancy[];
  paymentMethods: PaymentMethodBreakdown[];
  statusBreakdown: StatusBreakdown[];
};

export async function getAnalyticsData(
  startDateStr: string,
  endDateStr: string
): Promise<AnalyticsData> {
  const supabase = await createClient();

  // Build UTC boundaries from date strings
  const startUTC = new Date(`${startDateStr}T00:00:00`).toISOString();
  const endUTC = new Date(`${endDateStr}T23:59:59.999`).toISOString();

  const [
    roomsResult,
    checkedInResult,
    reservationsInRangeResult,
    paymentsInRangeResult,
  ] = await Promise.all([
    // All active rooms
    supabase.from("rooms").select("id, room_type").eq("is_active", true),
    // Currently checked-in reservations
    supabase.from("reservations").select("id").eq("status", "checked_in"),
    // Reservations created in the date range (excluding cancelled for avg ticket)
    supabase
      .from("reservations")
      .select("id, status, total_price, actual_check_in, room_id, rooms(room_type)")
      .gte("created_at", startUTC)
      .lte("created_at", endUTC),
    // Payments in the date range
    supabase
      .from("payments")
      .select("id, amount, payment_method, created_at")
      .gte("created_at", startUTC)
      .lte("created_at", endUTC),
  ]);

  const rooms = roomsResult.data ?? [];
  const checkedIn = checkedInResult.data ?? [];
  const reservations = reservationsInRangeResult.data ?? [];
  const payments = paymentsInRangeResult.data ?? [];

  // ── KPIs ──
  const totalRooms = rooms.length;
  const occupancyRate = totalRooms > 0 ? (checkedIn.length / totalRooms) * 100 : 0;

  const totalIncome = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  const totalReservations = reservations.length;

  const nonCancelledReservations = reservations.filter(
    (r) => r.status !== "cancelled"
  );
  const averageTicket =
    nonCancelledReservations.length > 0
      ? nonCancelledReservations.reduce(
          (sum, r) => sum + Number(r.total_price),
          0
        ) / nonCancelledReservations.length
      : 0;

  const totalCheckIns = reservations.filter(
    (r) => r.actual_check_in !== null
  ).length;

  const totalCancellations = reservations.filter(
    (r) => r.status === "cancelled"
  ).length;

  // ── Chart: Daily Income ──
  const dailyMap = new Map<string, number>();
  for (const p of payments) {
    const day = new Date(p.created_at).toISOString().split("T")[0];
    dailyMap.set(day, (dailyMap.get(day) || 0) + Number(p.amount));
  }
  // Fill in missing days in range
  const cursor = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  while (cursor <= endDate) {
    const key = cursor.toISOString().split("T")[0];
    if (!dailyMap.has(key)) dailyMap.set(key, 0);
    cursor.setDate(cursor.getDate() + 1);
  }
  const dailyIncome: DailyIncome[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));

  // ── Chart: Room Type Occupancy ──
  type RoomJoinRow = {
    room_id: number;
    rooms: { room_type: string } | { room_type: string }[] | null;
  };
  const roomTypeMap = new Map<string, number>();
  for (const r of reservations.filter(
    (r) => r.status === "checked_in" || r.status === "confirmed"
  ) as unknown as RoomJoinRow[]) {
    const roomRel = r.rooms;
    const roomType = Array.isArray(roomRel)
      ? roomRel[0]?.room_type
      : roomRel?.room_type;
    if (roomType) {
      roomTypeMap.set(roomType, (roomTypeMap.get(roomType) || 0) + 1);
    }
  }
  const roomTypeOccupancy: RoomTypeOccupancy[] = Array.from(
    roomTypeMap.entries()
  ).map(([room_type, count]) => ({ room_type, count }));

  // ── Chart: Payment Methods ──
  const methodMap = new Map<string, number>();
  for (const p of payments) {
    methodMap.set(
      p.payment_method,
      (methodMap.get(p.payment_method) || 0) + Number(p.amount)
    );
  }
  const paymentMethodsData: PaymentMethodBreakdown[] = Array.from(
    methodMap.entries()
  )
    .map(([method, total]) => ({ method, total }))
    .sort((a, b) => b.total - a.total);

  // ── Chart: Status Breakdown ──
  const statusMap = new Map<string, number>();
  for (const r of reservations) {
    statusMap.set(r.status, (statusMap.get(r.status) || 0) + 1);
  }
  const statusBreakdown: StatusBreakdown[] = Array.from(
    statusMap.entries()
  ).map(([status, count]) => ({ status, count }));

  return {
    occupancyRate,
    totalIncome,
    totalReservations,
    averageTicket,
    totalCheckIns,
    totalCancellations,
    dailyIncome,
    roomTypeOccupancy,
    paymentMethods: paymentMethodsData,
    statusBreakdown,
  };
}
