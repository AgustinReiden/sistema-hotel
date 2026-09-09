import "server-only";

import { createClient } from "./supabase/server";
import { isValidCuit } from "./arca/amounts";
import { getRoomCapacity, sortRoomsByNumber } from "./rooms";
import { localToISO } from "./format";
import { addDaysToDateKey, DEFAULT_TZ, hotelDateKey } from "./time";
import {
  buildDailyTotals,
  buildGuestNightsSeries,
  buildOccupancyHistogram,
  buildRevenueByRoomType,
  buildRoomBreakdown,
  buildSalesSettlement,
  buildWeekdaySeasonality,
  computeWindowKpis,
  sumAccountMovements,
  countDaysInclusive,
  hotelRangeToUtc,
  pctDelta,
  previousPeriodRange,
  summarizeRoomBreakdown,
  type AccountFlow,
  type AccountMovementPoint,
  type ClosedStay,
  type CreatedReservation,
  type CreatedRoomReservation,
  type DailyOccupancy,
  type DailyTotal,
  type SalesSettlement,
  type NightlyReservation,
  type PaymentPoint,
  type RoomBreakdownRow,
  type RoomBreakdownTotals,
  type RoomCleaning,
  type RoomInfo,
  type WeekdayStat,
} from "./analytics";
import type {
  CheckInPayload,
  AdminAlert,
  AssignWalkInPayload,
  AssociatedClient,
  AssociatedClientLedger,
  CashShift,
  CashShiftStatus,
  CheckoutExportRow,
  CleaningCategory,
  CloseShiftBlockersResult,
  CleaningOutcome,
  CleaningType,
  CompanyPassenger,
  CreateReservationPayload,
  CtaCteAccount,
  CtaCteClientKind,
  CtaCteMovimiento,
  DiscountedClient,
  FiscalSettings,
  AuthorizedInvoiceRow,
  BillingControlRow,
  BillingPendingCounts,
  CcAccountStayRow,
  ConsolidatedInvoicePayload,
  FacturacionModo,
  InvoiceKind,
  InvoiceRecord,
  InvoiceReceptorInput,
  InvoiceReceptorPrefill,
  InvoiceStayRow,
  InvoiceableCheckoutRow,
  PendingInvoiceRow,
  ReceptorLookup,
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
    associated_client_id: string | null;
    /** En una reserva de empresa, null = el pasajero todavia no se cargo (mig 88). */
    company_passenger_id: string | null;
    client_dni: string | null;
  }[];
  /** reservationId -> el cliente facturable tiene cuenta corriente habilitada. */
  accountCreditByReservation: Record<string, boolean>;
  /** reservationId -> cuándo se le factura al cliente facturable (mig 79). */
  facturacionModoByReservation: Record<string, FacturacionModo>;
  /** reservationId -> datos de facturación de la ficha, para precargar (mig 81). */
  invoicePrefillByReservation: Record<string, InvoiceReceptorPrefill>;
  /** reservationId -> métodos de sus pagos ya registrados (mig 83). */
  priorPaymentMethodsByReservation: Record<string, PaymentMethod[]>;
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
  condicion_iva?: string | null;
  razon_social?: string | null;
  domicilio?: string | null;
  facturacion_modo?: string | null;
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
    condicion_iva: (row.condicion_iva as AssociatedClient["condicion_iva"] | undefined) ?? null,
    razon_social: row.razon_social ?? null,
    domicilio: row.domicilio ?? null,
    facturacion_modo: (row.facturacion_modo as FacturacionModo | undefined) ?? "por_checkout",
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
      // Solo habitaciones activas: las desactivadas se ocultan de la grilla de recepcion.
      supabase.from("rooms").select("*").eq("is_active", true).order("room_number"),
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
    company_passenger_id: string | null;
    client_dni: string | null;
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
    associated_client_id: r.associated_client_id ?? null,
    // Reserva de empresa con esto en null = el pasajero todavia no se cargo (mig 88).
    company_passenger_id: r.company_passenger_id ?? null,
    client_dni: r.client_dni ?? null,
  }));

  // Resolver, por reserva, el contexto de facturación del cliente (empresa o huésped).
  const {
    credit: accountCreditByReservation,
    modo: facturacionModoByReservation,
    prefill: invoicePrefillByReservation,
  } = await resolveBillingContextByReservation(supabase, rawReservations);

  // Métodos de los pagos YA registrados de cada reserva. Es la única fuente
  // confiable para saber si se cobró por medio bancario: en un check-out con saldo
  // cero (seña o pago adelantado) la pantalla no tiene ningún método a mano.
  const priorPaymentMethodsByReservation = await resolvePriorPaymentMethods(
    supabase,
    rawReservations.map((r) => r.id)
  );

  const todayIncome = incomeResult.error ? 0 : Number(incomeResult.data || 0);
  const hotelSettings = settingsResult.data as HotelSettings;

  return {
    rooms,
    reservations,
    accountCreditByReservation,
    facturacionModoByReservation,
    invoicePrefillByReservation,
    priorPaymentMethodsByReservation,
    todayIncome,
    hotelSettings,
  };
}

/**
 * reservationId -> métodos distintos de sus pagos ya registrados. Lo usa el
 * check-out para decidir si la facturación es obligatoria (medio bancario) y para
 * no ofrecer factura cuando la estadía se pagó con vale blanco.
 */
async function resolvePriorPaymentMethods(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reservationIds: string[]
): Promise<Record<string, PaymentMethod[]>> {
  const map: Record<string, PaymentMethod[]> = {};
  if (reservationIds.length === 0) return map;

  const { data, error } = await supabase
    .from("payments")
    .select("reservation_id, payment_method")
    .in("reservation_id", reservationIds);
  if (error) throw error;

  for (const row of (data ?? []) as { reservation_id: string; payment_method: PaymentMethod }[]) {
    const list = map[row.reservation_id] ?? (map[row.reservation_id] = []);
    if (!list.includes(row.payment_method)) list.push(row.payment_method);
  }
  return map;
}

type BillingClientRow = {
  id: string;
  cuenta_corriente_habilitada: boolean;
  facturacion_modo?: string | null;
  condicion_iva?: string | null;
  /** Empresa: el CUIT vive en document_id. Huésped: en `cuit` (document_id es el DNI). */
  document_id?: string | null;
  cuit?: string | null;
  display_name?: string | null;
  full_name?: string | null;
  razon_social?: string | null;
  domicilio?: string | null;
  domicilio_fiscal?: string | null;
};

const EMPTY_PREFILL: InvoiceReceptorPrefill = {
  razonSocial: "",
  cuit: "",
  condicionIva: "",
  domicilio: "",
  suggestA: false,
  complete: false,
};

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** Datos de facturación de una ficha, normalizados para el modal del check-out. */
function toInvoicePrefill(
  client: BillingClientRow | undefined,
  fallbackName: string | null
): InvoiceReceptorPrefill {
  if (!client) return { ...EMPTY_PREFILL, razonSocial: fallbackName ?? "" };

  // El CUIT sale de document_id (empresa) o de cuit (huésped) — nunca del
  // document_id del huésped, que es el DNI y no sirve como CUIT.
  const digits = (client.document_id ?? client.cuit ?? "").replace(/\D/g, "");
  const cuit = isValidCuit(digits) ? digits : "";
  const cond = client.condicion_iva;
  // La razón social (nombre legal) manda sobre el nombre operativo: dos áreas de la
  // misma empresa se llaman distinto en recepción pero facturan igual (mig 94).
  const razonSocial =
    nonEmpty(client.razon_social) ??
    nonEmpty(client.display_name) ??
    nonEmpty(client.full_name) ??
    fallbackName ??
    "";
  const condicionIva =
    cond === "responsable_inscripto" || cond === "monotributo" || cond === "exento" ? cond : "";
  const domicilio = client.domicilio ?? client.domicilio_fiscal ?? "";
  return {
    razonSocial,
    cuit,
    condicionIva,
    domicilio,
    suggestA: cuit !== "",
    // Los cuatro datos que exige emitir con CUIT. Con esto se saltea la pregunta
    // del tipo y se pasa directo a confirmar qué se emite (mig 83).
    complete: cuit !== "" && condicionIva !== "" && razonSocial !== "" && domicilio !== "",
  };
}

/**
 * Para un set de reservas, resuelve contra el cliente facturable
 * (associated_client_id ?? guest_id) tres cosas:
 *   · credit  → tiene cuenta corriente habilitada
 *   · modo    → cuándo se le emite factura fiscal (mig 79)
 *   · prefill → datos de facturación de la ficha (mig 81, punto 3)
 * Se resuelven juntas porque salen de las mismas dos consultas.
 */
async function resolveBillingContextByReservation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: {
    id: string;
    associated_client_id: string | null;
    guest_id: string | null;
    client_name?: string | null;
  }[]
): Promise<{
  credit: Record<string, boolean>;
  modo: Record<string, FacturacionModo>;
  prefill: Record<string, InvoiceReceptorPrefill>;
}> {
  const companyIds = [...new Set(rows.map((r) => r.associated_client_id).filter(Boolean))] as string[];
  const guestIds = [...new Set(rows.map((r) => r.guest_id).filter(Boolean))] as string[];

  const [companyRes, guestRes] = await Promise.all([
    companyIds.length
      ? supabase
          .from("associated_clients")
          .select(
            "id, cuenta_corriente_habilitada, facturacion_modo, condicion_iva, document_id, display_name, razon_social, domicilio"
          )
          .in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
    guestIds.length
      ? supabase
          .from("guests")
          .select(
            "id, cuenta_corriente_habilitada, facturacion_modo, condicion_iva, cuit, full_name, razon_social, domicilio_fiscal"
          )
          .in("id", guestIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const byCompany = new Map(((companyRes.data ?? []) as BillingClientRow[]).map((c) => [c.id, c]));
  const byGuest = new Map(((guestRes.data ?? []) as BillingClientRow[]).map((g) => [g.id, g]));

  const credit: Record<string, boolean> = {};
  const modo: Record<string, FacturacionModo> = {};
  const prefill: Record<string, InvoiceReceptorPrefill> = {};
  for (const r of rows) {
    const client = r.associated_client_id
      ? byCompany.get(r.associated_client_id)
      : r.guest_id
        ? byGuest.get(r.guest_id)
        : undefined;
    credit[r.id] = Boolean(client?.cuenta_corriente_habilitada);
    modo[r.id] = (client?.facturacion_modo as FacturacionModo | undefined) ?? "por_checkout";
    prefill[r.id] = toInvoicePrefill(client, r.client_name ?? null);
  }
  return { credit, modo, prefill };
}

export async function getTimelineData(days = 7, startKey?: string): Promise<TimelineData> {
  const supabase = await createClient();
  const settings = await getHotelSettings();
  const tz = settings.timezone || "America/Argentina/Tucuman";

  // La ventana visible se acota a un máximo de 14 días (evita rangos enormes por querystring).
  const span = Math.min(Math.max(Math.trunc(days), 1), 14);

  // "Hoy" en la zona del hotel (NO la del servidor, que en prod es UTC): así la primera
  // columna del calendario no se corre un día durante la franja nocturna de Argentina
  // (~21:00–23:59, cuando en UTC ya es el día siguiente).
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // Ancla de la primera columna: la fecha pedida (?start) si es válida, sino hoy.
  const anchorKey = startKey && /^\d{4}-\d{2}-\d{2}$/.test(startKey) ? startKey : todayKey;
  const today = new Date(localToISO(anchorKey, "00:00", tz));

  const end = new Date(today);
  end.setDate(end.getDate() + span);

  const [roomsResult, reservationsResult] = await Promise.all([
    // Solo habitaciones activas: las desactivadas se ocultan del calendario.
    supabase.from("rooms").select("*").eq("is_active", true).order("room_number"),
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
    daysCount: span,
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
  // Inicio del dia (zona del hotel, no la del servidor) de hace `days` dias: si se
  // calculara como "ahora menos N×24h", el corte se corre segun la hora del dia en
  // que se abre la pantalla en vez de caer siempre en un limite de dia prolijo.
  const sinceKey = addDaysToDateKey(hotelDateKey(new Date()), -days);
  const sinceIso = localToISO(sinceKey, "00:00", DEFAULT_TZ);

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
    // El .select() no es decorativo: un UPDATE bloqueado por RLS no devuelve error,
    // afecta 0 filas y sin esto la pantalla diria "guardado" sin haber guardado nada.
    const { data, error } = await supabase
      .from("guests")
      .update({
        discount_percent: input.discountPercent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error(
        "No se pudo guardar el descuento: no tenés permiso o el registro ya no existe."
      );
    }
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
  // Mismo motivo que en setGuestPersonalDiscount: 0 filas afectadas no es un error
  // para Postgres, pero para el usuario significa que el descuento no se guardo.
  const { data, error } = await supabase
    .from("associated_clients")
    .update({ discount_percent: discountPercent, updated_at: new Date().toISOString() })
    .eq("id", companyId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      "No se pudo guardar el descuento: no tenés permiso o el registro ya no existe."
    );
  }
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

/**
 * Check-in. En una reserva de EMPRESA el pasajero que se hospeda se carga recien aca
 * (mig 88): el RPC hace find-or-create en company_passengers y pisa los client_* de la
 * reserva, que hasta ese momento quedaban a nombre de la empresa. En una reserva de
 * persona el huesped ya vino del alta y no se manda nada.
 */
export async function doCheckIn({ reservationId, ...passenger }: CheckInPayload): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_staff_checkin_reservation", {
    p_reservation_id: reservationId,
    p_passenger_name: passenger.passengerName?.trim() || null,
    p_passenger_dni: passenger.passengerDni?.trim() || null,
    p_passenger_phone: passenger.passengerPhone?.trim() || null,
    p_company_passenger_id: passenger.companyPassengerId || null,
    p_guest_profession: passenger.guestProfession || null,
    p_guest_address: passenger.guestAddress || null,
    p_guest_locality: passenger.guestLocality || null,
    p_guest_nationality: passenger.guestNationality || null,
    p_guest_doc_type: passenger.guestDocType || null,
    p_guest_birth_date: passenger.guestBirthDate || null,
    p_guest_vehicle: passenger.guestVehicle || null,
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
    // El humano que se hospeda es el pasajero de la empresa. Va vacio en el alta normal:
    // la empresa reserva sin saber a quien manda y el pasajero se carga en el check-in
    // (mig 88). Sin pasajero, el RPC deja la reserva a nombre de la empresa.
    params.p_client_name = input.passengerName?.trim() || null;
    params.p_client_dni = input.passengerDni?.trim() || null;
    params.p_client_phone = input.passengerPhone?.trim() || null;
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

  // Escritura vía RPC SECURITY DEFINER (mig 76): reproduce la re-tarifa preservando la tarifa
  // congelada y los recargos, valida rol/estado y el solapamiento adentro. El UPDATE directo a
  // reservations se cerró en la mig 77 (auditoría H-01) para que un recepcionista no pueda
  // editar montos por PostgREST salteando estos guards.
  const { error } = await supabase.rpc("rpc_extend_reservation", {
    p_reservation_id: reservationId,
    p_extra_nights: extraNights,
  });

  if (error) throw error;
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
  // Vía RPC SECURITY DEFINER (mig 76): el UPDATE directo a reservations se cerró en la mig 77.
  const { error } = await supabase.rpc("rpc_set_whatsapp_notified", {
    p_reservation_id: reservationId,
    p_notified: notified,
  });

  if (error) throw error;
}

// ---- Tablero Gerencial (BI) ----

export type KpiWithDelta = { current: number; previous: number; deltaPct: number | null };

export type DashboardKpis = {
  /** Venta cerrada del período: total de las estadías con check-out en el rango. */
  closedSales: KpiWithDelta;
  /** De esa venta, lo que entró en plata (sin vale blanco). */
  closedCollectedMoney: KpiWithDelta;
  /** De esa venta, lo que se fió a cuenta corriente. */
  closedCredit: KpiWithDelta;
  lodgingRevenue: KpiWithDelta;
  totalPaymentsIncome: KpiWithDelta;
  totalPaymentsIncomeNoVale: KpiWithDelta;
  occupancyRate: KpiWithDelta;
  adr: KpiWithDelta;
  revpar: KpiWithDelta;
  guestNights: KpiWithDelta;
  avgGuestsPerNight: KpiWithDelta;
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
  dailyGuestNights: DailyTotal[];
  weekdaySeasonality: WeekdayStat[];
  // Breakdowns del período actual
  revenueByRoomType: { room_type: string; total: number }[];
  paymentMethods: { method: string; total: number }[];
  extraChargesByType: { charge_type: string; total: number }[];
  /**
   * Cierre de ventas del período: la única cuenta que da exacta
   * (venta = dinero + vale blanco + fiado + saldo). Ver buildSalesSettlement.
   */
  settlement: SalesSettlement;
  /** Movimientos de cuenta corriente del período: lo fiado y lo cobrado. */
  accountFlow: AccountFlow;
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
    closedRes,
    ccMovRes,
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
        "status, check_in_target, check_out_target, actual_check_in, actual_check_out, base_total_price, discount_amount, created_at, room_id, guest_count, rooms(room_type)"
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
    // Estadías CERRADAS (check-out real) en la ventana unión, con su liquidación:
    // pagos por método y cargos a cuenta corriente. Es la cohorte donde la venta ya
    // está terminada y cierra exacto contra cobrado + fiado + saldo.
    supabase
      .from("reservations")
      .select(
        "actual_check_out, total_price, base_total_price, discount_amount, paid_amount, payments(amount, payment_method), cuenta_corriente_movimientos(amount, tipo)"
      )
      .eq("status", "checked_out")
      .not("actual_check_out", "is", null)
      .gte("actual_check_out", unionWindow.startUtc)
      .lt("actual_check_out", unionWindow.endUtcExclusive),
    // Movimientos de cuenta corriente de la ventana unión: lo que se fió y lo que
    // las empresas pagaron a cuenta (plata real que no pasa por `payments`).
    supabase
      .from("cuenta_corriente_movimientos")
      .select("tipo, amount, created_at")
      .gte("created_at", unionWindow.startUtc)
      .lt("created_at", unionWindow.endUtcExclusive),
    // Recargos extra del período actual. Las reservas canceladas quedan fuera: sus
    // cargos nunca se vendieron y ensuciaban el gráfico de extras.
    supabase
      .from("extra_charges")
      .select("charge_type, amount, created_at, reservations!inner(status)")
      .neq("reservations.status", "cancelled")
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

  // Un error acá no puede quedar en silencio: mostraría $0 como si fuera un dato
  // real, que es exactamente lo que hacía desconfiar del tablero. Van TODAS las
  // respuestas, no solo las de plata: si falla `roomsRes`, `activeRooms` queda en 0
  // y la ocupación, el ADR y el RevPAR dan Infinity o NaN sin que nadie se entere.
  // `ccAccounts` no está en la lista porque no es una respuesta de Supabase:
  // getCtaCteAccounts() devuelve el array ya armado y tira sus propios errores.
  for (const res of [
    roomsRes,
    overlapRes,
    createdRes,
    paymentsRes,
    closedRes,
    ccMovRes,
    extrasRes,
    shiftsRes,
    cleaningRes,
    receivableRes,
    alertsRes,
  ]) {
    if (res.error) throw res.error;
  }

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
    guest_count: number | string | null;
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
    guestCount: Math.max(1, Number(r.guest_count) || 1),
  }));

  const created: CreatedReservation[] = (
    (createdRes.data ?? []) as { status: ReservationStatus; created_at: string }[]
  ).map((r) => ({ status: r.status, createdAt: r.created_at }));

  const payments: PaymentPoint[] = (
    (paymentsRes.data ?? []) as { amount: number | string; payment_method: string; created_at: string }[]
  ).map((p) => ({ amount: Number(p.amount) || 0, method: p.payment_method, createdAt: p.created_at }));

  type ClosedRow = {
    actual_check_out: string;
    total_price: number | string | null;
    base_total_price: number | string | null;
    discount_amount: number | string | null;
    paid_amount: number | string | null;
    payments: { amount: number | string; payment_method: string }[] | null;
    cuenta_corriente_movimientos: { amount: number | string; tipo: string }[] | null;
  };

  const closedStays: ClosedStay[] = ((closedRes.data ?? []) as unknown as ClosedRow[]).map((r) => {
    const pays = r.payments ?? [];
    const sumPays = (keep: (method: string) => boolean) =>
      pays.reduce((sum, p) => (keep(p.payment_method) ? sum + (Number(p.amount) || 0) : sum), 0);
    // Un pago con método `cuenta_corriente` es fiado mal cargado: suma como crédito,
    // nunca como plata cobrada (ver NON_CASH_METHODS en ./analytics).
    const credited =
      sumPays((m) => m === "cuenta_corriente") +
      (r.cuenta_corriente_movimientos ?? []).reduce(
        (sum, m) => (m.tipo === "cargo" ? sum + (Number(m.amount) || 0) : sum),
        0
      );
    return {
      actualCheckOut: r.actual_check_out,
      totalPrice: Number(r.total_price) || 0,
      baseTotalPrice: Number(r.base_total_price) || 0,
      discountAmount: Number(r.discount_amount) || 0,
      paidAmount: Number(r.paid_amount) || 0,
      paymentsMoney: sumPays((m) => m !== "vale_blanco" && m !== "cuenta_corriente"),
      paymentsVale: sumPays((m) => m === "vale_blanco"),
      creditCharged: credited,
    };
  });

  const ccMovements: AccountMovementPoint[] = (
    (ccMovRes.data ?? []) as { tipo: string; amount: number | string; created_at: string }[]
  ).map((m) => ({
    tipo: m.tipo === "pago" ? "pago" : "cargo",
    amount: Number(m.amount) || 0,
    createdAt: m.created_at,
  }));

  const settlement = buildSalesSettlement(closedStays, startKey, endKey, tz);
  const prevSettlement = buildSalesSettlement(closedStays, prev.start, prev.end, tz);
  const accountFlow = sumAccountMovements(ccMovements, startKey, endKey, tz);

  // ── KPIs con comparación período vs. período (mismos datos, dos sub-rangos) ──
  const kpiArgs = { reservationsOverlap: overlap, reservationsCreated: created, payments, activeRooms, tz };
  const cur = computeWindowKpis({ ...kpiArgs, rangeStartKey: startKey, rangeEndKey: endKey });
  const prvKpis = computeWindowKpis({ ...kpiArgs, rangeStartKey: prev.start, rangeEndKey: prev.end });
  const delta = (a: number, b: number): KpiWithDelta => ({ current: a, previous: b, deltaPct: pctDelta(a, b) });

  const kpis: DashboardKpis = {
    closedSales: delta(settlement.sales, prevSettlement.sales),
    closedCollectedMoney: delta(settlement.collectedMoney, prevSettlement.collectedMoney),
    closedCredit: delta(settlement.credit, prevSettlement.credit),
    lodgingRevenue: delta(cur.lodgingRevenue, prvKpis.lodgingRevenue),
    totalPaymentsIncome: delta(cur.totalPaymentsIncome, prvKpis.totalPaymentsIncome),
    totalPaymentsIncomeNoVale: delta(cur.totalPaymentsIncomeNoVale, prvKpis.totalPaymentsIncomeNoVale),
    occupancyRate: delta(cur.occupancyRate, prvKpis.occupancyRate),
    adr: delta(cur.adr, prvKpis.adr),
    revpar: delta(cur.revpar, prvKpis.revpar),
    guestNights: delta(cur.guestNights, prvKpis.guestNights),
    avgGuestsPerNight: delta(cur.avgGuestsPerNight, prvKpis.avgGuestsPerNight),
    reservationsCreated: delta(cur.reservationsCreated, prvKpis.reservationsCreated),
    cancellationRate: delta(cur.cancellationRate, prvKpis.cancellationRate),
    avgLengthOfStay: delta(cur.avgLengthOfStay, prvKpis.avgLengthOfStay),
    avgLeadTimeDays: delta(cur.avgLeadTimeDays, prvKpis.avgLeadTimeDays),
  };

  // ── Series y breakdowns (solo período actual) ──
  const dailyOccupancy = buildOccupancyHistogram(overlap, startKey, endKey, activeRooms, tz);
  const dailyGuestNights = buildGuestNightsSeries(overlap, startKey, endKey, tz);

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

  const weekdaySeasonality = buildWeekdaySeasonality(dailyOccupancy, dailyCash);

  return {
    range: { from: startKey, to: endKey, days: countDaysInclusive(startKey, endKey) },
    previousRange: { from: prev.start, to: prev.end },
    currency,
    activeRooms,
    kpis,
    dailyOccupancy,
    dailyCash,
    dailyGuestNights,
    weekdaySeasonality,
    revenueByRoomType,
    paymentMethods,
    extraChargesByType,
    settlement,
    accountFlow,
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
        "status, check_in_target, check_out_target, actual_check_in, actual_check_out, base_total_price, discount_amount, created_at, room_id, guest_count"
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
    guest_count: number | string | null;
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
      guestCount: Math.max(1, Number(r.guest_count) || 1),
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

  // Fiado del turno: cargos a cuenta corriente de los check-outs rendidos acá. No
  // pasa por `payments` (por eso no toca el arqueo), pero sin mostrarlo la rendición
  // esconde plata vendida.
  const { data: creditData, error: creditError } = await supabase
    .from("cuenta_corriente_movimientos")
    .select("amount, reservations!inner(checkout_cash_shift_id)")
    .eq("tipo", "cargo")
    .eq("reservations.checkout_cash_shift_id", shiftId);

  if (creditError) throw creditError;

  const creditCharged = ((creditData ?? []) as { amount: number | string }[]).reduce(
    (sum, m) => sum + (Number(m.amount) || 0),
    0
  );

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
    creditCharged: Math.round((creditCharged + Number.EPSILON) * 100) / 100,
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
  page?: number;
  pageSize?: number;
  /** Rol ya resuelto por el caller, para evitar un getCurrentUserRole() extra. */
  role?: UserRole;
};

export type ShiftsPage = {
  shifts: CashShift[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// Columnas explicitas: cash_shifts no tiene JSONB pesado, pero evitamos traer
// mas de lo que la tabla de rendiciones muestra.
const SHIFT_COLUMNS =
  "id, shift_number, opened_at, closed_at, opened_by, closed_by, opening_cash, expected_cash, actual_cash, discrepancy, notes, status";

/**
 * Lista paginada de turnos con el nombre del recepcionista que abrió/cerró.
 * Si el usuario actual es `receptionist`, filtra a sus propios turnos.
 * Si es `admin`, devuelve todos. (También hay RLS policy por dueño.)
 *
 * Usamos una query aparte a profiles porque cash_shifts.opened_by referencia
 * auth.users, no profiles, y PostgREST no puede embeber sin FK directo.
 */
export async function listShifts(filters: ListShiftsFilters = {}): Promise<ShiftsPage> {
  const supabase = await createClient();
  const role = filters.role ?? (await getCurrentUserRole());

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, filters.pageSize ?? 15);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("cash_shifts")
    .select(SHIFT_COLUMNS, { count: "exact" })
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

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const shifts = ((data ?? []) as CashShiftRow[]).map(toCashShift);
  if (shifts.length === 0) return { shifts, total, page, pageSize, totalPages };

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

  return {
    shifts: shifts.map((s) => ({
      ...s,
      opened_by_name: nameById.get(s.opened_by) ?? null,
      closed_by_name: s.closed_by ? nameById.get(s.closed_by) ?? null : null,
    })),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function openCashShift(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_open_cash_shift");
  if (error) throw error;
  return data as string;
}

/**
 * Reservas con la salida vencida que bloquean el cierre de caja + aviso de
 * alertas de limpieza "ocupada sin reserva". Va por RPC (SECURITY DEFINER)
 * porque la policy de SELECT de admin_alerts es admin-only y el recepcionista
 * necesita ver ambas cosas en el modal de cierre.
 */
export async function getCloseShiftBlockers(): Promise<CloseShiftBlockersResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_close_shift_blockers");
  if (error) throw error;
  const raw = data as {
    blockers?: Array<{
      reservation_id: string;
      room_id: number | string;
      room_number: string;
      client_name: string | null;
      effective_deadline: string;
      hours_overdue: number | string;
      balance_due: number | string;
    }>;
    occupied_alerts_count?: number;
  };
  return {
    blockers: (raw.blockers ?? []).map((b) => ({
      reservation_id: b.reservation_id,
      room_id: Number(b.room_id) || 0,
      room_number: b.room_number,
      client_name: b.client_name,
      effective_deadline: b.effective_deadline,
      hours_overdue: Number(b.hours_overdue) || 0,
      balance_due: Number(b.balance_due) || 0,
    })),
    occupied_alerts_count: raw.occupied_alerts_count ?? 0,
    // Reusa el listado que ya aplica el gate de turno: son exactamente los
    // check-outs que este usuario todavía puede facturar antes de cerrar.
    unbilled_count: (await listInvoiceableCheckouts().catch(() => [])).length,
  };
}

/**
 * Salida "reportar al admin" del guard de cierre: registra el conflicto de una
 * reserva vencida como admin_alert (kind shift_close_overdue_reservation) y
 * desbloquea el cierre mientras la alerta siga sin resolver. Idempotente.
 */
export async function reportShiftCloseConflict(
  reservationId: string,
  notes: string
): Promise<{ alertId: number; alreadyReported: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_report_shift_close_conflict", {
    p_reservation_id: reservationId,
    p_notes: notes,
  });
  if (error) throw error;
  const result = data as { alert_id: number; already_reported: boolean };
  return {
    alertId: Number(result.alert_id),
    alreadyReported: Boolean(result.already_reported),
  };
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
  const { data: lastReservations, error: lastReservationsError } = await supabase
    .from("reservations")
    .select("room_id, client_name, actual_check_out")
    .in("room_id", roomIds)
    .eq("status", "checked_out")
    .order("actual_check_out", { ascending: false });

  if (lastReservationsError) throw lastReservationsError;

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
    shift_number: number | string;
  }>).map((r) => ({
    actual_check_out: r.actual_check_out,
    client_name: r.client_name,
    client_dni: r.client_dni,
    total_price: Number(r.total_price) || 0,
    payment_method: r.payment_method as CheckoutExportRow["payment_method"],
    shift_number: Number(r.shift_number) || 0,
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

// ═══════════════════════════════════════════════════════════════════════════
// Facturación electrónica ARCA (mig 72)
// ═══════════════════════════════════════════════════════════════════════════

export async function getFiscalSettings(): Promise<FiscalSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fiscal_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: 1,
    enabled: Boolean(row.enabled),
    environment: (row.environment as FiscalSettings["environment"]) ?? "homologacion",
    cuit: (row.cuit as string | null) ?? null,
    razon_social: (row.razon_social as string | null) ?? null,
    domicilio_fiscal: (row.domicilio_fiscal as string | null) ?? null,
    iibb: (row.iibb as string | null) ?? null,
    inicio_actividades: (row.inicio_actividades as string | null) ?? null,
    punto_venta: row.punto_venta === null ? null : Number(row.punto_venta),
    cbte_tipo: Number(row.cbte_tipo) || 6,
    concepto: Number(row.concepto) || 2,
    iva_pct: Number(row.iva_pct) || 21,
    // `|| 30` no sirve acá: un plazo de 0 días es válido (vence el mismo día) y
    // `0 || 30` daría 30. El default sólo cubre la columna ausente — o sea, el
    // ratito entre deployar el código y aplicar la migración 98.
    dias_vto_cuenta_corriente:
      row.dias_vto_cuenta_corriente == null || !Number.isFinite(Number(row.dias_vto_cuenta_corriente))
        ? 30
        : Number(row.dias_vto_cuenta_corriente),
  };
}

export async function updateFiscalSettings(
  fields: Partial<Omit<FiscalSettings, "id">>
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("fiscal_settings")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
}

export async function setFiscalInternalKey(key: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_set_fiscal_internal_key", { p_key: key });
  if (error) throw error;
}

export async function createInvoiceDraft(
  reservationId: string,
  receptor?: InvoiceReceptorInput
): Promise<{ invoiceId: string; status: string; reused: boolean }> {
  const supabase = await createClient();
  // Default = Factura B (consumidor final con el DNI de la reserva). Para receptores
  // con CUIT se pasa la condición IVA (que deriva A o B en el RPC) + razón social +
  // domicilio (precargados de la ficha o cargados a mano).
  const params: Record<string, unknown> = { p_reservation_id: reservationId };
  if (receptor?.tipo === "cuit") {
    // p_tipo es vestigial (el RPC decide por condición IVA); lo mandamos por compat.
    params.p_tipo = receptor.condicionIva === "exento" ? "B" : "A";
    params.p_cuit = receptor.cuit;
    params.p_condicion_iva = receptor.condicionIva;
    params.p_razon_social = receptor.razonSocial;
    params.p_domicilio = receptor.domicilio;
  }
  const { data, error } = await supabase.rpc("rpc_create_invoice_draft", params);
  if (error) throw error;
  const r = data as { invoice_id: string; status: string; reused: boolean };
  return { invoiceId: r.invoice_id, status: r.status, reused: Boolean(r.reused) };
}

/**
 * Corrige el DNI de una reserva ya cerrada (checked_out) a los fines de re-facturar.
 * Después, emitInvoice re-lee el DNI corregido. Rechaza si ya hay factura autorizada.
 */
export async function fixReservationDniForInvoice(
  reservationId: string,
  dni: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_fix_reservation_dni_for_invoice", {
    p_reservation_id: reservationId,
    p_dni: dni,
  });
  if (error) throw error;
}

/** Descarta una factura pendiente/rechazada (reversible: la reserva vuelve a facturable). */
export async function discardInvoice(invoiceId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_discard_invoice", { p_invoice_id: invoiceId });
  if (error) throw error;
}

/** Payload que devuelve rpc_begin_invoice_emission para armar el SOAP. */
export type BeginEmissionPayload = {
  invoice_id: string;
  environment: FiscalSettings["environment"];
  pto_vta: number;
  cbte_tipo: number;
  concepto: number;
  cbte_nro: number;
  cbte_fch: string; // yyyymmdd
  doc_tipo: number;
  doc_nro: string;
  condicion_iva_receptor_id: number;
  imp_total: number;
  imp_neto: number;
  imp_iva: number;
  iva_id: number;
  mon_id: string;
  mon_cotiz: number;
  fch_serv_desde: string; // yyyymmdd
  fch_serv_hasta: string; // yyyymmdd
  fch_vto_pago: string; // yyyymmdd
  /** Sólo en notas de crédito: comprobante que se anula (bloque CbtesAsoc). */
  cbte_asoc_tipo: number | null;
  cbte_asoc_pto_vta: number | null;
  cbte_asoc_nro: number | null;
  cbte_asoc_fch: string | null; // yyyymmdd
  cuit: string;
};

export async function beginInvoiceEmission(
  invoiceId: string,
  cbteNro: number,
  internalKey: string
): Promise<BeginEmissionPayload> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_begin_invoice_emission", {
    p_invoice_id: invoiceId,
    p_cbte_nro: cbteNro,
    p_internal_key: internalKey,
  });
  if (error) throw error;
  const r = data as Record<string, unknown>;
  return {
    ...(r as unknown as BeginEmissionPayload),
    cbte_nro: Number(r.cbte_nro),
    imp_total: Number(r.imp_total),
    imp_neto: Number(r.imp_neto),
    imp_iva: Number(r.imp_iva),
    mon_cotiz: Number(r.mon_cotiz) || 1,
    // Sólo vienen con valor en las notas de crédito (bloque CbtesAsoc).
    cbte_asoc_tipo: r.cbte_asoc_tipo == null ? null : Number(r.cbte_asoc_tipo),
    cbte_asoc_pto_vta: r.cbte_asoc_pto_vta == null ? null : Number(r.cbte_asoc_pto_vta),
    cbte_asoc_nro: r.cbte_asoc_nro == null ? null : Number(r.cbte_asoc_nro),
    cbte_asoc_fch: r.cbte_asoc_fch == null ? null : String(r.cbte_asoc_fch),
  };
}

export async function finalizeInvoice(input: {
  invoiceId: string;
  outcome: "authorized" | "rejected" | "pending" | "unknown";
  cae?: string | null;
  caeVto?: string | null; // "yyyy-mm-dd"
  arcaResult?: unknown;
  qrUrl?: string | null;
  lastError?: string | null;
  internalKey: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_finalize_invoice", {
    p_invoice_id: input.invoiceId,
    p_outcome: input.outcome,
    p_cae: input.cae ?? null,
    p_cae_vto: input.caeVto ?? null,
    p_arca_result: input.arcaResult ?? null,
    p_qr_url: input.qrUrl ?? null,
    p_last_error: input.lastError ?? null,
    p_internal_key: input.internalKey,
  });
  if (error) throw error;
}

export async function getArcaTa(
  environment: FiscalSettings["environment"],
  internalKey: string
): Promise<{ token: string; sign: string; expiration_time: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_get_arca_ta", {
    p_environment: environment,
    p_internal_key: internalKey,
  });
  if (error) throw error;
  if (!data) return null;
  return data as { token: string; sign: string; expiration_time: string };
}

export async function setArcaTa(input: {
  environment: FiscalSettings["environment"];
  token: string;
  sign: string;
  generationTime: string | null;
  expirationTime: string;
  internalKey: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_set_arca_ta", {
    p_environment: input.environment,
    p_token: input.token,
    p_sign: input.sign,
    p_generation_time: input.generationTime,
    p_expiration_time: input.expirationTime,
    p_internal_key: input.internalKey,
  });
  if (error) throw error;
}

/**
 * IDs de facturas 'processing' estancadas (con número asignado y sin intento
 * reciente) de un ambiente, excluyendo una. Sirve para el auto-destrabado de
 * numeración (auditoría B7): una factura vieja en 'processing' retiene su número
 * y bloquea la emisión del resto. La policy "Staff read invoices" permite el SELECT.
 */
export async function getStaleProcessingInvoiceIds(
  environment: FiscalSettings["environment"],
  excludeInvoiceId: string | null,
  staleBeforeIso: string
): Promise<string[]> {
  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select("id")
    .eq("environment", environment)
    .eq("status", "processing")
    .not("cbte_nro", "is", null)
    .lt("last_attempt_at", staleBeforeIso);
  // `null` = barrido suelto, sin factura propia que excluir (sweepStaleInvoices).
  if (excludeInvoiceId !== null) query = query.neq("id", excludeInvoiceId);
  const { data, error } = await query.limit(10);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => String(r.id));
}

export async function getInvoiceById(invoiceId: string): Promise<InvoiceRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    reservation_id: r.reservation_id === null ? null : String(r.reservation_id),
    kind: (r.kind as InvoiceRecord["kind"] | undefined) ?? "checkout",
    nota_credito_de: r.nota_credito_de == null ? null : String(r.nota_credito_de),
    anulada_at: r.anulada_at == null ? null : String(r.anulada_at),
    status: r.status as InvoiceRecord["status"],
    environment: r.environment as InvoiceRecord["environment"],
    pto_vta: Number(r.pto_vta),
    cbte_tipo: Number(r.cbte_tipo),
    concepto: Number(r.concepto),
    cbte_nro: r.cbte_nro === null ? null : Number(r.cbte_nro),
    cbte_fch: (r.cbte_fch as string | null) ?? null,
    cae: (r.cae as string | null) ?? null,
    cae_vto: (r.cae_vto as string | null) ?? null,
    doc_tipo: Number(r.doc_tipo),
    doc_nro: String(r.doc_nro),
    condicion_iva_receptor_id: Number(r.condicion_iva_receptor_id),
    receptor_nombre: (r.receptor_nombre as string | null) ?? null,
    receptor_domicilio: (r.receptor_domicilio as string | null) ?? null,
    imp_total: Number(r.imp_total) || 0,
    imp_neto: Number(r.imp_neto) || 0,
    imp_iva: Number(r.imp_iva) || 0,
    iva_id: Number(r.iva_id) || 5,
    fch_serv_desde: String(r.fch_serv_desde),
    fch_serv_hasta: String(r.fch_serv_hasta),
    fch_vto_pago: (r.fch_vto_pago as string | null) ?? null,
    qr_url: (r.qr_url as string | null) ?? null,
    last_error: (r.last_error as string | null) ?? null,
    attempt_count: Number(r.attempt_count) || 0,
    detalle_nota: (r.detalle_nota as string | null) ?? null,
  };
}

export async function listPendingInvoices(): Promise<PendingInvoiceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_list_pending_invoices");
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    invoice_id: String(r.invoice_id),
    reservation_id: r.reservation_id === null ? null : String(r.reservation_id),
    status: String(r.status),
    room_number: String(r.room_number),
    receptor_nombre: (r.receptor_nombre as string | null) ?? null,
    imp_total: Number(r.imp_total) || 0,
    attempt_count: Number(r.attempt_count) || 0,
    last_error: (r.last_error as string | null) ?? null,
    last_attempt_at: (r.last_attempt_at as string | null) ?? null,
    created_at: String(r.created_at),
  }));
}

export async function listInvoiceableCheckouts(): Promise<InvoiceableCheckoutRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_list_invoiceable_checkouts");
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    reservation_id: String(r.reservation_id),
    room_number: String(r.room_number),
    client_name: String(r.client_name),
    client_dni: (r.client_dni as string | null) ?? null,
    total_price: Number(r.total_price) || 0,
    actual_check_out: String(r.actual_check_out),
  }));
}

/** Comprobantes autorizados recientes (para reimprimir/anular desde /admin/fiscal). */
export async function listTodayAuthorizedInvoices(): Promise<AuthorizedInvoiceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, pto_vta, cbte_nro, cbte_tipo, receptor_nombre, imp_total, cbte_fch, kind, anulada_at")
    .eq("status", "authorized")
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    invoice_id: String(r.id),
    pto_vta: Number(r.pto_vta),
    cbte_nro: Number(r.cbte_nro),
    cbte_tipo: Number(r.cbte_tipo),
    receptor_nombre: (r.receptor_nombre as string | null) ?? null,
    imp_total: Number(r.imp_total) || 0,
    kind: (r.kind as InvoiceKind | undefined) ?? "checkout",
    anulada_at: r.anulada_at == null ? null : String(r.anulada_at),
  }));
}

/**
 * Nota de crédito que anula un comprobante autorizado (mig 80). Devuelve el id
 * para que el llamador lo pase a emitInvoice, igual que cualquier otro draft.
 */
export async function createCreditNoteDraft(
  invoiceId: string
): Promise<{ invoiceId: string; cbteTipo: number; reused: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_create_credit_note_draft", {
    p_invoice_id: invoiceId,
  });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    invoiceId: String(r.invoice_id),
    cbteTipo: Number(r.cbte_tipo) || 8,
    reused: Boolean(r.reused),
  };
}

/** Registra que en el check-out se eligió NO facturar (punto 1, mig 80). */
export async function declineInvoice(reservationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_decline_invoice", {
    p_reservation_id: reservationId,
  });
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════════════════════
// Facturación de cuenta corriente: consolidada y control (mig 79)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estadías que cubre una factura. Las de check-out devuelven una sola fila; las
 * consolidadas, N. Es el detalle que se imprime (a ARCA no va: WSFEv1 sólo recibe
 * totales, no renglones).
 */
export async function getInvoiceStays(
  invoiceId: string,
  /**
   * Incluir los vínculos ya desactivados. Lo necesita el impreso de una nota de
   * crédito: al obtener CAE, la NC desvincula las estadías del comprobante que
   * anula (mig 80), así que sin esto la NC de una consolidada saldría sin detalle.
   */
  includeUnlinked = false
): Promise<InvoiceStayRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("invoice_reservations")
    .select("reservation_id, room_number, amount, fch_desde, fch_hasta, descripcion")
    .eq("invoice_id", invoiceId);
  if (!includeUnlinked) query = query.is("unlinked_at", null);
  const { data, error } = await query.order("fch_desde", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    reservation_id: String(r.reservation_id),
    room_number: (r.room_number as string | null) ?? null,
    amount: Number(r.amount) || 0,
    fch_desde: String(r.fch_desde),
    fch_hasta: String(r.fch_hasta),
    descripcion: (r.descripcion as string | null) ?? null,
  }));
}

/**
 * Datos de facturación de las fichas habilitadas a cuenta corriente, indexados
 * por `${kind}:${id}`. Lo usa la pantalla de factura consolidada para precargar
 * el receptor y anticipar la letra, tanto para empresas como para huéspedes.
 */
export async function getCtaCteBillingProfiles(): Promise<Record<string, InvoiceReceptorPrefill>> {
  const supabase = await createClient();
  const [companyRes, guestRes] = await Promise.all([
    supabase
      .from("associated_clients")
      .select("id, cuenta_corriente_habilitada, condicion_iva, document_id, display_name, razon_social, domicilio")
      .eq("cuenta_corriente_habilitada", true),
    supabase
      .from("guests")
      .select("id, cuenta_corriente_habilitada, condicion_iva, cuit, full_name, razon_social, domicilio_fiscal")
      .eq("cuenta_corriente_habilitada", true),
  ]);

  const map: Record<string, InvoiceReceptorPrefill> = {};
  for (const c of (companyRes.data ?? []) as BillingClientRow[]) {
    map[`company:${c.id}`] = toInvoicePrefill(c, null);
  }
  for (const g of (guestRes.data ?? []) as BillingClientRow[]) {
    map[`guest:${g.id}`] = toInvoicePrefill(g, null);
  }
  return map;
}

/**
 * Estadías de cuenta corriente de un cliente, facturadas y sin facturar.
 *
 * La migración 90 capturó `rpc_list_cc_account_stays` y dejó acá un filtro por
 * `facturable` para que la pantalla vieja siguiera andando. Ya no hace falta: la
 * pantalla muestra todas las estadías con su estado, así que se devuelven enteras.
 * `facturable` repite el mismo predicado que usa el draft para rechazar con P0026,
 * así la pantalla no ofrece tildar algo que el servidor después rebota.
 */
export async function listCcAccountStays(
  kind: CtaCteClientKind,
  clientId: string,
  from?: string,
  to?: string
): Promise<CcAccountStayRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_list_cc_account_stays", {
    p_kind: kind,
    p_client_id: clientId,
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    reservation_id: String(r.reservation_id),
    movimiento_id: String(r.movimiento_id),
    room_number: (r.room_number as string | null) ?? null,
    passenger: (r.passenger as string | null) ?? null,
    fch_desde: String(r.fch_desde),
    fch_hasta: String(r.fch_hasta),
    amount: Number(r.amount) || 0,
    total_price: Number(r.total_price) || 0,
    actual_check_out: String(r.actual_check_out),
    mixed_payment: Boolean(r.mixed_payment),
    facturable: Boolean(r.facturable),
    estado: (r.estado as CcAccountStayRow["estado"]) ?? "pendiente",
    invoice_id: (r.invoice_id as string | null) ?? null,
    invoice_kind: (r.invoice_kind as CcAccountStayRow["invoice_kind"]) ?? null,
    invoice_status: (r.invoice_status as string | null) ?? null,
    cbte_tipo: r.cbte_tipo === null || r.cbte_tipo === undefined ? null : Number(r.cbte_tipo),
    pto_vta: r.pto_vta === null || r.pto_vta === undefined ? null : Number(r.pto_vta),
    cbte_nro: r.cbte_nro === null || r.cbte_nro === undefined ? null : Number(r.cbte_nro),
    cbte_fch: (r.cbte_fch as string | null) ?? null,
    external_ref: (r.external_ref as string | null) ?? null,
  }));
}

/**
 * Crea el draft de una factura consolidada (N estadías → 1 comprobante). Devuelve
 * el id para que el llamador lo pase a emitInvoice(), igual que el flujo normal.
 */
export async function createConsolidatedInvoiceDraft(
  payload: ConsolidatedInvoicePayload
): Promise<{ invoiceId: string; impTotal: number; count: number; cbteTipo: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_create_consolidated_invoice_draft", {
    p_kind: payload.kind,
    p_client_id: payload.clientId,
    p_reservation_ids: payload.reservationIds,
    p_cuit: payload.cuit ?? null,
    p_condicion_iva: payload.condicionIva ?? null,
    p_razon_social: payload.razonSocial ?? null,
    p_domicilio: payload.domicilio ?? null,
    p_detalle:
      payload.detalle && payload.detalle.length > 0
        ? payload.detalle.map((d) => ({
            reservation_id: d.reservationId,
            descripcion: d.descripcion,
          }))
        : null,
    p_nota: payload.nota ?? null,
  });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    invoiceId: String(r.invoice_id),
    impTotal: Number(r.imp_total) || 0,
    count: Number(r.count) || 0,
    cbteTipo: Number(r.cbte_tipo) || 6,
  };
}

/** Listado de control: qué está facturado y qué no, en un rango (admin). */
export async function listBillingControl(
  from: string,
  to: string,
  clientKind?: CtaCteClientKind,
  clientId?: string
): Promise<BillingControlRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_list_billing_control", {
    p_from: from,
    p_to: to,
    p_client_kind: clientKind ?? null,
    p_client_id: clientId ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    reservation_id: String(r.reservation_id),
    room_number: String(r.room_number),
    client_name: String(r.client_name),
    cliente: String(r.cliente),
    client_kind: (r.client_kind as CtaCteClientKind | null) ?? null,
    client_id: r.client_id === null ? null : String(r.client_id),
    actual_check_out: String(r.actual_check_out),
    fch_desde: String(r.fch_desde),
    fch_hasta: String(r.fch_hasta),
    total_price: Number(r.total_price) || 0,
    cargo_cc: r.cargo_cc === null ? null : Number(r.cargo_cc),
    cierre: r.cierre as BillingControlRow["cierre"],
    facturacion_modo: r.facturacion_modo as FacturacionModo,
    estado: r.estado as BillingControlRow["estado"],
    invoice_id: r.invoice_id === null ? null : String(r.invoice_id),
    invoice_kind: (r.invoice_kind as BillingControlRow["invoice_kind"]) ?? null,
    invoice_status: (r.invoice_status as string | null) ?? null,
    cbte_tipo: r.cbte_tipo === null ? null : Number(r.cbte_tipo),
    pto_vta: r.pto_vta === null ? null : Number(r.pto_vta),
    cbte_nro: r.cbte_nro === null ? null : Number(r.cbte_nro),
    imp_total: r.imp_total === null ? null : Number(r.imp_total),
    external_ref: (r.external_ref as string | null) ?? null,
    bancario: Boolean(r.bancario),
  }));
}

/**
 * Datos de un receptor ya conocido, por CUIT. Se consulta al tipear el CUIT en el
 * paso "con CUIT": si ya se le facturó antes, se completa solo (mig 83).
 */
export async function lookupReceptorByCuit(cuit: string): Promise<ReceptorLookup> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_lookup_receptor_by_cuit", { p_cuit: cuit });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    found: Boolean(r.found),
    fuente: (r.fuente as ReceptorLookup["fuente"]) ?? null,
    razon_social: (r.razon_social as string | null) ?? null,
    condicion_iva: (r.condicion_iva as ReceptorLookup["condicion_iva"]) ?? null,
    domicilio: (r.domicilio as string | null) ?? null,
  };
}

/**
 * Marca una estadía como facturada FUERA del sistema (portal de ARCA u otro).
 * Deja constancia del comprobante y de quién lo afirmó, y la estadía deja de
 * figurar como pendiente en todos los listados (mig 82).
 */
export async function markInvoicedExternally(
  reservationId: string,
  ref: string,
  fecha?: string,
  notes?: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_mark_invoiced_externally", {
    p_reservation_id: reservationId,
    p_ref: ref,
    p_fecha: fecha ?? null,
    p_notes: notes ?? null,
  });
  if (error) throw error;
}

/** Deshace la marca externa (no la borra: queda el rastro). */
export async function unmarkInvoicedExternally(reservationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("rpc_unmark_invoiced_externally", {
    p_reservation_id: reservationId,
  });
  if (error) throw error;
}

/** Cuánto queda sin facturar en los últimos `days` días (badge del admin). */
export async function countBillingPending(days = 60): Promise<BillingPendingCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_count_billing_pending", { p_days: days });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    falta: Number(r.falta) || 0,
    pendiente_consolidada: Number(r.pendiente_consolidada) || 0,
    dias: Number(r.dias) || days,
  };
}
