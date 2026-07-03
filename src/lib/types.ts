export type UserRole = "admin" | "receptionist" | "client" | "maintenance";

export type RoomCleaningLogEntry = {
  id: number;
  room_id: number;
  room_number: string;
  cleaned_at: string;
  cleaned_by: string;
  cleaner_name: string | null;
  previous_status: string;
  cleaning_type: CleaningType | null;
  notes: string | null;
  has_admin_alert: boolean;
};

export type AdminAlert = {
  id: number;
  kind: string;
  message: string;
  related_room_id: number | null;
  related_room_number: string | null;
  related_cleaning_log_id: number | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_notes: string | null;
};

export type RoomStatus = "available" | "occupied" | "maintenance" | "cleaning";

export type CleaningType =
  | "habitacion_ocupada"
  | "limpieza_mantenimiento"
  | "limpia_ocupada"
  | "limpia_vacia"
  | "limpia_repaso";

export type CleaningRequiredReason =
  | "status_cleaning"
  | "status_maintenance"
  | "overnight_stay";

export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled";

export type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string; code?: string };

export type RoomCategory = {
  id: number;
  name: string;
  capacity: number;
  capacity_adults: number;
  capacity_children: number;
  beds_configuration: string;
  amenities: string[];
  description: string | null;
  image_url: string | null;
  base_price: number;
  half_day_price: number;
  is_active: boolean;
};

export type RoomCategoryUsage = RoomCategory & {
  room_count: number;
};

export type Room = {
  id: number;
  category_id: number | null;
  room_number: string;
  room_type: string;
  status: RoomStatus;
  capacity: number;
  capacity_adults: number;
  capacity_children: number;
  beds_configuration: string;
  amenities: string[];
  description: string | null;
  image_url: string | null;
  base_price: number;
  half_day_price: number;
  is_active: boolean;
};

export type PublicRoomOfferMode = "catalog" | "available" | "combination";

export type PublicRoomOffer = {
  id: string;
  roomType: string;
  mode: PublicRoomOfferMode;
  representativeRoom: Room;
  roomCount: number;
  priceFrom: number;
  maxCapacity: number;
  bedsSummary: string;
  description: string | null;
  imageUrl: string | null;
  amenities: string[];
};

export type Reservation = {
  id: string;
  associated_client_id: string | null;
  client_name: string;
  client_phone: string | null;
  client_dni: string | null;
  check_in_target: string;
  check_out_target: string;
  late_check_out_until: string | null;
  room_id: number;
  status: ReservationStatus;
  actual_check_in: string | null;
  actual_check_out: string | null;
  base_total_price: number;
  discount_percent: number;
  discount_amount: number;
  total_price: number;
  paid_amount: number;
  guest_count: number;
  notes: string | null;
  whatsapp_notified: boolean;
};

export type MaintenanceRoom = Room & {
  requires_cleaning: boolean;
  cleaning_required_reason: CleaningRequiredReason | null;
  cleaned_today: boolean;
  active_client: string | null;
  active_check_out_target: string | null;
  active_late_check_out_until: string | null;
  last_checkout_client: string | null;
  last_checkout_at: string | null;
};

export type PendingReservation = {
  id: string;
  client_name: string;
  client_phone: string | null;
  client_dni: string | null;
  status: ReservationStatus;
  check_in_target: string;
  check_out_target: string;
  total_price: number;
  whatsapp_notified: boolean;
  room_number: string;
  room_type: string;
};

export type HotelSettings = {
  id: number;
  name: string;
  standard_check_in_time: string;
  standard_check_out_time: string;
  late_check_out_time: string;
  timezone: string;
  currency: string;
  contact_email: string | null;
  contact_phone: string | null;
  contact_whatsapp_phone?: string | null;
  contact_fixed_phone?: string | null;
  address: string | null;
  hero_title: string;
  hero_subtitle: string;
  hero_image_url?: string | null;
  services_image_url?: string | null;
  logo_url?: string | null;
  contact_instagram?: string | null;
  confirmation_message_template?: string | null;
};

export type Guest = {
  id: string;
  client_name: string;
  client_dni: string | null;
  status: ReservationStatus;
  check_in_target: string;
  check_out_target: string;
  room_number: string;
  total_price: number;
  paid_amount: number;
  guest_profession: string | null;
  guest_address: string | null;
  guest_locality: string | null;
  guest_nationality: string | null;
  guest_doc_type: string | null;
  guest_birth_date: string | null;
  guest_vehicle: string | null;
};

/** Una persona del directorio real de huespedes (deduplicado por DNI / nombre). */
export type GuestDirectoryEntry = {
  key: string;
  /** Id del padron (tabla guests) si la persona ya tiene ficha; null si solo viene de reservas. */
  id: string | null;
  client_name: string;
  client_dni: string | null;
  client_phone: string | null;
  guest_locality: string | null;
  guest_nationality: string | null;
  guest_doc_type: string | null;
  /** Descuento personal del huesped (0 si no tiene ficha en el padron o no se le cargo). */
  discount_percent: number;
  /** Cuenta corriente habilitada (solo true si tiene ficha en el padron y admin la habilitó). */
  cuenta_corriente_habilitada: boolean;
  stays_count: number;
  /** Última visita; null si está en el registro pero todavía no tiene reservas en el sistema. */
  last_check_in: string | null;
};

/** Ficha editable de un huésped del padrón (tabla guests). Para el modal de edición. */
export type GuestRecord = {
  id: string;
  full_name: string;
  document_type: string | null;
  document_id: string | null;
  phone: string | null;
  address: string | null;
  locality: string | null;
  nationality: string | null;
  profession: string | null;
  discount_percent: number;
  cuenta_corriente_habilitada: boolean;
};

/** Tipo de cliente con cuenta corriente: empresa (associated_clients) o huésped (guests). */
export type CtaCteClientKind = "company" | "guest";

/** Una cuenta con su saldo, para la lista central de deudores y las fichas. */
export type CtaCteAccount = {
  kind: CtaCteClientKind;
  id: string;
  name: string;
  document_id: string | null;
  /** Σ cargos − Σ pagos. Positivo = debe; negativo = saldo a favor. */
  balance: number;
};

/** Un movimiento de cuenta corriente (cargo de check-out o pago a cuenta). */
export type CtaCteMovimiento = {
  id: string;
  tipo: "cargo" | "pago";
  amount: number;
  reservation_id: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
};

export type RegisterAccountPaymentPayload = {
  kind: CtaCteClientKind;
  clientId: string;
  amount: number;
  method?: string;
  notes?: string;
};

/** Resultado de buscar un huésped existente por DNI (anti-duplicados). */
export type GuestDniMatch = {
  client_name: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_phone: string | null;
};

/** Una llegada proxima (seccion "Huespedes por llegar"). */
export type UpcomingGuest = {
  id: string;
  client_name: string;
  client_dni: string | null;
  status: ReservationStatus;
  check_in_target: string;
  check_out_target: string;
  room_number: string;
  guest_count: number;
};

/** Pagina del historial de reservas (paginado). */
export type ReservationHistoryPage = {
  rows: Guest[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type AssociatedClient = {
  id: string;
  display_name: string;
  document_id: string;
  phone: string | null;
  discount_percent: number;
  notes: string | null;
  is_active: boolean;
  /** Habilitado a usar cuenta corriente (fiar). Por defecto false; solo admin lo cambia. */
  cuenta_corriente_habilitada: boolean;
  created_at: string;
  updated_at: string;
};

/** Una fila del historial de estadías de un asociado (para su ficha). */
export type AssociatedLedgerRow = {
  id: string;
  passenger: string | null;
  room_number: string | null;
  status: ReservationStatus;
  check_in_target: string;
  check_out_target: string;
  total_price: number;
  paid_amount: number;
};

/** Ficha del asociado: historial de estadías + totales (facturado/cobrado/saldo). */
export type AssociatedClientLedger = {
  reservations: AssociatedLedgerRow[];
  facturado: number;
  cobrado: number;
  saldo: number;
  count: number;
};

export type ReservationCustomerMode = "manual" | "associated";

export type WalkInStayType = "night" | "half_day";

/** Campos opcionales del registro de huespedes (libro de pasajeros). */
export type GuestRegistryInput = {
  guestProfession?: string;
  guestAddress?: string;
  guestLocality?: string;
  guestNationality?: string;
  guestDocType?: string;
  guestBirthDate?: string;
  guestVehicle?: string;
};

/**
 * Alta de reserva. La reserva es PERSONA o EMPRESA:
 * - person: la persona (huesped) se hospeda y queda en client_*; su descuento personal se aplica
 *   si se eligio del padron (guestId). Vive en la tabla guests (se crea sola).
 * - company: la reserva va por una Empresa/Convenio (su descuento se aplica) y el pasajero real
 *   (passenger*) es quien se hospeda; vive en la tabla company_passengers (dedup por empresa).
 */
export type CreateReservationPayload =
  | ({
      mode: "person";
      roomId: number;
      /** Padron id si el huesped se eligio del directorio; null/undefined si es nuevo. */
      guestId?: string | null;
      clientFirstName: string;
      clientLastName: string;
      clientDni: string;
      clientPhone?: string;
      checkIn: string;
      checkOut: string;
      guestCount?: number;
    } & GuestRegistryInput)
  | ({
      mode: "company";
      roomId: number;
      associatedClientId: string;
      /** Id del pasajero si se eligio de la lista de la empresa; null/undefined si es nuevo. */
      companyPassengerId?: string | null;
      passengerName: string;
      passengerDni: string;
      passengerPhone?: string;
      checkIn: string;
      checkOut: string;
      guestCount?: number;
    } & GuestRegistryInput);

/** Pasajero/empleado que viaja por una empresa (tabla company_passengers, separada de guests). */
export type CompanyPassenger = {
  id: string;
  associated_client_id: string;
  full_name: string;
  document_id: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

/** Una fila de la seccion Descuentos: un huesped o una empresa con descuento asignado. */
export type DiscountedClient = {
  kind: "guest" | "company";
  id: string;
  name: string;
  document_id: string | null;
  discount_percent: number;
};

// Check-in directo (walk-in): mismo fork que el alta de reserva, persona o empresa.
export type AssignWalkInPayload =
  | ({
      mode: "person";
      roomId: number;
      guestId?: string | null;
      clientFirstName: string;
      clientLastName: string;
      clientDni: string;
      nights: number;
      guestCount?: number;
      stayType?: WalkInStayType;
    } & GuestRegistryInput)
  | ({
      mode: "company";
      roomId: number;
      nights: number;
      associatedClientId: string;
      companyPassengerId?: string | null;
      passengerName: string;
      passengerDni: string;
      guestCount?: number;
      stayType?: WalkInStayType;
    } & GuestRegistryInput);

export type PaymentMethod = "cash" | "credit_card" | "debit_card" | "bank_transfer" | "other" | "mercado_pago" | "vale_blanco" | "cuenta_corriente";

export type Payment = {
  id: string;
  reservation_id: string;
  amount: number;
  payment_method: PaymentMethod;
  reference_code: string | null;
  notes: string | null;
  created_at: string;
};

export type CashShiftStatus = "open" | "closed";

export type CashShift = {
  id: string;
  shift_number: number;
  opened_at: string;
  closed_at: string | null;
  opened_by: string;
  closed_by: string | null;
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  discrepancy: number | null;
  notes: string | null;
  status: CashShiftStatus;
  opened_by_name?: string | null;
  closed_by_name?: string | null;
};

export type ManageableProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
};

export type ShiftPaymentRow = {
  id: string;
  amount: number;
  payment_method: PaymentMethod;
  notes: string | null;
  created_at: string;
  reservation_id: string;
  client_name: string;
  room_number: string | null;
};

export type ShiftSummary = {
  shift: CashShift;
  paymentsCount: number;
  /** Cantidad de piezas rendidas: check-outs hechos durante este turno. */
  checkoutsCount: number;
  totalsByMethod: Record<PaymentMethod, number>;
  totalIncome: number;
  cashIncome: number;
  payments: ShiftPaymentRow[];
  openedByEmail: string | null;
  closedByEmail: string | null;
};

export type CloseShiftPayload = { shiftId: string; actualCash: number; notes?: string };
