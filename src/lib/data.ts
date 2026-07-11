import "server-only";

import { createClient } from "./supabase/server";
import { getRoomCapacity, sortRoomsByNumber } from "./rooms";
import { localToISO } from "./format";
import { hotelDateKey } from "./time";
import {
  buildDailyTotals,
  buildOccupancyHistogram,
  buildRevenueByRoomType,
  buildRoomBreakdown,
  computeWindowKpis,
  countDaysInclusive,
  hotelRangeToUtc,
  pctDelta,
  previousPeriodRange,
  summarizeRoomBreakdown,
  type CreatedReservation,
  type CreatedRoomReservation,
  type DailyOccupancy,
  type DailyTotal,
  type NightlyReservation,
  type PaymentPoint,
  type RoomBreakdownRow,
  type RoomBreakdownTotals,
  type RoomCleaning,
  type RoomInfo,
} from "./analytics";
import type {
  AdminAlert,
  AssignWalkInPayload,
  AssociatedClient,
  AssociatedClientLedger,
  CashShift,
  CashShiftStatus,
  CheckoutExportRow,
  CleaningCategory,
  CleaningOutcome,
  CleaningType,
  CompanyPassenger,
  CreateReservationPayload,
  CtaCteAccount,
  CtaCteClientKind,
  CtaCteMovimiento,
  DiscountedClient,
  RegisterAccountPaymentPayload,
  Guest,
  GuestDirectoryEntry,
  GuestDniMatch,
  HotelSettings,
  MaintenanceRoom,
  PendingReservation,
  PaymentMethod,
  Reservation,
  ReservationHistoryPage,
  ReservationStatus,
  RoomCategory,
  RoomCategoryUsage,
  CleaningLogResult,
  Room,
  ShiftPaymentRow,
  TodayCleaning,
  ShiftSummary,
  UpcomingGuest,
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
    late_check_out_until: string | null;
    actual_check_in: string | null;
    actual_check_out: string | null;
    base_total_price: number;
    discount_percent: number;
    discount_amount: number;
    total_price: number;
    paid_amount: number;
  }[];
  /** reservationId -> el cliente facturable tiene cuenta corriente habilitada. */
  accountCreditByReservation: Record<string, boolean>;
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
  client_dni: string | null;
  status: ReservationStatus;
  check_in_target: string;
  check_out_target: string;
  total_price: number;
  paid_amount: number;
  guest_profession: string | null;
  guest_address: string | null;
  guest_locality: string | null;
  guest_nationality: string | null;
  guest_doc_type: string | null;
  guest_birth_date: string | null;
  guest_vehicle: string | null;
  rooms: { room_number: string } | { room_number: string }[] | null;
};

type CreateReservationInput = {
  roomId: number;
  clientName: string;
  checkIn: string;
  checkOut: string;
  clientDni: string;
  clientPhone?: string;
  guestCount?: number;
};

type AssociatedClientRow = {
  id: string;
  display_name: string;
  document_id: string;
  phone: string | null;
  discount_percent: number | string;
  notes: string | null;
  is_active: boolean;
  cuenta_corriente_habilitada?: boolean | null;
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
    cuenta_corriente_habilitada: Boolean(row.cuenta_corriente_habilitada),
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

/**
 * Ficha de un asociado: su historial de estadías + totales (facturado/cobrado/saldo).
 * El saldo es la deuda pendiente = facturado - cobrado, sobre estadías no canceladas.
 */
export async function getAssociatedClientLedger(
  clientId: string
): Promise<AssociatedClientLedger> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(
      `
      id,
      client_name,
      notes,
      status,
      check_in_target,
      check_out_target,
      total_price,
      paid_amount,
      rooms ( room_number )
      `
    )
    .eq("associated_client_id", clientId)
    .order("check_in_target", { ascending: false });

  if (error) throw error;

  type LedgerRow = {
    id: string;
    client_name: string | null;
    notes: string | null;
    status: ReservationStatus;
    check_in_target: string;
    check_out_target: string;
    total_price: number | string | null;
    paid_amount: number | string | null;
    rooms: { room_number: string } | { room_number: string }[] | null;
  };

  const rows = (data ?? []) as LedgerRow[];
  let facturado = 0;
  let cobrado = 0;
  let count = 0;

  const reservations = rows.map((row) => {
    const roomRelation = row.rooms;
    const roomNumber = Array.isArray(roomRelation)
      ? roomRelation[0]?.room_number ?? null
      : roomRelation?.room_number ?? null;
    const total = Number(row.total_price) || 0;
    const paid = Number(row.paid_amount) || 0;

    if (row.status !== "cancelled") {
      facturado += total;
      cobrado += paid;
      count += 1;
    }

    // Pasajero real: en el modelo nuevo es client_name (la persona). Para filas legacy de
    // modo asociado, client_name era la empresa y el pasajero quedaba en notes ("Pasajero: ...").
    const legacyPassenger =
      row.notes && /^Pasajero:/i.test(row.notes)
        ? row.notes.replace(/^Pasajero:\s*/i, "").trim()
        : null;

    return {
      id: row.id,
      passenger: legacyPassenger ?? row.client_name ?? null,
      room_number: roomNumber,
      status: row.status,
      check_in_target: row.check_in_target,
      check_out_target: row.check_out_target,
      total_price: total,
      paid_amount: paid,
    };
  });

  return { reservations, facturado, cobrado, saldo: facturado - cobrado, count };
}

// ===========================================================================
// Cuenta corriente (saldo = Σ cargos − Σ pagos; puede ser negativo = saldo a favor)
// ===========================================================================

type CcMovRow = {
  associated_client_id: string | null;
  guest_id: string | null;
  tipo: "cargo" | "pago";
  amount: number | string;
};

function signedMovement(tipo: "cargo" | "pago", amount: number): number {
  return tipo === "cargo" ? amount : -amount;
}

/**
 * Cuentas corrientes para la lista central de deudores: clientes habilitados O con saldo ≠ 0.
 */
export async function getCtaCteAccounts(): Promise<CtaCteAccount[]> {
  const supabase = await createClient();

  const [movRes, companiesRes, guestsRes] = await Promise.all([
    supabase.from("cuenta_corriente_movimientos").select("associated_client_id, guest_id, tipo, amount"),
    supabase
      .from("associated_clients")
      .select("id, display_name, document_id")
      .eq("cuenta_corriente_habilitada", true),
    supabase
      .from("guests")
      .select("id, full_name, document_id")
      .eq("cuenta_corriente_habilitada", true),
  ]);
  if (movRes.error) throw movRes.error;

  const companyBalance = new Map<string, number>();
  const guestBalance = new Map<string, number>();
  for (const m of (movRes.data ?? []) as CcMovRow[]) {
    const delta = signedMovement(m.tipo, Number(m.amount) || 0);
    if (m.associated_client_id) {
      companyBalance.set(m.associated_client_id, (companyBalance.get(m.associated_client_id) ?? 0) + delta);
    } else if (m.guest_id) {
      guestBalance.set(m.guest_id, (guestBalance.get(m.guest_id) ?? 0) + delta);
    }
  }

  const enabledCompanies = (companiesRes.data ?? []) as { id: string; display_name: string; document_id: string | null }[];
  const enabledGuests = (guestsRes.data ?? []) as { id: string; full_name: string; document_id: string | null }[];

  // Nombres de clientes con saldo que NO están en las listas de habilitados (ej. flag apagado luego).
  const enabledCompanyIds = new Set(enabledCompanies.map((c) => c.id));
  const enabledGuestIds = new Set(enabledGuests.map((g) => g.id));
  const extraCompanyIds = [...companyBalance.keys()].filter((id) => !enabledCompanyIds.has(id));
  const extraGuestIds = [...guestBalance.keys()].filter((id) => !enabledGuestIds.has(id));

  const [extraCompaniesRes, extraGuestsRes] = await Promise.all([
    extraCompanyIds.length
      ? supabase.from("associated_clients").select("id, display_name, document_id").in("id", extraCompanyIds)
      : Promise.resolve({ data: [], error: null }),
    extraGuestIds.length
      ? supabase.from("guests").select("id, full_name, document_id").in("id", extraGuestIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const accounts: CtaCteAccount[] = [];
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  for (const c of [...enabledCompanies, ...((extraCompaniesRes.data ?? []) as typeof enabledCompanies)]) {
    accounts.push({
      kind: "company",
      id: c.id,
      name: c.display_name,
      document_id: c.document_id ?? null,
      balance: round2(companyBalance.get(c.id) ?? 0),
    });
  }
  for (const g of [...enabledGuests, ...((extraGuestsRes.data ?? []) as typeof enabledGuests)]) {
    accounts.push({
      kind: "guest",
      id: g.id,
      name: g.full_name,
      document_id: g.document_id ?? null,
      balance: round2(guestBalance.get(g.id) ?? 0),
    });
  }

  // Deudores primero (mayor saldo), después el resto por nombre.
  return accounts.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "es-AR"));
}

/** Movimientos de la cuenta de un cliente (para la ficha), ordenados del más reciente. */
export async function getCtaCteMovements(
  kind: CtaCteClientKind,
  clientId: string
): Promise<{ movements: CtaCteMovimiento[]; balance: number }> {
  const supabase = await createClient();
  const column = kind === "company" ? "associated_client_id" : "guest_id";

  const { data, error } = await supabase
    .from("cuenta_corriente_movimientos")
    .select("id, tipo, amount, reservation_id, payment_method, notes, created_at")
    .eq(column, clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const movements = ((data ?? []) as (CtaCteMovimiento & { amount: number | string })[]).map((m) => ({
    ...m,
    amount: Number(m.amount) || 0,
  }));
  const balance = movements.reduce((sum, m) => sum + signedMovement(m.tipo, m.amount), 0);
  return { movements, balance: Math.round((balance + Number.EPSILON) * 100) / 100 };
}

/** Registra un pago a cuenta (vía RPC admin-only). No toca la caja. */
export async function registerAccountPayment(input: RegisterAccountPaymentPayload): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_register_account_payment", {
    p_associated_client_id: input.kind === "company" ? input.clientId : null,
    p_guest_id: input.kind === "guest" ? input.clientId : null,
    p_amount: input.amount,
    p_method: input.method ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  const result = data as { movement_id?: string } | null;
  return String(result?.movement_id ?? "");
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
  const rawReservations = (reservationsResult.data ?? []) as {
    id: string;
    room_id: number;
    client_name: string;
    status: ReservationStatus;
    check_in_target: string;
    check_out_target: string;
    late_check_out_until: string | null;
    actual_check_in: string | null;
    actual_check_out: string | null;
    base_total_price: number | string | null;
    discount_percent: number | string | null;
    discount_amount: number | string | null;
    total_price: number | string;
    paid_amount: number | string;
    associated_client_id: string | null;
    guest_id: string | null;
  }[];

  const reservations = rawReservations.map((r) => ({
    id: r.id,
    room_id: r.room_id,
    client_name: r.client_name,
    status: r.status,
    check_in_target: r.check_in_target,
    check_out_target: r.check_out_target,
    late_check_out_until: r.late_check_out_until,
    actual_check_in: r.actual_check_in,
    actual_check_out: r.actual_check_out,
    base_total_price: Number(r.base_total_price) || 0,
    discount_percent: Number(r.discount_percent) || 0,
    discount_amount: Number(r.discount_amount) || 0,
    total_price: Number(r.total_price) || 0,
    paid_amount: Number(r.paid_amount) || 0,
  }));

  // Resolver, por reserva, si el cliente facturable (empresa o huésped) tiene cta cte habilitada.
  const accountCreditByReservation = await resolveAccountCreditByReservation(supabase, rawReservations);

  const todayIncome = incomeResult.error ? 0 : Number(incomeResult.data || 0);
  const hotelSettings = settingsResult.data as HotelSettings;

  return { rooms, reservations, accountCreditByReservation, todayIncome, hotelSettings };
}

/**
 * Para un set de reservas, devuelve un mapa reservationId -> el cliente facturable
 * (associated_client_id ?? guest_id) tiene cuenta corriente habilitada.
 */
async function resolveAccountCreditByReservation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: { id: string; associated_client_id: string | null; guest_id: string | null }[]
): Promise<Record<string, boolean>> {
  const companyIds = [...new Set(rows.map((r) => r.associated_client_id).filter(Boolean))] as string[];
  const guestIds = [...new Set(rows.map((r) => r.guest_id).filter(Boolean))] as string[];

  const [companyRes, guestRes] = await Promise.all([
    companyIds.length
      ? supabase.from("associated_clients").select("id, cuenta_corriente_habilitada").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    guestIds.length
      ? supabase.from("guests").select("id, cuenta_corriente_habilitada").in("id", guestIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const enabledCompany = new Set(
    ((companyRes.data ?? []) as { id: string; cuenta_corriente_habilitada: boolean }[])
      .filter((c) => c.cuenta_corriente_habilitada)
      .map((c) => c.id)
  );
  const enabledGuest = new Set(
    ((guestRes.data ?? []) as { id: string; cuenta_corriente_habilitada: boolean }[])
      .filter((g) => g.cuenta_corriente_habilitada)
      .map((g) => g.id)
  );

  const map: Record<string, boolean> = {};
  for (const r of rows) {
    map[r.id] = r.associated_client_id
      ? enabledCompany.has(r.associated_client_id)
      : r.guest_id
        ? enabledGuest.has(r.guest_id)
        : false;
  }
  return map;
}

export async function getTimelineData(days = 7): Promise<TimelineData> {
  const supabase = await createClient();
  const settings = await getHotelSettings();
  const tz = settings.timezone || "America/Argentina/Tucuman";

  // "Hoy" en la zona del hotel (NO la del servidor, que en prod es UTC): así la primera
  // columna del calendario no se corre un día durante la franja nocturna de Argentina
  // (~21:00–23:59, cuando en UTC ya es el día siguiente).
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const today = new Date(localToISO(todayKey, "00:00", tz));

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
    guest_count?: number | string | null;
  }) => ({
    ...reservation,
    base_total_price: Number(reservation.base_total_price) || 0,
    discount_percent: Number(reservation.discount_percent) || 0,
    discount_amount: Number(reservation.discount_amount) || 0,
    total_price: Number(reservation.total_price) || 0,
    paid_amount: Number(reservation.paid_amount) || 0,
    guest_count: Number(reservation.guest_count ?? 1) || 1,
  })) as Reservation[];

  return {
    rooms: sortRoomsByNumber((roomsResult.data ?? []) as Room[]),
    reservations,
    startDate: today,
    endDate: end,
    daysCount: days,
  };
}

const GUEST_RESERVATION_SELECT = `
  id,
  client_name,
  client_dni,
  status,
  check_in_target,
  check_out_target,
  total_price,
  paid_amount,
  guest_profession,
  guest_address,
  guest_locality,
  guest_nationality,
  guest_doc_type,
  guest_birth_date,
  guest_vehicle,
  rooms ( room_number )
`;

function roomNumberFromRelation(
  relation: { room_number: string } | { room_number: string }[] | null
): string {
  return Array.isArray(relation)
    ? relation[0]?.room_number ?? "N/A"
    : relation?.room_number ?? "N/A";
}

function mapGuestReservationRow(reservation: GuestReservationRow): Guest {
  return {
    id: reservation.id,
    client_name: reservation.client_name,
    client_dni: reservation.client_dni ?? null,
    status: reservation.status,
    check_in_target: reservation.check_in_target,
    check_out_target: reservation.check_out_target,
    room_number: roomNumberFromRelation(reservation.rooms),
    total_price: reservation.total_price || 0,
    paid_amount: reservation.paid_amount || 0,
    guest_profession: reservation.guest_profession ?? null,
    guest_address: reservation.guest_address ?? null,
    guest_locality: reservation.guest_locality ?? null,
    guest_nationality: reservation.guest_nationality ?? null,
    guest_doc_type: reservation.guest_doc_type ?? null,
    guest_birth_date: reservation.guest_birth_date ?? null,
    guest_vehicle: reservation.guest_vehicle ?? null,
  };
}

// Clave de deduplicación: DNI normalizado (sin puntos/guiones, mayúsculas) si existe;
// si no, el nombre normalizado. Resuelve "Jose Boeris" vs "JOSÉ BOERIS" cuando comparten DNI.
function guestDedupKey(dni: string | null | undefined, name: string): string {
  const normalizedDni = (dni ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (normalizedDni) return `dni:${normalizedDni}`;
  return `name:${name.trim().toLowerCase()}`;
}

// Limpia el término de búsqueda de caracteres que rompen el parser de `.or()` de PostgREST
// (coma, paréntesis) y de los comodines de ilike (`%` `_` `*`). Sin esto, buscar algo con una
// coma o un CUIT con paréntesis tiraba un 500 y rompía la pantalla de Huéspedes/Asociados.
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%_*"]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Directorio REAL de huéspedes: una fila por persona (deduplicada por DNI/nombre),
 * con los datos canónicos de su reserva más reciente + cantidad de estadías.
 */
export async function getGuestDirectory(searchTerm = ""): Promise<GuestDirectoryEntry[]> {
  const supabase = await createClient();
  const search = sanitizeSearchTerm(searchTerm);

  // Fuente 1: registro de huespedes (tabla guests; importado del Excel del hotel / cargas).
  let guestsQuery = supabase
    .from("guests")
    .select(`id, full_name, document_type, document_id, phone, locality, nationality, discount_percent, cuenta_corriente_habilitada`)
    .order("full_name", { ascending: true });

  // Fuente 2: gente que efectivamente se hospedo. Solo estadias reales (checked_in/checked_out)
  // para que "estadias" y "ultima visita" no se inflen con reservas futuras (pending/confirmed).
  let resQuery = supabase
    .from("reservations")
    .select(
      `client_name, client_dni, client_phone, check_in_target, guest_locality, guest_nationality, guest_doc_type`
    )
    .in("status", ["checked_in", "checked_out"])
    .order("check_in_target", { ascending: false });

  if (search) {
    guestsQuery = guestsQuery.or(`full_name.ilike.%${search}%,document_id.ilike.%${search}%`);
    resQuery = resQuery.or(`client_name.ilike.%${search}%,client_dni.ilike.%${search}%`);
  }

  const [guestsRes, resRes] = await Promise.all([guestsQuery, resQuery]);
  if (resRes.error) throw resRes.error;
  // La tabla guests podria no existir en un entorno sin migrar: si falla, seguimos solo con
  // reservas en vez de romper el directorio.
  const guestRows = guestsRes.error ? [] : guestsRes.data ?? [];

  type ResRow = {
    client_name: string;
    client_dni: string | null;
    client_phone: string | null;
    check_in_target: string;
    guest_locality: string | null;
    guest_nationality: string | null;
    guest_doc_type: string | null;
  };
  type GuestRow = {
    id: string;
    full_name: string;
    document_type: string | null;
    document_id: string | null;
    phone: string | null;
    locality: string | null;
    nationality: string | null;
    discount_percent: number | null;
    cuenta_corriente_habilitada: boolean | null;
  };

  const map = new Map<string, GuestDirectoryEntry>();

  // Reservas primero (aportan cantidad de estadias y ultima visita). Vienen ordenadas por
  // check_in_target DESC -> la primera ocurrencia de cada clave es la mas reciente (canonica).
  for (const r of (resRes.data ?? []) as ResRow[]) {
    const key = guestDedupKey(r.client_dni, r.client_name);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        id: null,
        client_name: r.client_name,
        client_dni: r.client_dni ?? null,
        client_phone: r.client_phone ?? null,
        guest_locality: r.guest_locality ?? null,
        guest_nationality: r.guest_nationality ?? null,
        guest_doc_type: r.guest_doc_type ?? null,
        discount_percent: 0,
        cuenta_corriente_habilitada: false,
        stays_count: 1,
        last_check_in: r.check_in_target,
      });
    } else {
      existing.stays_count += 1;
      existing.client_phone = existing.client_phone ?? r.client_phone ?? null;
      existing.guest_locality = existing.guest_locality ?? r.guest_locality ?? null;
      existing.guest_nationality = existing.guest_nationality ?? r.guest_nationality ?? null;
      existing.guest_doc_type = existing.guest_doc_type ?? r.guest_doc_type ?? null;
    }
  }

  // Registro de huespedes: agrega a los que todavia no tienen reserva y completa datos
  // faltantes (telefono, localidad, etc.) de los que ya estan.
  for (const g of guestRows as GuestRow[]) {
    const key = guestDedupKey(g.document_id, g.full_name);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        id: g.id,
        client_name: g.full_name,
        client_dni: g.document_id ?? null,
        client_phone: g.phone ?? null,
        guest_locality: g.locality ?? null,
        guest_nationality: g.nationality ?? null,
        guest_doc_type: g.document_type ?? null,
        discount_percent: Number(g.discount_percent ?? 0),
        cuenta_corriente_habilitada: Boolean(g.cuenta_corriente_habilitada),
        stays_count: 0,
        last_check_in: null,
      });
    } else {
      // La ficha del padron es canonica para id y descuento personal.
      existing.id = existing.id ?? g.id;
      existing.discount_percent = Number(g.discount_percent ?? existing.discount_percent ?? 0);
      existing.cuenta_corriente_habilitada =
        existing.cuenta_corriente_habilitada || Boolean(g.cuenta_corriente_habilitada);
      existing.client_phone = existing.client_phone ?? g.phone ?? null;
      existing.guest_locality = existing.guest_locality ?? g.locality ?? null;
      existing.guest_nationality = existing.guest_nationality ?? g.nationality ?? null;
      existing.guest_doc_type = existing.guest_doc_type ?? g.document_type ?? null;
    }
  }

  // Orden: primero los que se hospedaron (por ultima visita desc), despues el registro por nombre.
  return Array.from(map.values()).sort((a, b) => {
    if (a.last_check_in && b.last_check_in) return b.last_check_in.localeCompare(a.last_check_in);
    if (a.last_check_in) return -1;
    if (b.last_check_in) return 1;
    return a.client_name.localeCompare(b.client_name, "es-AR", { sensitivity: "base" });
  });
}

/**
 * Historial de reservas paginado (15 por página por defecto), acotado a los últimos
 * `days` días (60 por defecto). Devuelve también el total para la paginación.
 */
export async function getReservationHistory(
  options: {
    page?: number;
    pageSize?: number;
    days?: number;
    search?: string;
    includeCancelled?: boolean;
  } = {}
): Promise<ReservationHistoryPage> {
  const supabase = await createClient();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? 15;
  const days = options.days ?? 60;
  const search = sanitizeSearchTerm(options.search ?? "");
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("reservations")
    .select(GUEST_RESERVATION_SELECT, { count: "exact" })
    .gte("check_in_target", sinceIso)
    .order("check_in_target", { ascending: false });

  if (!options.includeCancelled) {
    query = query.neq("status", "cancelled");
  }
  if (search) {
    query = query.or(`client_name.ilike.%${search}%,client_dni.ilike.%${search}%`);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as GuestReservationRow[]).map(mapGuestReservationRow);
  const total = count ?? 0;
  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Huéspedes por llegar: todas las reservas próximas (pending/confirmed) sin límite de
 * tiempo, ordenadas por fecha de entrada ascendente.
 */
export async function getUpcomingGuests(searchTerm = ""): Promise<UpcomingGuest[]> {
  const supabase = await createClient();
  const search = sanitizeSearchTerm(searchTerm);

  let query = supabase
    .from("reservations")
    .select(
      `id, client_name, client_dni, status, check_in_target, check_out_target, guest_count, rooms ( room_number )`
    )
    .in("status", ["pending", "confirmed"])
    .order("check_in_target", { ascending: true });

  if (search) {
    query = query.or(`client_name.ilike.%${search}%,client_dni.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  type Row = {
    id: string;
    client_name: string;
    client_dni: string | null;
    status: ReservationStatus;
    check_in_target: string;
    check_out_target: string;
    guest_count: number | null;
    rooms: { room_number: string } | { room_number: string }[] | null;
  };

  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    client_name: r.client_name,
    client_dni: r.client_dni ?? null,
    status: r.status,
    check_in_target: r.check_in_target,
    check_out_target: r.check_out_target,
    room_number: roomNumberFromRelation(r.rooms),
    guest_count: r.guest_count ?? 1,
  }));
}

const normalizeDni = (dni: string | null | undefined) =>
  (dni ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

/**
 * Busca un huésped ya cargado con el mismo DNI (normalizado, sin puntos/guiones).
 * Sirve para evitar duplicados ("Jose Boeris" vs "JOSÉ BOERIS"): si existe, la UI
 * ofrece reutilizar los datos canónicos. Devuelve la coincidencia más reciente.
 */
export async function findGuestByDni(dni: string): Promise<GuestDniMatch | null> {
  const normalized = normalizeDni(dni);
  if (normalized.length < 6) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("client_name, client_first_name, client_last_name, client_phone, client_dni, check_in_target")
    .neq("status", "cancelled")
    .not("client_dni", "is", null)
    .order("check_in_target", { ascending: false });

  if (error) throw error;

  type Row = {
    client_name: string;
    client_first_name: string | null;
    client_last_name: string | null;
    client_phone: string | null;
    client_dni: string | null;
  };

  for (const r of (data ?? []) as Row[]) {
    if (normalizeDni(r.client_dni) === normalized) {
      return {
        client_name: r.client_name,
        client_first_name: r.client_first_name ?? null,
        client_last_name: r.client_last_name ?? null,
        client_phone: r.client_phone ?? null,
      };
    }
  }
  return null;
}

/**
 * Fija el descuento personal de un huesped del padron. Si la persona todavia no tiene ficha
 * (id null en el directorio, solo viene de reservas), crea el registro con ese descuento.
 * Solo admin (RLS de la tabla guests + guard de la pagina /admin/guests).
 */
export async function setGuestPersonalDiscount(input: {
  id?: string | null;
  fullName: string;
  documentId?: string | null;
  discountPercent: number;
}): Promise<void> {
  const supabase = await createClient();

  if (input.id) {
    const { error } = await supabase
      .from("guests")
      .update({
        discount_percent: input.discountPercent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("guests").insert({
    full_name: input.fullName,
    document_id: input.documentId ?? null,
    discount_percent: input.discountPercent,
  });
  if (error) throw error;
}

/** Fija el descuento de una empresa/convenio (seccion Descuentos). Solo admin. */
export async function setCompanyDiscount(
  companyId: string,
  discountPercent: number
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("associated_clients")
    .update({ discount_percent: discountPercent, updated_at: new Date().toISOString() })
    .eq("id", companyId);
  if (error) throw error;
}

/** Lista de clientes con descuento (huespedes + empresas) para la seccion Descuentos. */
export async function getDiscountedClients(): Promise<DiscountedClient[]> {
  const supabase = await createClient();
  const [guestsRes, companiesRes] = await Promise.all([
    supabase
      .from("guests")
      .select("id, full_name, document_id, discount_percent")
      .gt("discount_percent", 0)
      .order("full_name", { ascending: true }),
    supabase
      .from("associated_clients")
      .select("id, display_name, document_id, discount_percent")
      .gt("discount_percent", 0)
      .order("display_name", { ascending: true }),
  ]);
  if (guestsRes.error) throw guestsRes.error;
  if (companiesRes.error) throw companiesRes.error;

  const companies: DiscountedClient[] = (companiesRes.data ?? []).map((c) => ({
    kind: "company",
    id: c.id,
    name: c.display_name,
    document_id: c.document_id ?? null,
    discount_percent: Number(c.discount_percent) || 0,
  }));
  const guests: DiscountedClient[] = (guestsRes.data ?? []).map((g) => ({
    kind: "guest",
    id: g.id,
    name: g.full_name,
    document_id: g.document_id ?? null,
    discount_percent: Number(g.discount_percent) || 0,
  }));
  return [...companies, ...guests];
}

/** Pasajeros de una empresa (tabla company_passengers), buscados por nombre o DNI. */
export async function searchCompanyPassengers(
  companyId: string,
  term = ""
): Promise<CompanyPassenger[]> {
  const supabase = await createClient();
  let query = supabase
    .from("company_passengers")
    .select("*")
    .eq("associated_client_id", companyId)
    .order("full_name", { ascending: true });

  const search = sanitizeSearchTerm(term);
  if (search) {
    query = query.or(`full_name.ilike.%${search}%,document_id.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(25);
  if (error) throw error;
  return (data ?? []) as CompanyPassenger[];
}

export async function applyLateCheckOut(
  reservationId: string
): Promise<{ halfDayCharged: boolean; halfDayAmount: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_staff_apply_late_checkout", {
    p_reservation_id: reservationId,
  });

  if (error) throw error;
  const r = (data ?? {}) as { half_day_charged?: boolean; half_day_amount?: number };
  return {
    halfDayCharged: Boolean(r.half_day_charged),
    halfDayAmount: Number(r.half_day_amount) || 0,
  };
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
}: CheckoutReservationInput): Promise<{ paymentId: string | null; movementId: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_staff_checkout_reservation", {
    p_reservation_id: reservationId,
    p_payment_amount: paymentAmount ?? null,
    p_payment_method: paymentMethod ?? null,
    p_payment_notes: paymentNotes ?? null,
  });

  if (error) throw error;
  const result = (data ?? {}) as { payment_id?: string | null; movement_id?: string | null };
  return { paymentId: result.payment_id ?? null, movementId: result.movement_id ?? null };
}

/**
 * Salida anticipada: recalcula el precio a las noches dormidas y cierra la
 * reserva en una sola operación (rpc_staff_early_checkout). Mismo shape que
 * doCheckout (soporta cobro normal y cierre a cuenta corriente).
 */
export async function doEarlyCheckout({
  reservationId,
  paymentAmount,
  paymentMethod,
  paymentNotes,
}: CheckoutReservationInput): Promise<{ paymentId: string | null; movementId: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_staff_early_checkout", {
    p_reservation_id: reservationId,
    p_payment_amount: paymentAmount ?? null,
    p_payment_method: paymentMethod ?? null,
    p_payment_notes: paymentNotes ?? null,
  });

  if (error) throw error;
  const result = (data ?? {}) as { payment_id?: string | null; movement_id?: string | null };
  return { paymentId: result.payment_id ?? null, movementId: result.movement_id ?? null };
}

export async function markRoomAsAvailable(roomId: number): Promise<void> {
  // Se rutea por el RPC que valida rol (admin o maintenance) y registra
  // la limpieza en room_cleaning_log para auditoría.
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_mark_room_clean", {
    p_room_id: roomId,
    p_notes: null,
    p_cleaning_type: null,
  });
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
  // Mismo fork que el alta: persona (huesped en guests) o empresa (pasajero en company_passengers).
  const params: Record<string, string | number | boolean | null> = {
    p_room_id: input.roomId,
    p_nights: input.nights,
    p_guest_count: input.guestCount ?? 1,
  };
  if (input.stayType === "half_day") {
    params.p_half_day = true;
  }

  if (input.mode === "company") {
    params.p_associated_client_id = input.associatedClientId;
    params.p_company_passenger_id = input.companyPassengerId || null;
    params.p_client_name = input.passengerName;
    params.p_client_dni = input.passengerDni;
  } else {
    params.p_associated_client_id = null;
    params.p_company_passenger_id = null;
    params.p_guest_id = input.guestId || null;
    // El nombre completo lo compone el RPC a partir de nombre + apellido.
    params.p_client_name = null;
    params.p_client_first_name = input.clientFirstName;
    params.p_client_last_name = input.clientLastName;
    params.p_client_dni = input.clientDni;
  }

  if (input.guestProfession) params.p_guest_profession = input.guestProfession;
  if (input.guestAddress) params.p_guest_address = input.guestAddress;
  if (input.guestLocality) params.p_guest_locality = input.guestLocality;
  if (input.guestNationality) params.p_guest_nationality = input.guestNationality;
  if (input.guestDocType) params.p_guest_doc_type = input.guestDocType;
  if (input.guestBirthDate) params.p_guest_birth_date = input.guestBirthDate;
  if (input.guestVehicle) params.p_guest_vehicle = input.guestVehicle;

  const { data, error } = await supabase.rpc("rpc_staff_assign_walk_in", params);

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
  guestCount,
}: CreateReservationInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_public_create_reservation", {
    p_room_id: roomId,
    p_client_name: clientName,
    p_check_in: checkIn,
    p_check_out: checkOut,
    p_client_phone: clientPhone || null,
    p_client_dni: clientDni || null,
    // NOTE: rpc_public_create_reservation aún no acepta guest_count. Cuando
    // se agregue la migración, se lo pasamos acá. Por ahora queda 1 por default.
    ...(guestCount ? { p_guest_count: guestCount } : {}),
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
    guestCount: input.guestCount,
  });
}

export async function staffCreateReservation(
  input: CreateReservationPayload
): Promise<string> {
  const supabase = await createClient();
  // La reserva es persona o empresa; el RPC hace find-or-create del humano (huesped en guests /
  // pasajero en company_passengers) y resuelve el descuento (empresa -> huesped seleccionado -> 0).
  const params: Record<string, string | number | null> = {
    p_room_id: input.roomId,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_guest_count: input.guestCount ?? 1,
  };

  if (input.mode === "company") {
    params.p_associated_client_id = input.associatedClientId;
    params.p_company_passenger_id = input.companyPassengerId || null;
    // El humano que se hospeda es el pasajero de la empresa.
    params.p_client_name = input.passengerName;
    params.p_client_dni = input.passengerDni;
    params.p_client_phone = input.passengerPhone || null;
  } else {
    params.p_associated_client_id = null;
    params.p_company_passenger_id = null;
    params.p_guest_id = input.guestId || null;
    // El nombre completo lo compone el RPC a partir de nombre + apellido.
    params.p_client_name = null;
    params.p_client_first_name = input.clientFirstName;
    params.p_client_last_name = input.clientLastName;
    params.p_client_dni = input.clientDni;
    params.p_client_phone = input.clientPhone || null;
  }

  if (input.guestProfession) params.p_guest_profession = input.guestProfession;
  if (input.guestAddress) params.p_guest_address = input.guestAddress;
  if (input.guestLocality) params.p_guest_locality = input.guestLocality;
  if (input.guestNationality) params.p_guest_nationality = input.guestNationality;
  if (input.guestDocType) params.p_guest_doc_type = input.guestDocType;
  if (input.guestBirthDate) params.p_guest_birth_date = input.guestBirthDate;
  if (input.guestVehicle) params.p_guest_vehicle = input.guestVehicle;

  const { data, error } = await supabase.rpc("rpc_staff_create_reservation", params);

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

  // Usamos la vista pública `reservations_availability` que sólo expone
  // room_id + rangos, sin datos PII. Funciona para anon (landing) y staff.
  const { data: overlappingReservations, error: resError } = await supabase
    .from("reservations_availability")
    .select("room_id")
    .or(`and(check_in_target.lt.${checkOutTarget},check_out_target.gt.${checkInTarget})`);

  if (resError) throw resError;

  const occupiedRoomIds = (overlappingReservations ?? []).map((r) => r.room_id);

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

/**
 * Habitaciones disponibles para mover una reserva activa.
 * Excluye la habitacion actual de la reserva y cualquiera con otras reservas activas
 * que se solapen con las fechas de esta reserva.
 */
export async function getRoomsAvailableForReservation(
  reservationId: string
): Promise<{ currentRoomId: number; checkIn: string; checkOut: string; rooms: Room[] }> {
  const supabase = await createClient();

  const { data: reservation, error: resError } = await supabase
    .from("reservations")
    .select("id, room_id, check_in_target, check_out_target, status")
    .eq("id", reservationId)
    .single();

  if (resError) throw resError;
  if (!reservation) throw new Error("Reserva no encontrada.");

  const { data: overlapping, error: overlapError } = await supabase
    .from("reservations")
    .select("room_id")
    .in("status", ACTIVE_RESERVATION_STATUSES)
    .neq("id", reservationId)
    .or(
      `and(check_in_target.lt.${reservation.check_out_target},check_out_target.gt.${reservation.check_in_target})`
    );

  if (overlapError) throw overlapError;

  const blockedRoomIds = new Set<number>((overlapping ?? []).map((r) => r.room_id));
  blockedRoomIds.add(reservation.room_id);

  let query = supabase.from("rooms").select("*").eq("is_active", true);
  if (blockedRoomIds.size > 0) {
    query = query.not("id", "in", `(${Array.from(blockedRoomIds).join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    currentRoomId: reservation.room_id,
    checkIn: reservation.check_in_target,
    checkOut: reservation.check_out_target,
    rooms: sortRoomsByNumber((data ?? []) as Room[]),
  };
}

export async function addExtraCharge(
  reservationId: string,
  chargeType: string,
  amount: number,
  description?: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_add_extra_charge", {
    p_reservation_id: reservationId,
    p_charge_type: chargeType,
    p_amount: amount,
    p_description: description ?? null,
  });
  if (error) throw error;
}

export type ChangeRoomReason = "room_defective" | "guest_request";

export async function changeReservationRoom(
  reservationId: string,
  newRoomId: number,
  reason: ChangeRoomReason
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_change_reservation_room", {
    p_reservation_id: reservationId,
    p_new_room_id: newRoomId,
    p_reason: reason,
  });
  if (error) throw error;
}

export type ReservationEditableRow = {
  id: string;
  client_name: string;
  client_dni: string | null;
  client_phone: string | null;
  notes: string | null;
  check_in_target: string;
  check_out_target: string;
  status: ReservationStatus;
  total_price: number;
  base_total_price: number;
  discount_percent: number;
  discount_amount: number;
  paid_amount: number;
  room_number: string;
  associated_client_id: string | null;
  guest_count: number;
};

export async function getReservationForEdit(
  reservationId: string
): Promise<ReservationEditableRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(
      `
      id, client_name, client_dni, client_phone, notes,
      check_in_target, check_out_target, status,
      total_price, base_total_price, discount_percent, discount_amount,
      paid_amount, associated_client_id, guest_count,
      rooms ( room_number )
      `
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  type Raw = {
    id: string;
    client_name: string;
    client_dni: string | null;
    client_phone: string | null;
    notes: string | null;
    check_in_target: string;
    check_out_target: string;
    status: ReservationStatus;
    total_price: number | string;
    base_total_price: number | string;
    discount_percent: number | string;
    discount_amount: number | string;
    paid_amount: number | string;
    associated_client_id: string | null;
    guest_count: number | string | null;
    rooms: { room_number: string } | { room_number: string }[] | null;
  };
  const raw = data as unknown as Raw;
  const roomsRel = raw.rooms;
  const roomNumber = Array.isArray(roomsRel)
    ? roomsRel[0]?.room_number
    : roomsRel?.room_number;

  return {
    id: raw.id,
    client_name: raw.client_name,
    client_dni: raw.client_dni,
    client_phone: raw.client_phone,
    notes: raw.notes,
    check_in_target: raw.check_in_target,
    check_out_target: raw.check_out_target,
    status: raw.status as ReservationStatus,
    total_price: Number(raw.total_price) || 0,
    base_total_price: Number(raw.base_total_price) || 0,
    discount_percent: Number(raw.discount_percent) || 0,
    discount_amount: Number(raw.discount_amount) || 0,
    paid_amount: Number(raw.paid_amount) || 0,
    room_number: roomNumber ?? "—",
    associated_client_id: raw.associated_client_id,
    guest_count: Number(raw.guest_count ?? 1) || 1,
  };
}

export type UpdateReservationInput = {
  reservationId: string;
  clientName: string;
  clientDni?: string | null;
  clientPhone?: string | null;
  notes?: string | null;
  checkIn: string;
  checkOut: string;
  overrideTotalPrice?: number | null;
  guestCount?: number | null;
};

export async function updateReservation(input: UpdateReservationInput): Promise<{
  total_price: number;
  base_total_price: number;
  discount_percent: number;
  discount_amount: number;
  dates_changed: boolean;
  price_overridden: boolean;
  guest_count?: number;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_update_reservation", {
    p_reservation_id: input.reservationId,
    p_client_name: input.clientName,
    p_client_dni: input.clientDni ?? null,
    p_client_phone: input.clientPhone ?? null,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_notes: input.notes ?? null,
    p_override_total_price: input.overrideTotalPrice ?? null,
    p_guest_count: input.guestCount ?? null,
  });
  if (error) throw error;
  const result = data as {
    total_price: number | string;
    base_total_price: number | string;
    discount_percent: number | string;
    discount_amount: number | string;
    dates_changed: boolean;
    price_overridden: boolean;
  };
  return {
    total_price: Number(result.total_price) || 0,
    base_total_price: Number(result.base_total_price) || 0,
    discount_percent: Number(result.discount_percent) || 0,
    discount_amount: Number(result.discount_amount) || 0,
    dates_changed: result.dates_changed,
    price_overridden: result.price_overridden,
  };
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

export async function getCancellationReason(
  reservationId: string
): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservation_cancellations")
    .select("reason")
    .eq("reservation_id", reservationId)
    .order("cancelled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data?.reason as string | null) ?? null;
}

export async function extendReservation(reservationId: string, extraNights: number): Promise<void> {
  const supabase = await createClient();

  // 1. Get current reservation
  const { data: res, error: fetchErr } = await supabase
    .from("reservations")
    .select(
      "room_id, status, check_in_target, check_out_target, total_price, base_total_price, discount_percent, discount_amount"
    )
    .eq("id", reservationId)
    .single();

  if (fetchErr) throw fetchErr;

  // Guard de estado (la UI ya solo ofrece "Ampliar" en reservas activas, pero no dependemos
  // solo del render): no permitir ampliar una reserva cancelada/finalizada.
  if (res.status !== "confirmed" && res.status !== "checked_in") {
    throw new Error("Solo se puede ampliar una reserva activa (confirmada o en estadía).");
  }

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
  const currentDiscountAmount = Number(res.discount_amount) || 0;
  // Recargos ya cargados (extras del minibar, medio día, etc.) que NO forman parte de la base:
  // se suman directo a total_price, así que hay que preservarlos al recalcular. Antes "ampliar"
  // recalculaba el total desde la base y los borraba en silencio (pérdida de plata).
  const existingNetBase = currentBaseTotal - currentDiscountAmount;
  const surcharges = Math.max(0, Math.round((currentTotal - existingNetBase) * 100) / 100);
  // Duration in ms → days (using floor to avoid floating-point issues with half-day checkout)
  const existingNights = Math.max(1, Math.round(
    (currentOut.getTime() - currentIn.getTime()) / (1000 * 60 * 60 * 24)
  ));
  const nightlyBaseRate = currentBaseTotal / existingNights;
  const newBaseTotal = currentBaseTotal + extraNights * nightlyBaseRate;
  const newDiscountAmount =
    Math.round(((newBaseTotal * currentDiscountPercent) / 100) * 100) / 100;
  const newTotal = newBaseTotal - newDiscountAmount + surcharges;

  // 4. Update reservation
  const { error: updateErr } = await supabase
    .from("reservations")
    .update({
      check_out_target: newOutString,
      base_total_price: newBaseTotal,
      discount_percent: currentDiscountPercent,
      discount_amount: newDiscountAmount,
      total_price: newTotal,
      // Ampliar mueve el checkout hacia adelante: cualquier late-checkout viejo deja de
      // valer y hay que limpiarlo, si no el tablero marca un falso "Retraso Check-out".
      late_check_out_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservationId);

  if (updateErr) {
    // Carrera con el constraint anti-solapamiento (EXCLUDE, errcode 23P01): traducir el mensaje
    // crudo de Postgres a algo claro para el recepcionista.
    if ((updateErr as { code?: string }).code === "23P01") {
      throw new Error(
        "No se puede ampliar: la habitación quedó comprometida para esas fechas."
      );
    }
    throw updateErr;
  }
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

/**
 * Lista pendientes (sin límite) + procesadas (confirmed/cancelled) de los
 * últimos 7 días. La UI separa pending vs procesadas client-side.
 */
export async function getSolicitudesData(): Promise<PendingReservation[]> {
  const supabase = await createClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const baseSelect = `
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
  `;

  const [pendingResult, processedResult] = await Promise.all([
    supabase
      .from("reservations")
      .select(baseSelect)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("reservations")
      .select(baseSelect)
      .in("status", ["confirmed", "cancelled"])
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false }),
  ]);

  if (pendingResult.error) throw pendingResult.error;
  if (processedResult.error) throw processedResult.error;

  const rows = [
    ...((pendingResult.data ?? []) as PendingReservationRow[]),
    ...((processedResult.data ?? []) as PendingReservationRow[]),
  ];

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

// ---- Tablero Gerencial (BI) ----

export type KpiWithDelta = { current: number; previous: number; deltaPct: number | null };

export type DashboardKpis = {
  lodgingRevenue: KpiWithDelta;
  totalPaymentsIncome: KpiWithDelta;
  occupancyRate: KpiWithDelta;
  adr: KpiWithDelta;
  revpar: KpiWithDelta;
  reservationsCreated: KpiWithDelta;
  cancellationRate: KpiWithDelta;
  avgLengthOfStay: KpiWithDelta;
  avgLeadTimeDays: KpiWithDelta;
};

export type ManagementDashboardData = {
  range: { from: string; to: string; days: number };
  previousRange: { from: string; to: string };
  currency: string;
  activeRooms: number;
  kpis: DashboardKpis;
  // Series del período actual
  dailyOccupancy: DailyOccupancy[];
  dailyCash: DailyTotal[];
  // Breakdowns del período actual
  revenueByRoomType: { room_type: string; total: number }[];
  paymentMethods: { method: string; total: number }[];
  extraChargesByType: { charge_type: string; total: number }[];
  // Cobranzas (snapshot actual, no acotado al rango)
  accountsReceivable: number;
  currentAccountDebt: number;
  topDebtors: { name: string; balance: number }[];
  // Control de caja y operación del período
  cashDiscrepancyTotal: number;
  cleaningsByCategory: { category: string; count: number }[];
  openAlerts: number;
};

/**
 * Datos del Tablero Gerencial para el rango [startKey, endKey] (claves "YYYY-MM-DD" en
 * la zona del hotel). Los KPIs principales traen su comparación contra el período
 * contiguo anterior de igual longitud. La agregación pesada (room-nights, ocupación,
 * ADR/RevPAR) vive en funciones puras testeables de ./analytics; acá solo se traen y
 * mapean las filas. Bucketing y límites de rango son en zona del hotel (no UTC).
 */
export async function getManagementDashboardData(
  startKey: string,
  endKey: string
): Promise<ManagementDashboardData> {
  const supabase = await createClient();
  const settings = await getHotelSettings();
  const tz = settings.timezone || "America/Argentina/Tucuman";
  const currency = settings.currency || "ARS";
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const prev = previousPeriodRange(startKey, endKey);
  const unionWindow = hotelRangeToUtc(prev.start, endKey, tz); // [prevInicio .. fin]
  const current = hotelRangeToUtc(startKey, endKey, tz); // solo período actual

  const [
    roomsRes,
    overlapRes,
    createdRes,
    paymentsRes,
    extrasRes,
    shiftsRes,
    cleaningRes,
    receivableRes,
    ccAccounts,
    alertsRes,
  ] = await Promise.all([
    supabase.from("rooms").select("id").eq("is_active", true),
    // Estadías (no canceladas, comprometidas) que solapan la ventana unión.
    supabase
      .from("reservations")
      .select(
        "status, check_in_target, check_out_target, actual_check_in, actual_check_out, base_total_price, discount_amount, created_at, room_id, rooms(room_type)"
      )
      .in("status", ["confirmed", "checked_in", "checked_out"])
      .lt("check_in_target", unionWindow.endUtcExclusive)
      .gte("check_out_target", unionWindow.startUtc),
    // Reservas creadas en la ventana unión (pickup / cancelaciones).
    supabase
      .from("reservations")
      .select("status, created_at")
      .gte("created_at", unionWindow.startUtc)
      .lt("created_at", unionWindow.endUtcExclusive),
    // Pagos de la ventana unión (para caja cobrada y su delta).
    supabase
      .from("payments")
      .select("amount, payment_method, created_at")
      .gte("created_at", unionWindow.startUtc)
      .lt("created_at", unionWindow.endUtcExclusive),
    // Recargos extra del período actual.
    supabase
      .from("extra_charges")
      .select("charge_type, amount, created_at")
      .gte("created_at", current.startUtc)
      .lt("created_at", current.endUtcExclusive),
    // Arqueos cerrados en el período (discrepancias).
    supabase
      .from("cash_shifts")
      .select("discrepancy, closed_at")
      .eq("status", "closed")
      .gte("closed_at", current.startUtc)
      .lt("closed_at", current.endUtcExclusive),
    // Limpiezas del período (productividad housekeeping).
    supabase
      .from("room_cleaning_log")
      .select("cleaning_category, cleaned_at")
      .gte("cleaned_at", current.startUtc)
      .lt("cleaned_at", current.endUtcExclusive),
    // Reservas activas con saldo (por cobrar) — snapshot.
    supabase
      .from("reservations")
      .select("total_price, paid_amount")
      .in("status", ["confirmed", "checked_in"]),
    // Cuentas corrientes (deuda) — snapshot; reutiliza el cálculo central.
    getCtaCteAccounts(),
    // Alertas operativas sin resolver.
    supabase
      .from("admin_alerts")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null),
  ]);

  if (overlapRes.error) throw overlapRes.error;

  const activeRooms = (roomsRes.data ?? []).length;

  const roomTypeOf = (
    rel: { room_type: string } | { room_type: string }[] | null | undefined
  ): string => (Array.isArray(rel) ? rel[0]?.room_type ?? "—" : rel?.room_type ?? "—");

  type OverlapRow = {
    status: ReservationStatus;
    check_in_target: string;
    check_out_target: string;
    actual_check_in: string | null;
    actual_check_out: string | null;
    base_total_price: number | string | null;
    discount_amount: number | string | null;
    created_at: string;
    room_id: number | string | null;
    rooms: { room_type: string } | { room_type: string }[] | null;
  };

  const overlap: NightlyReservation[] = ((overlapRes.data ?? []) as OverlapRow[]).map((r) => ({
    status: r.status,
    checkInTarget: r.check_in_target,
    checkOutTarget: r.check_out_target,
    actualCheckIn: r.actual_check_in,
    actualCheckOut: r.actual_check_out,
    baseTotalPrice: Number(r.base_total_price) || 0,
    discountAmount: Number(r.discount_amount) || 0,
    roomId: Number(r.room_id) || 0,
    roomType: roomTypeOf(r.rooms),
    createdAt: r.created_at,
  }));

  const created: CreatedReservation[] = (
    (createdRes.data ?? []) as { status: ReservationStatus; created_at: string }[]
  ).map((r) => ({ status: r.status, createdAt: r.created_at }));

  const payments: PaymentPoint[] = (
    (paymentsRes.data ?? []) as { amount: number | string; payment_method: string; created_at: string }[]
  ).map((p) => ({ amount: Number(p.amount) || 0, method: p.payment_method, createdAt: p.created_at }));

  // ── KPIs con comparación período vs. período (mismos datos, dos sub-rangos) ──
  const kpiArgs = { reservationsOverlap: overlap, reservationsCreated: created, payments, activeRooms, tz };
  const cur = computeWindowKpis({ ...kpiArgs, rangeStartKey: startKey, rangeEndKey: endKey });
  const prvKpis = computeWindowKpis({ ...kpiArgs, rangeStartKey: prev.start, rangeEndKey: prev.end });
  const delta = (a: number, b: number): KpiWithDelta => ({ current: a, previous: b, deltaPct: pctDelta(a, b) });

  const kpis: DashboardKpis = {
    lodgingRevenue: delta(cur.lodgingRevenue, prvKpis.lodgingRevenue),
    totalPaymentsIncome: delta(cur.totalPaymentsIncome, prvKpis.totalPaymentsIncome),
    occupancyRate: delta(cur.occupancyRate, prvKpis.occupancyRate),
    adr: delta(cur.adr, prvKpis.adr),
    revpar: delta(cur.revpar, prvKpis.revpar),
    reservationsCreated: delta(cur.reservationsCreated, prvKpis.reservationsCreated),
    cancellationRate: delta(cur.cancellationRate, prvKpis.cancellationRate),
    avgLengthOfStay: delta(cur.avgLengthOfStay, prvKpis.avgLengthOfStay),
    avgLeadTimeDays: delta(cur.avgLeadTimeDays, prvKpis.avgLeadTimeDays),
  };

  // ── Series y breakdowns (solo período actual) ──
  const dailyOccupancy = buildOccupancyHistogram(overlap, startKey, endKey, activeRooms, tz);

  const currentPayments = payments.filter((p) => {
    const k = hotelDateKey(p.createdAt, tz);
    return k >= startKey && k <= endKey;
  });
  const dailyCash = buildDailyTotals(
    currentPayments.map((p) => ({ iso: p.createdAt, value: p.amount })),
    startKey,
    endKey,
    tz
  );

  const revenueByRoomType = buildRevenueByRoomType(overlap, startKey, endKey, tz);

  const methodMap = new Map<string, number>();
  for (const p of currentPayments) methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + p.amount);
  const paymentMethods = Array.from(methodMap.entries())
    .map(([method, total]) => ({ method, total: round2(total) }))
    .sort((a, b) => b.total - a.total);

  const extraMap = new Map<string, number>();
  for (const e of (extrasRes.data ?? []) as { charge_type: string; amount: number | string }[]) {
    extraMap.set(e.charge_type, (extraMap.get(e.charge_type) ?? 0) + (Number(e.amount) || 0));
  }
  const extraChargesByType = Array.from(extraMap.entries())
    .map(([charge_type, total]) => ({ charge_type, total: round2(total) }))
    .sort((a, b) => b.total - a.total);

  // ── Cobranzas (snapshot) ──
  const accountsReceivable = round2(
    ((receivableRes.data ?? []) as { total_price: number | string; paid_amount: number | string }[]).reduce(
      (sum, r) => {
        const bal = (Number(r.total_price) || 0) - (Number(r.paid_amount) || 0);
        return sum + (bal > 0 ? bal : 0);
      },
      0
    )
  );
  const debtors = (ccAccounts as CtaCteAccount[]).filter((a) => a.balance > 0);
  const currentAccountDebt = round2(debtors.reduce((sum, a) => sum + a.balance, 0));
  const topDebtors = debtors.slice(0, 5).map((a) => ({ name: a.name, balance: a.balance }));

  // ── Control de caja y operación del período ──
  const cashDiscrepancyTotal = round2(
    ((shiftsRes.data ?? []) as { discrepancy: number | string | null }[]).reduce(
      (sum, s) => sum + Math.abs(Number(s.discrepancy) || 0),
      0
    )
  );

  const cleaningMap = new Map<string, number>();
  for (const c of (cleaningRes.data ?? []) as { cleaning_category: string | null }[]) {
    const cat = c.cleaning_category ?? "otros";
    cleaningMap.set(cat, (cleaningMap.get(cat) ?? 0) + 1);
  }
  const cleaningsByCategory = Array.from(cleaningMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    range: { from: startKey, to: endKey, days: countDaysInclusive(startKey, endKey) },
    previousRange: { from: prev.start, to: prev.end },
    currency,
    activeRooms,
    kpis,
    dailyOccupancy,
    dailyCash,
    revenueByRoomType,
    paymentMethods,
    extraChargesByType,
    accountsReceivable,
    currentAccountDebt,
    topDebtors,
    cashDiscrepancyTotal,
    cleaningsByCategory,
    openAlerts: alertsRes.count ?? 0,
  };
}

export type RoomBreakdownData = {
  range: { from: string; to: string; days: number };
  currency: string;
  activeRooms: number;
  rooms: RoomBreakdownRow[];
  totals: RoomBreakdownTotals;
};

/**
 * Métricas por habitación para el rango [startKey, endKey] (claves "YYYY-MM-DD" en zona
 * del hotel). Alimenta el tablero "Por habitación". La agregación vive en las funciones
 * puras de ./analytics (buildRoomBreakdown / summarizeRoomBreakdown); acá solo se traen
 * las filas del período actual. Ventana y bucketing en zona del hotel (no UTC).
 */
export async function getRoomBreakdownData(
  startKey: string,
  endKey: string
): Promise<RoomBreakdownData> {
  const supabase = await createClient();
  const settings = await getHotelSettings();
  const tz = settings.timezone || "America/Argentina/Tucuman";
  const currency = settings.currency || "ARS";

  const win = hotelRangeToUtc(startKey, endKey, tz);

  const [roomsRes, overlapRes, createdRes, cleaningRes] = await Promise.all([
    supabase.from("rooms").select("id, room_number, room_type").eq("is_active", true),
    // Estadías comprometidas que solapan el período.
    supabase
      .from("reservations")
      .select(
        "status, check_in_target, check_out_target, actual_check_in, actual_check_out, base_total_price, discount_amount, created_at, room_id"
      )
      .in("status", ["confirmed", "checked_in", "checked_out"])
      .lt("check_in_target", win.endUtcExclusive)
      .gte("check_out_target", win.startUtc),
    // Reservas creadas en el período (para cancelaciones por habitación).
    supabase
      .from("reservations")
      .select("room_id, status, created_at")
      .gte("created_at", win.startUtc)
      .lt("created_at", win.endUtcExclusive),
    // Limpiezas del período por habitación.
    supabase
      .from("room_cleaning_log")
      .select("room_id, cleaned_at")
      .gte("cleaned_at", win.startUtc)
      .lt("cleaned_at", win.endUtcExclusive),
  ]);

  if (roomsRes.error) throw roomsRes.error;
  if (overlapRes.error) throw overlapRes.error;

  const rooms: RoomInfo[] = (
    (roomsRes.data ?? []) as { id: number; room_number: string; room_type: string | null }[]
  ).map((r) => ({ id: r.id, roomNumber: r.room_number, roomType: r.room_type ?? "—" }));
  const roomTypeById = new Map(rooms.map((r) => [r.id, r.roomType]));

  type RoomOverlapRow = {
    status: ReservationStatus;
    check_in_target: string;
    check_out_target: string;
    actual_check_in: string | null;
    actual_check_out: string | null;
    base_total_price: number | string | null;
    discount_amount: number | string | null;
    created_at: string;
    room_id: number | string | null;
  };

  const reservationsOverlap: NightlyReservation[] = (
    (overlapRes.data ?? []) as RoomOverlapRow[]
  ).map((r) => {
    const roomId = Number(r.room_id) || 0;
    return {
      status: r.status,
      checkInTarget: r.check_in_target,
      checkOutTarget: r.check_out_target,
      actualCheckIn: r.actual_check_in,
      actualCheckOut: r.actual_check_out,
      baseTotalPrice: Number(r.base_total_price) || 0,
      discountAmount: Number(r.discount_amount) || 0,
      roomId,
      roomType: roomTypeById.get(roomId) ?? "—",
      createdAt: r.created_at,
    };
  });

  const createdWithRoom: CreatedRoomReservation[] = (
    (createdRes.data ?? []) as { room_id: number | string | null; status: ReservationStatus; created_at: string }[]
  ).map((r) => ({ roomId: Number(r.room_id) || 0, status: r.status, createdAt: r.created_at }));

  const cleanings: RoomCleaning[] = (
    (cleaningRes.data ?? []) as { room_id: number | string | null; cleaned_at: string }[]
  ).map((c) => ({ roomId: Number(c.room_id) || 0, cleanedAt: c.cleaned_at }));

  const roomRows = buildRoomBreakdown({
    rooms,
    reservationsOverlap,
    createdWithRoom,
    cleanings,
    rangeStartKey: startKey,
    rangeEndKey: endKey,
    tz,
  });

  return {
    range: { from: startKey, to: endKey, days: countDaysInclusive(startKey, endKey) },
    currency,
    activeRooms: rooms.length,
    rooms: roomRows,
    totals: summarizeRoomBreakdown(roomRows),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Caja (cash shifts)
// ═══════════════════════════════════════════════════════════════════════════

type CashShiftRow = {
  id: string;
  shift_number: number | string;
  opened_at: string;
  closed_at: string | null;
  opened_by: string;
  closed_by: string | null;
  opening_cash: number | string;
  expected_cash: number | string | null;
  actual_cash: number | string | null;
  discrepancy: number | string | null;
  notes: string | null;
  status: CashShiftStatus;
};

function toCashShift(row: CashShiftRow): CashShift {
  return {
    id: row.id,
    shift_number: Number(row.shift_number) || 0,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    opened_by: row.opened_by,
    closed_by: row.closed_by,
    opening_cash: Number(row.opening_cash) || 0,
    expected_cash: row.expected_cash === null ? null : Number(row.expected_cash) || 0,
    actual_cash: row.actual_cash === null ? null : Number(row.actual_cash) || 0,
    discrepancy: row.discrepancy === null ? null : Number(row.discrepancy) || 0,
    notes: row.notes,
    status: row.status,
  };
}

/**
 * La caja abierta del hotel. Hay una sola a la vez (indice unico
 * cash_shifts_one_open_hotel), asi que recepcion y admin ven la misma: la que
 * este abierta, sin importar quien la abrio. El RLS permite a cualquier staff
 * leer la caja con status = 'open'.
 */
export async function getActiveOpenShift(): Promise<CashShift | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_shifts")
    .select("*")
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return toCashShift(data as CashShiftRow);
}

type PaymentWithReservationRow = {
  id: string;
  amount: number | string;
  payment_method: PaymentMethod;
  notes: string | null;
  created_at: string;
  reservation_id: string;
  reservations:
    | { client_name: string; rooms: { room_number: string } | { room_number: string }[] | null }
    | { client_name: string; rooms: { room_number: string } | { room_number: string }[] | null }[]
    | null;
};

function normalizeShiftPayment(row: PaymentWithReservationRow): ShiftPaymentRow {
  const reservation = Array.isArray(row.reservations)
    ? row.reservations[0]
    : row.reservations;
  const rooms = reservation?.rooms;
  const room = Array.isArray(rooms) ? rooms[0] : rooms;
  return {
    id: row.id,
    amount: Number(row.amount) || 0,
    payment_method: row.payment_method,
    notes: row.notes,
    created_at: row.created_at,
    reservation_id: row.reservation_id,
    client_name: reservation?.client_name ?? "Desconocido",
    room_number: room?.room_number ?? null,
  };
}

async function getAuthUserEmail(userId: string): Promise<string | null> {
  // Para mostrar quien abrio/cerro el turno. profiles tiene full_name pero no email,
  // y auth.users no es accesible por defecto. Usamos la RPC via SQL si existe, si no, null.
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return (data as { full_name?: string } | null)?.full_name ?? null;
}

export async function getShiftSummary(shiftId: string): Promise<ShiftSummary | null> {
  const supabase = await createClient();

  const { data: shiftData, error: shiftError } = await supabase
    .from("cash_shifts")
    .select("*")
    .eq("id", shiftId)
    .maybeSingle();

  if (shiftError) throw shiftError;
  if (!shiftData) return null;

  const shift = toCashShift(shiftData as CashShiftRow);

  const { data: paymentsData, error: paymentsError } = await supabase
    .from("payments")
    .select(
      `
      id, amount, payment_method, notes, created_at, reservation_id,
      reservations ( client_name, rooms ( room_number ) )
      `
    )
    .eq("cash_shift_id", shiftId)
    .order("created_at", { ascending: false });

  if (paymentsError) throw paymentsError;

  const payments = ((paymentsData ?? []) as PaymentWithReservationRow[]).map(
    normalizeShiftPayment
  );

  // Piezas rendidas: check-outs cuya reserva quedo ligada a este turno.
  const { count: checkoutsCount, error: checkoutsError } = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("checkout_cash_shift_id", shiftId)
    .eq("status", "checked_out");

  if (checkoutsError) throw checkoutsError;

  const totalsByMethod: Record<PaymentMethod, number> = {
    cash: 0,
    credit_card: 0,
    debit_card: 0,
    bank_transfer: 0,
    mercado_pago: 0,
    vale_blanco: 0,
    cuenta_corriente: 0,
    other: 0,
  };

  for (const p of payments) {
    totalsByMethod[p.payment_method] =
      (totalsByMethod[p.payment_method] ?? 0) + p.amount;
  }

  const totalIncome = payments.reduce((sum, p) => sum + p.amount, 0);
  const cashIncome = totalsByMethod.cash;

  const [openedByEmail, closedByEmail] = await Promise.all([
    getAuthUserEmail(shift.opened_by),
    shift.closed_by ? getAuthUserEmail(shift.closed_by) : Promise.resolve(null),
  ]);

  return {
    shift,
    paymentsCount: payments.length,
    checkoutsCount: checkoutsCount ?? 0,
    totalsByMethod,
    totalIncome,
    cashIncome,
    payments,
    openedByEmail,
    closedByEmail,
  };
}

type ListShiftsFilters = {
  from?: string;
  to?: string;
  userId?: string;
  status?: CashShiftStatus;
  limit?: number;
};

/**
 * Lista de turnos con el nombre del recepcionista que abrió/cerró.
 * Si el usuario actual es `receptionist`, filtra a sus propios turnos.
 * Si es `admin`, devuelve todos. (También hay RLS policy por dueño.)
 *
 * Usamos una query aparte a profiles porque cash_shifts.opened_by referencia
 * auth.users, no profiles, y PostgREST no puede embeber sin FK directo.
 */
export async function listShifts(filters: ListShiftsFilters = {}): Promise<CashShift[]> {
  const supabase = await createClient();
  const role = await getCurrentUserRole();

  let query = supabase
    .from("cash_shifts")
    .select("*")
    .order("opened_at", { ascending: false });

  if (role !== "admin") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Caja unica por hotel: recepcion ve las que abrio o cerro (puede cerrar una
    // que abrio otro companero).
    if (user) query = query.or(`opened_by.eq.${user.id},closed_by.eq.${user.id}`);
  }

  if (filters.from) query = query.gte("opened_at", filters.from);
  if (filters.to) query = query.lte("opened_at", filters.to);
  if (filters.userId) query = query.eq("opened_by", filters.userId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw error;

  const shifts = ((data ?? []) as CashShiftRow[]).map(toCashShift);
  if (shifts.length === 0) return shifts;

  const userIds = new Set<string>();
  for (const s of shifts) {
    userIds.add(s.opened_by);
    if (s.closed_by) userIds.add(s.closed_by);
  }

  const { data: profilesData } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", Array.from(userIds));

  const nameById = new Map<string, string | null>();
  for (const p of (profilesData ?? []) as { id: string; full_name: string | null }[]) {
    nameById.set(p.id, p.full_name);
  }

  return shifts.map((s) => ({
    ...s,
    opened_by_name: nameById.get(s.opened_by) ?? null,
    closed_by_name: s.closed_by ? nameById.get(s.closed_by) ?? null : null,
  }));
}

export async function openCashShift(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_open_cash_shift");
  if (error) throw error;
  return data as string;
}

export async function closeCashShift(
  shiftId: string,
  actualCash: number,
  notes?: string
): Promise<{ expected_cash: number; actual_cash: number; discrepancy: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_close_cash_shift", {
    p_shift_id: shiftId,
    p_actual_cash: actualCash,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  const result = data as {
    shift_id: string;
    opening_cash: number | string;
    cash_income: number | string;
    expected_cash: number | string;
    actual_cash: number | string;
    discrepancy: number | string;
  };
  return {
    expected_cash: Number(result.expected_cash) || 0,
    actual_cash: Number(result.actual_cash) || 0,
    discrepancy: Number(result.discrepancy) || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mantenimiento de habitaciones
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lista habitaciones que requieren limpieza o están en mantenimiento,
 * más datos de la última reserva si aplica (para que el rol maintenance
 * sepa qué huésped dejó la habitación y cuándo).
 */
export async function getRoomsNeedingCleaning(): Promise<
  Array<
    Room & {
      last_checkout_client: string | null;
      last_checkout_at: string | null;
    }
  >
> {
  const supabase = await createClient();

  const { data: rooms, error } = await supabase
    .from("rooms")
    .select("*")
    .in("status", ["cleaning", "maintenance"])
    .eq("is_active", true)
    .order("room_number");

  if (error) throw error;

  const list = sortRoomsByNumber((rooms ?? []) as Room[]);
  if (list.length === 0) return [];

  const roomIds = list.map((r) => r.id);
  // Buscamos la última reserva checked_out por habitación (aunque hay que
  // tomar la más reciente por actual_check_out).
  const { data: lastReservations } = await supabase
    .from("reservations")
    .select("room_id, client_name, actual_check_out")
    .in("room_id", roomIds)
    .eq("status", "checked_out")
    .order("actual_check_out", { ascending: false });

  const lastByRoom = new Map<
    number,
    { client: string; checkout: string | null }
  >();
  for (const r of (lastReservations ?? []) as {
    room_id: number;
    client_name: string;
    actual_check_out: string | null;
  }[]) {
    if (!lastByRoom.has(r.room_id)) {
      lastByRoom.set(r.room_id, {
        client: r.client_name,
        checkout: r.actual_check_out,
      });
    }
  }

  return list.map((r) => {
    const last = lastByRoom.get(r.id);
    return {
      ...r,
      last_checkout_client: last?.client ?? null,
      last_checkout_at: last?.checkout ?? null,
    };
  });
}

export async function markRoomClean(
  roomId: number,
  notes?: string,
  cleaningType?: CleaningType
): Promise<{ alertGenerated: boolean }> {
  const supabase = await createClient();
  const params: {
    p_room_id: number;
    p_notes: string | null;
    p_cleaning_type?: CleaningType;
  } = {
    p_room_id: roomId,
    p_notes: notes ?? null,
  };
  if (cleaningType) params.p_cleaning_type = cleaningType;

  const { data, error } = await supabase.rpc("rpc_mark_room_clean", params);
  if (error) throw error;
  const result = (data ?? {}) as { alert_generated?: boolean };
  return { alertGenerated: Boolean(result.alert_generated) };
}

/**
 * Registra que una habitación ocupada no se pudo limpiar hoy porque el huésped no dejó
 * la llave. Queda "resuelta por hoy" (sale de pendientes) y el admin ve el motivo.
 */
export async function markRoomNoKey(
  roomId: number,
  notes?: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_mark_room_no_key", {
    p_room_id: roomId,
    p_notes: notes ?? null,
  });
  if (error) throw error;
}

/**
 * Histórico de limpiezas paginado + filtrable por rango de fechas, con el resumen por
 * categoría del rango (correcto aunque haya muchas filas, vía count exact).
 */
export async function getCleaningLog(
  params: {
    fromIso?: string;
    toIso?: string;
    roomId?: number;
    category?: CleaningCategory | "no_key";
    page?: number;
    pageSize?: number;
  } = {}
): Promise<CleaningLogResult> {
  const supabase = await createClient();
  const { fromIso, toIso, roomId, category } = params;
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(params.pageSize ?? 25)));
  const offset = (page - 1) * pageSize;

  let rowsQuery = supabase
    .from("room_cleaning_log")
    .select(
      `
      id,
      room_id,
      cleaned_at,
      cleaned_by,
      cleaner_name,
      previous_status,
      cleaning_type,
      cleaning_category,
      outcome,
      notes,
      rooms ( room_number )
      `,
      { count: "exact" }
    )
    .order("cleaned_at", { ascending: false });
  if (fromIso) rowsQuery = rowsQuery.gte("cleaned_at", fromIso);
  if (toIso) rowsQuery = rowsQuery.lt("cleaned_at", toIso);
  if (roomId) rowsQuery = rowsQuery.eq("room_id", roomId);
  if (category === "no_key") {
    rowsQuery = rowsQuery.eq("outcome", "not_cleaned_no_key");
  } else if (category === "checkin_daily") {
    // "Con check-in" = limpiadas (las "sin llave" viven bajo su propio filtro).
    rowsQuery = rowsQuery.eq("cleaning_category", "checkin_daily").eq("outcome", "cleaned");
  } else if (category) {
    rowsQuery = rowsQuery.eq("cleaning_category", category);
  }
  rowsQuery = rowsQuery.range(offset, offset + pageSize - 1);

  const { data, count, error } = await rowsQuery;
  if (error) throw error;

  const rowsRaw = (data ?? []) as Array<{
    id: number;
    room_id: number;
    cleaned_at: string;
    cleaned_by: string;
    cleaner_name: string | null;
    previous_status: string;
    cleaning_type: CleaningType | null;
    cleaning_category: CleaningCategory | null;
    outcome: CleaningOutcome | null;
    notes: string | null;
    rooms: { room_number: string } | { room_number: string }[] | null;
  }>;

  // Resumen por categoría del rango (independiente de la paginación).
  const countWith = async (filters: {
    category?: CleaningCategory;
    outcome?: CleaningOutcome;
  }): Promise<number> => {
    let q = supabase
      .from("room_cleaning_log")
      .select("id", { count: "exact", head: true });
    if (fromIso) q = q.gte("cleaned_at", fromIso);
    if (toIso) q = q.lt("cleaned_at", toIso);
    if (roomId) q = q.eq("room_id", roomId);
    if (filters.category) q = q.eq("cleaning_category", filters.category);
    if (filters.outcome) q = q.eq("outcome", filters.outcome);
    const { count: n } = await q;
    return n ?? 0;
  };

  const [checkin_daily, checkout, empty_maintenance, occupied_anomaly, no_key] =
    await Promise.all([
      countWith({ category: "checkin_daily", outcome: "cleaned" }),
      countWith({ category: "checkout" }),
      countWith({ category: "empty_maintenance" }),
      countWith({ category: "occupied_anomaly" }),
      countWith({ outcome: "not_cleaned_no_key" }),
    ]);

  // Alertas asociadas, solo para las filas de la página actual.
  const alertLogIds = new Set<number>();
  const logIds = rowsRaw.map((r) => r.id);
  if (logIds.length > 0) {
    const { data: alertsData } = await supabase
      .from("admin_alerts")
      .select("related_cleaning_log_id")
      .in("related_cleaning_log_id", logIds);

    for (const alert of (alertsData ?? []) as Array<{ related_cleaning_log_id: number | null }>) {
      if (alert.related_cleaning_log_id !== null) {
        alertLogIds.add(Number(alert.related_cleaning_log_id));
      }
    }
  }

  const rows = rowsRaw.map((r) => {
    const rel = r.rooms;
    const room_number = Array.isArray(rel)
      ? rel[0]?.room_number ?? "—"
      : rel?.room_number ?? "—";
    return {
      id: r.id,
      room_id: r.room_id,
      room_number,
      cleaned_at: r.cleaned_at,
      cleaned_by: r.cleaned_by,
      cleaner_name: r.cleaner_name,
      previous_status: r.previous_status,
      cleaning_type: r.cleaning_type,
      cleaning_category: r.cleaning_category,
      outcome: r.outcome ?? "cleaned",
      notes: r.notes,
      has_admin_alert: alertLogIds.has(r.id),
    };
  });

  return {
    rows,
    total: count ?? 0,
    page,
    pageSize,
    summary: { checkin_daily, checkout, empty_maintenance, occupied_anomaly, no_key },
  };
}

/**
 * Última limpieza de HOY (zona del hotel) por habitación. Sirve para mostrar "Limpiada hoy"
 * en el tablero de mantenimiento y para el límite de una limpieza por día en las vacías.
 */
export async function getTodayCleanings(): Promise<Record<number, TodayCleaning>> {
  const supabase = await createClient();
  const settings = await getHotelSettings().catch(() => null);
  const tz = settings?.timezone || "America/Argentina/Tucuman";
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const dayStartISO = localToISO(todayKey, "00:00", tz);

  const { data, error } = await supabase
    .from("room_cleaning_log")
    .select("room_id, cleaned_at, cleaning_category, outcome")
    .gte("cleaned_at", dayStartISO)
    .order("cleaned_at", { ascending: false });
  if (error) throw error;

  const map: Record<number, TodayCleaning> = {};
  for (const row of (data ?? []) as Array<{
    room_id: number;
    cleaned_at: string;
    cleaning_category: CleaningCategory | null;
    outcome: CleaningOutcome | null;
  }>) {
    // Filas ordenadas desc: la primera de cada habitación es la más reciente de hoy.
    if (!(row.room_id in map)) {
      map[row.room_id] = {
        at: row.cleaned_at,
        category: row.cleaning_category,
        outcome: row.outcome ?? "cleaned",
      };
    }
  }
  return map;
}

/** Lista breve de habitaciones activas (id + número) para filtros/dropdowns. */
export async function getActiveRoomsBrief(): Promise<{ id: number; room_number: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("id, room_number")
    .eq("is_active", true);
  if (error) throw error;
  return sortRoomsByNumber((data ?? []) as { id: number; room_number: string }[]);
}

/**
 * Todas las habitaciones activas, con info de si requieren limpieza o no.
 * Para el dashboard de maintenance que ahora muestra todas (verde = OK,
 * rojo = necesita limpieza) y les permite limpiar cualquiera.
 */
export async function getAllActiveRoomsForMaintenance(): Promise<
  MaintenanceRoom[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_list_maintenance_rooms");
  if (!error) {
    return sortRoomsByNumber((data ?? []) as MaintenanceRoom[]) as MaintenanceRoom[];
  }

  console.error("[Maintenance] rpc_list_maintenance_rooms failed:", {
    code: error.code,
    message: error.message,
  });

  const { data: fallbackRooms, error: fallbackError } = await supabase
    .from("rooms")
    .select("*")
    .eq("is_active", true)
    .order("room_number");

  if (fallbackError) throw fallbackError;

  return sortRoomsByNumber((fallbackRooms ?? []) as Room[]).map((room) => ({
    ...room,
    requires_cleaning: room.status === "cleaning" || room.status === "maintenance",
    cleaning_required_reason:
      room.status === "cleaning"
        ? "status_cleaning"
        : room.status === "maintenance"
          ? "status_maintenance"
          : null,
    cleaned_today: false,
    daily_outcome: null,
    daily_notes: null,
    active_client: null,
    active_check_out_target: null,
    active_late_check_out_until: null,
    last_checkout_client: null,
    last_checkout_at: null,
  })) as MaintenanceRoom[];
}

/**
 * Filas para el export CSV fiscal: un check-out por fila, con la forma de pago usada al
 * cerrar el check-out (o el medio del último pago real si la reserva llegó prepaga).
 */
export async function getShiftCheckoutExport(
  shiftId: string
): Promise<CheckoutExportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_shift_checkout_export", {
    p_shift_id: shiftId,
  });
  if (error) throw error;
  return ((data ?? []) as Array<{
    actual_check_out: string;
    client_name: string;
    client_dni: string | null;
    total_price: number | string;
    payment_method: string;
  }>).map((r) => ({
    actual_check_out: r.actual_check_out,
    client_name: r.client_name,
    client_dni: r.client_dni,
    total_price: Number(r.total_price) || 0,
    payment_method: r.payment_method as CheckoutExportRow["payment_method"],
  }));
}

export async function listAdminAlerts(onlyUnresolved = true): Promise<AdminAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_list_admin_alerts", {
    p_only_unresolved: onlyUnresolved,
  });
  if (error) throw error;
  return (data ?? []) as AdminAlert[];
}

export async function resolveAdminAlert(alertId: number, notes?: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_resolve_admin_alert", {
    p_alert_id: alertId,
    p_notes: notes ?? null,
  });
  if (error) throw error;
}

export async function authorizeOldTariff(alertId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_authorize_old_tariff", {
    p_alert_id: alertId,
  });
  if (error) throw error;
}

export async function rejectOldTariff(alertId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_reject_old_tariff", {
    p_alert_id: alertId,
  });
  if (error) throw error;
}

export async function getUnresolvedAdminAlertsCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_list_admin_alerts", {
    p_only_unresolved: true,
  });
  if (error) return 0;
  return (data ?? []).length;
}

export async function getPendingSolicitudesCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) return 0;
  return count ?? 0;
}
