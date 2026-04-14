export type UserRole = "admin" | "receptionist" | "client";

export type RoomStatus = "available" | "occupied" | "maintenance" | "cleaning";

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
  room_id: number;
  status: ReservationStatus;
  actual_check_in: string | null;
  actual_check_out: string | null;
  base_total_price: number;
  discount_percent: number;
  discount_amount: number;
  total_price: number;
  paid_amount: number;
  whatsapp_notified: boolean;
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
    }
  | {
      customerMode: "associated";
      roomId: number;
      associatedClientId: string;
      checkIn: string;
      checkOut: string;
    };

export type AssignWalkInPayload =
  | {
      customerMode: "manual";
      roomId: number;
      clientName: string;
      nights: number;
    }
  | {
      customerMode: "associated";
      roomId: number;
      nights: number;
      associatedClientId: string;
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
