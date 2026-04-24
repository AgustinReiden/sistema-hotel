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

export type CleaningType = "limpia_ocupada" | "limpia_vacia" | "limpia_repaso";

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
  contact_email: string;
  contact_phone: string;
  contact_whatsapp_phone?: string | null;
  contact_fixed_phone?: string | null;
  address: string;
  hero_title: string;
  hero_subtitle: string;
  hero_image_url?: string | null;
  services_image_url?: string | null;
  logo_url?: string | null;
  contact_instagram?: string | null;
};

export type Guest = {
  id: string;
  client_name: string;
  status: ReservationStatus;
  check_in_target: string;
  check_out_target: string;
  room_number: string;
  total_price: number;
  paid_amount: number;
};

export type AssociatedClient = {
  id: string;
  display_name: string;
  document_id: string;
  phone: string | null;
  discount_percent: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ReservationCustomerMode = "manual" | "associated";

export type CreateReservationPayload =
  | {
      customerMode: "manual";
      roomId: number;
      clientName: string;
      clientDni: string;
      clientPhone?: string;
      checkIn: string;
      checkOut: string;
      guestCount?: number;
    }
  | {
      customerMode: "associated";
      roomId: number;
      associatedClientId: string;
      checkIn: string;
      checkOut: string;
      guestCount?: number;
    };

export type AssignWalkInPayload =
  | {
      customerMode: "manual";
      roomId: number;
      clientName: string;
      nights: number;
      guestCount?: number;
    }
  | {
      customerMode: "associated";
      roomId: number;
      nights: number;
      associatedClientId: string;
      guestCount?: number;
    };

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
  totalsByMethod: Record<PaymentMethod, number>;
  totalIncome: number;
  cashIncome: number;
  payments: ShiftPaymentRow[];
  openedByEmail: string | null;
  closedByEmail: string | null;
};

export type CloseShiftPayload = { shiftId: string; actualCash: number; notes?: string };
