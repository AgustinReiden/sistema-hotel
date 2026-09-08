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
  cleaning_category: CleaningCategory | null;
  outcome: CleaningOutcome;
  notes: string | null;
  has_admin_alert: boolean;
};

export type CleaningLogSummary = {
  checkin_daily: number;
  checkout: number;
  empty_maintenance: number;
  occupied_anomaly: number;
  no_key: number;
};

export type CleaningLogResult = {
  rows: RoomCleaningLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  summary: CleaningLogSummary;
};

export type TariffRequestPayload = {
  old_room_id: number;
  old_base_total_price: number;
  old_discount_percent: number;
  old_discount_amount: number;
  old_total_price: number;
  new_room_id: number;
  new_total_price: number;
};

export type AdminAlert = {
  id: number;
  kind: string;
  message: string;
  related_room_id: number | null;
  related_room_number: string | null;
  related_cleaning_log_id: number | null;
  related_reservation_id: string | null;
  decision: "authorized" | "rejected" | null;
  payload: TariffRequestPayload | null;
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

/** Categoría real de la limpieza, clasificada por el RPC según el contexto. */
export type CleaningCategory =
  | "checkout" // limpieza post check-out (bloquea el próximo check-in)
  | "checkin_daily" // limpieza diaria de una habitación ocupada (no bloquea)
  | "empty_maintenance" // mantenimiento/limpieza de una habitación vacía
  | "occupied_anomaly"; // se limpió una ocupada sin reserva que lo justifique (alerta)

/** Resultado de la limpieza diaria: se limpió o no se pudo (sin llave). */
export type CleaningOutcome = "cleaned" | "not_cleaned_no_key";

/** Última limpieza de HOY de una habitación (para el estado "Limpiada hoy" del tablero). */
export type TodayCleaning = {
  at: string;
  category: CleaningCategory | null;
  outcome: CleaningOutcome;
};

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
  /** Pasajero de la empresa ya cargado. null en una reserva de empresa sin pasajero aun (mig 88). */
  company_passenger_id: string | null;
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
  /** Resultado de la limpieza diaria de hoy (si ya se registró): limpiada o "sin llave". */
  daily_outcome: CleaningOutcome | null;
  daily_notes: string | null;
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
  /** Cuándo se le factura: al cerrar cada estadía, consolidado, o nunca (mig 79). */
  facturacion_modo: FacturacionModo;
  // ── Datos de facturación (mig 81, punto 3 del gerente) ──
  /** Condición frente al IVA. null = consumidor final (Factura B con DNI). */
  condicion_iva: CondicionIva | null;
  /** CUIT para Factura A. Es OTRO número que `document_id`, que es el DNI. */
  cuit: string | null;
  /** Razón social si factura a nombre de un comercio; si no, se usa full_name. */
  razon_social: string | null;
  /** Domicilio fiscal (RG 1415). Puede diferir de `address`, el particular. */
  domicilio_fiscal: string | null;
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

/**
 * Condición frente al IVA del receptor (RG 5616). Define el comprobante:
 * RI/Monotributo → Factura A; Exento → Factura B con CUIT; Consumidor Final → Factura B con DNI.
 */
export type CondicionIva = "responsable_inscripto" | "monotributo" | "consumidor_final" | "exento";

/** Condiciones que se facturan con CUIT (razón social + domicilio del receptor). */
export type ReceptorCondicionCuit = "responsable_inscripto" | "monotributo" | "exento";

/**
 * Datos de facturación resueltos desde la ficha del cliente —empresa o huésped—
 * para precargar el modal del check-out (mig 81, punto 3 del gerente).
 */
export type InvoiceReceptorPrefill = {
  razonSocial: string;
  /** Sólo dígitos, y sólo si pasa el dígito verificador. "" si no hay CUIT usable. */
  cuit: string;
  condicionIva: ReceptorCondicionCuit | "";
  domicilio: string;
  /** true si la ficha ya tiene CUIT válido → sugerir el camino "con CUIT". */
  suggestA: boolean;
  /**
   * true si la ficha tiene los CUATRO datos que exige emitir con CUIT. Con esto
   * no se pregunta el tipo: se muestra qué se emite y se confirma (mig 83).
   */
  complete: boolean;
};

/** Datos de un receptor ya conocido, buscado por CUIT al facturar (mig 83). */
export type ReceptorLookup = {
  found: boolean;
  /** De dónde salieron los datos, para poder decírselo al que factura. */
  fuente: "empresa" | "huesped" | "factura" | null;
  razon_social: string | null;
  condicion_iva: ReceptorCondicionCuit | null;
  domicilio: string | null;
};

/**
 * Cuándo se le emite factura fiscal al cliente (mig 79).
 * - "por_checkout": se ofrece factura al cerrar, incluso si va a cuenta corriente.
 * - "consolidada": no se factura al cerrar; el admin junta N estadías en una factura.
 * - "no_factura": nunca se factura (consumo interno, convenios sin comprobante fiscal).
 */
export type FacturacionModo = "por_checkout" | "consolidada" | "no_factura";

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
  /** Condición frente al IVA (para Factura A). null = no definida en la ficha. */
  condicion_iva: CondicionIva | null;
  /** Domicilio del receptor (para Factura A). null = no definido en la ficha. */
  domicilio: string | null;
  /** Cuándo se le factura: al cerrar cada estadía, consolidado, o nunca (mig 79). */
  facturacion_modo: FacturacionModo;
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
 * - company: la reserva va por una Empresa/Convenio (su descuento se aplica). El pasajero real
 *   (passenger*) es OPCIONAL: la empresa reserva con semanas de anticipacion y todavia no sabe a
 *   quien manda, asi que se carga recien en el check-in (mig 88). Vive en company_passengers.
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
      /** Vacios en el alta normal: el pasajero se define en el check-in. */
      passengerName?: string;
      passengerDni?: string;
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

/**
 * Check-in de una reserva. En una reserva de empresa el pasajero se carga recien aca
 * (mig 88): la empresa reserva sin saber a quien manda. En una reserva de persona el
 * huesped ya vino del alta y no se manda nada extra.
 */
export type CheckInPayload = {
  reservationId: string;
} & CheckInPassengerInput;

/** Datos del pasajero que entra por una empresa (se cargan en el check-in). */
export type CheckInPassengerInput = {
  /** Id del pasajero si se eligio de la lista de la empresa; undefined si es nuevo. */
  companyPassengerId?: string | null;
  passengerName?: string;
  passengerDni?: string;
  passengerPhone?: string;
} & GuestRegistryInput;

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

/**
 * Cómo se salda una estadía. OJO: `cuenta_corriente` es una forma de CERRAR el
 * check-out (fiar), no un medio de pago: no genera fila en `payments` sino un cargo
 * en la cuenta del cliente. Desde la migración 89 la base lo prohíbe en
 * payments.payment_method por CHECK, así que solo puede viajar a los RPCs de
 * check-out (rpc_staff_checkout_reservation / rpc_staff_early_checkout).
 */
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
  /**
   * Fiado a cuenta corriente en este turno: Σ cargos de las reservas cuyo check-out
   * quedó ligado al turno. No es plata cobrada y no entra en totalIncome, pero es
   * parte de lo que se cerró en el turno y el recepcionista lo tiene que ver.
   */
  creditCharged: number;
  payments: ShiftPaymentRow[];
  openedByEmail: string | null;
  closedByEmail: string | null;
};

export type CloseShiftPayload = { shiftId: string; actualCash: number; notes?: string };

/**
 * Reserva con la salida vencida que bloquea el cierre de caja. Se resuelve con
 * una de tres salidas: ampliar la reserva, hacer el check-out, o reportar el
 * conflicto al admin (rpc_report_shift_close_conflict).
 */
export type CloseShiftBlocker = {
  reservation_id: string;
  room_id: number;
  room_number: string;
  client_name: string | null;
  effective_deadline: string;
  hours_overdue: number;
  balance_due: number;
};

export type CloseShiftBlockersResult = {
  blockers: CloseShiftBlocker[];
  /** Alertas de limpieza "ocupada sin reserva" sin resolver (aviso, no bloquea). */
  occupied_alerts_count: number;
  /**
   * Check-outs de este turno que quedaron sin facturar y todavía se pueden
   * facturar desde acá (mig 82). Es un AVISO, no un bloqueo: no facturar puede
   * ser una decisión legítima, y trabar el cierre de caja por esto sería peor.
   */
  unbilled_count: number;
};

/** Una fila del export CSV fiscal: un check-out del turno. */
export type CheckoutExportRow = {
  actual_check_out: string;
  client_name: string;
  client_dni: string | null;
  total_price: number;
  payment_method: PaymentMethod | "sin_cobro";
  /** Nº de cierre correlativo del turno (para validar el import en el gestión). */
  shift_number: number;
};

// ═══════════════════════════════════════════════════════════════════════════
// Facturación electrónica ARCA (mig 72)
// ═══════════════════════════════════════════════════════════════════════════

export type FiscalEnvironment = "homologacion" | "produccion";

export type FiscalSettings = {
  id: number;
  enabled: boolean;
  environment: FiscalEnvironment;
  cuit: string | null;
  razon_social: string | null;
  domicilio_fiscal: string | null;
  iibb: string | null;
  inicio_actividades: string | null; // date
  punto_venta: number | null;
  cbte_tipo: number;
  concepto: number;
  iva_pct: number;
};

/**
 * Tipo interno de comprobante.
 * - "checkout": cubre UNA estadía; cuelga de la reserva y del turno de caja (mig 79).
 * - "consolidada": cubre N estadías de cuenta corriente; sin reserva ni turno (mig 79).
 * - "nota_credito": anula otro comprobante; lo referencia en `nota_credito_de` (mig 80).
 */
export type InvoiceKind = "checkout" | "consolidada" | "nota_credito";

export type InvoiceRecord = {
  id: string;
  /** null en consolidadas y notas de crédito: no cuelgan de una reserva. */
  reservation_id: string | null;
  kind: InvoiceKind;
  /** Sólo en notas de crédito: id del comprobante que anula (mig 80). */
  nota_credito_de: string | null;
  /** Con valor si una nota de crédito ya anuló este comprobante (mig 80). */
  anulada_at: string | null;
  status: "pending" | "processing" | "authorized" | "rejected" | "discarded";
  environment: FiscalEnvironment;
  pto_vta: number;
  cbte_tipo: number;
  concepto: number;
  cbte_nro: number | null;
  cbte_fch: string | null; // date
  cae: string | null;
  cae_vto: string | null; // date
  doc_tipo: number;
  doc_nro: string;
  condicion_iva_receptor_id: number;
  receptor_nombre: string | null;
  receptor_domicilio: string | null;
  imp_total: number;
  imp_neto: number;
  imp_iva: number;
  iva_id: number; // 5 = 21%
  fch_serv_desde: string; // date
  fch_serv_hasta: string; // date
  qr_url: string | null;
  last_error: string | null;
  attempt_count: number;
};

/**
 * Datos del receptor elegidos en el momento de facturar.
 * - "B": consumidor final, usa el DNI de la reserva (Factura B).
 * - "cuit": receptor con CUIT; la condición IVA deriva el comprobante
 *   (RI/Monotributo → Factura A; Exento → Factura B con CUIT).
 */
export type InvoiceReceptorInput =
  | { tipo: "B" }
  | {
      tipo: "cuit";
      condicionIva: ReceptorCondicionCuit;
      cuit: string;
      razonSocial: string;
      domicilio: string;
    };

export type PendingInvoiceRow = {
  invoice_id: string;
  /** null en las consolidadas (no hay reserva ni "corregir DNI" posible). */
  reservation_id: string | null;
  status: string;
  /** "CONSOLIDADA" cuando la factura no cuelga de una habitación. */
  room_number: string;
  receptor_nombre: string | null;
  imp_total: number;
  attempt_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
};

export type InvoiceableCheckoutRow = {
  reservation_id: string;
  room_number: string;
  client_name: string;
  client_dni: string | null;
  total_price: number;
  actual_check_out: string;
};

/** Comprobante con CAE, para reimprimir o anular con nota de crédito. */
export type AuthorizedInvoiceRow = {
  invoice_id: string;
  pto_vta: number;
  cbte_nro: number;
  /** 1 = Factura A · 6 = Factura B · 3 = NC A · 8 = NC B. */
  cbte_tipo: number;
  receptor_nombre: string | null;
  imp_total: number;
  kind: InvoiceKind;
  /** Con valor si ya fue anulado por una nota de crédito. */
  anulada_at: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════
// Facturación de cuenta corriente: consolidada y control (mig 79)
// ═══════════════════════════════════════════════════════════════════════════

/** Una estadía cubierta por una factura. En las de check-out hay exactamente una. */
export type InvoiceStayRow = {
  reservation_id: string;
  room_number: string | null;
  amount: number;
  fch_desde: string; // date
  fch_hasta: string; // date
};

/** Un cargo de cuenta corriente pendiente de facturar (selector de la consolidada). */
export type CcChargeToInvoiceRow = {
  reservation_id: string;
  movimiento_id: string;
  room_number: string | null;
  passenger: string | null;
  fch_desde: string; // date
  fch_hasta: string; // date
  /** Lo que se factura: el CARGO a cuenta corriente, no total_price. */
  amount: number;
  total_price: number;
  actual_check_out: string;
  /** true si hubo cobro en caja además del cargo: se factura sólo el cargo. */
  mixed_payment: boolean;
};

/**
 * Estado fiscal de una estadía en el listado de control.
 * "no_corresponde" y "pendiente_consolidada" son estados sanos; "falta" es el que
 * hay que perseguir.
 */
export type BillingControlEstado =
  | "facturado"
  | "facturado_consolidado"
  /** El admin marcó que se facturó fuera del sistema (ARCA u otro) — mig 82. */
  | "facturado_externo"
  | "en_proceso"
  | "pendiente_consolidada"
  | "no_corresponde"
  | "falta";

/** Cómo se cerró la estadía (define si el cargo va a caja o a cuenta corriente). */
export type BillingControlCierre = "caja" | "cuenta_corriente" | "vale_blanco";

/** Una fila del listado de control facturado/no facturado. */
export type BillingControlRow = {
  reservation_id: string;
  room_number: string;
  client_name: string;
  /** Nombre del cliente facturable (empresa o huésped) o el de la reserva. */
  cliente: string;
  client_kind: CtaCteClientKind | null;
  client_id: string | null;
  actual_check_out: string;
  fch_desde: string; // date
  fch_hasta: string; // date
  total_price: number;
  /** Σ cargos a cuenta corriente de la estadía; null si cerró por caja. */
  cargo_cc: number | null;
  cierre: BillingControlCierre;
  facturacion_modo: FacturacionModo;
  estado: BillingControlEstado;
  invoice_id: string | null;
  invoice_kind: InvoiceKind | null;
  invoice_status: string | null;
  cbte_tipo: number | null;
  pto_vta: number | null;
  cbte_nro: number | null;
  imp_total: number | null;
  /** Comprobante externo declarado por el admin, si la marcó como facturada afuera. */
  external_ref: string | null;
  /** Se cobró por tarjeta/transferencia/MP: facturarla no es opcional (mig 83). */
  bancario: boolean;
};

/** Cuánto queda sin facturar, para el badge del admin (mig 82). */
export type BillingPendingCounts = {
  falta: number;
  pendiente_consolidada: number;
  dias: number;
};

/** Datos para emitir una factura consolidada (pantalla del admin). */
export type ConsolidatedInvoicePayload = {
  kind: CtaCteClientKind;
  clientId: string;
  reservationIds: string[];
  /** Receptor: si se omite, sale de la ficha del cliente. */
  cuit?: string;
  condicionIva?: ReceptorCondicionCuit;
  razonSocial?: string;
  domicilio?: string;
};

/** Resultado de emitInvoice para la UI (toast + acción). */
export type EmitInvoiceOutcome = {
  status: "authorized" | "rejected" | "pending" | "processing";
  invoiceId: string | null;
  cae?: string;
  numero?: string;
  userMessage: string;
};
