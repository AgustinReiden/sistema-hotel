"use server";

import { revalidatePath } from "next/cache";

import {
  addExtraCharge,
  applyLateCheckOut,
  assignWalkIn,
  cancelReservation,
  changeReservationRoom,
  confirmReservation,
  doCheckIn,
  doCheckout,
  extendReservation,
  getHotelSettings,
  getReservationForEdit,
  getReservationWithRoom,
  getRoomsAvailableForReservation,
  markRoomAsAvailable,
  staffCreateReservation,
  updateReservation,
  updateWhatsappStatus,
  type ReservationEditableRow,
  type UpdateReservationInput,
} from "@/lib/data";
import { parseActionError } from "@/lib/error-utils";
import { notifyReservationWebhook } from "@/lib/webhook";
import type {
  ActionResult,
  AssignWalkInPayload,
  CreateReservationPayload,
  PaymentMethod,
  Room,
} from "@/lib/types";
import { assignWalkInSchema, createReservationSchema } from "@/lib/validations";

type CheckoutPayload = {
  reservationId: string;
  paymentAmount?: number;
  paymentMethod?: PaymentMethod;
  paymentNotes?: string;
};

function revalidateCalendarViews() {
  revalidatePath("/admin/calendario");
  revalidatePath("/admin/timeline");
}

export async function handleLateCheckOut(reservationId: string): Promise<ActionResult> {
  try {
    await applyLateCheckOut(reservationId);
    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/caja");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al cobrar medio dia.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleCheckIn(reservationId: string): Promise<ActionResult> {
  try {
    await doCheckIn(reservationId);
    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al realizar el check-in.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleSetMaintenance(roomId: number): Promise<ActionResult> {
  try {
    const supabase = (await import("@/lib/supabase/server")).createClient;
    const client = await supabase();
    const { error } = await client.rpc("rpc_set_room_maintenance", { p_room_id: roomId });
    if (error) throw error;
    revalidatePath("/admin");
    revalidateCalendarViews();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al poner habitación en mantenimiento.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleCheckOut({
  reservationId,
  paymentAmount,
  paymentMethod,
  paymentNotes,
}: CheckoutPayload): Promise<ActionResult> {
  try {
    await doCheckout({
      reservationId,
      paymentAmount,
      paymentMethod,
      paymentNotes,
    });
    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/caja");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al ejecutar check-out.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleMarkAvailable(roomId: number): Promise<ActionResult> {
  try {
    await markRoomAsAvailable(roomId);
    revalidatePath("/admin");
    revalidateCalendarViews();
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al marcar habitacion disponible.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleAssignWalkIn(
  data: AssignWalkInPayload
): Promise<ActionResult<{ reservationId: string }>> {
  try {
    const validated = assignWalkInSchema.parse(data);
    const reservationId = await assignWalkIn(validated);

    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");

    return { success: true, data: { reservationId } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al asignar la habitacion.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleCreateReservation(
  data: CreateReservationPayload
): Promise<ActionResult<{ reservationId: string }>> {
  try {
    const validated = createReservationSchema.parse(data);
    const reservationId = await staffCreateReservation(validated);

    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");

    return { success: true, data: { reservationId } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al crear la reserva.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleCancelReservation(
  reservationId: string,
  reason: string
): Promise<ActionResult<{ whatsappSent: boolean }>> {
  try {
    // 1. Obtener datos antes de cancelar (para el webhook)
    const reservation = await getReservationWithRoom(reservationId);
    const settings = await getHotelSettings();

    // 2. Cancelar la reserva
    await cancelReservation(reservationId, reason);

    // 3. Enviar notificación WhatsApp
    let whatsappSent = false;
    if (reservation.client_phone) {
      const result = await notifyReservationWebhook({
        reservation_id: reservationId,
        status: "cancelled",
        client_name: reservation.client_name,
        client_phone: reservation.client_phone,
        client_dni: reservation.client_dni,
        room_type: reservation.room_type,
        room_number: reservation.room_number,
        check_in: reservation.check_in_target,
        check_out: reservation.check_out_target,
        total_price: Number(reservation.total_price) || 0,
        hotel_phone: settings.contact_phone || "",
      });
      whatsappSent = result.success;
      await updateWhatsappStatus(reservationId, whatsappSent);
    }

    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/solicitudes");
    return { success: true, data: { whatsappSent } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al cancelar la reserva.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleConfirmReservation(
  reservationId: string
): Promise<ActionResult<{ whatsappSent: boolean }>> {
  try {
    // 1. Confirmar la reserva (RPC retorna datos)
    const data = await confirmReservation(reservationId);
    const settings = await getHotelSettings();

    // 2. Enviar notificación WhatsApp
    let whatsappSent = false;
    const clientPhone = data.client_phone as string | null;
    if (clientPhone) {
      const result = await notifyReservationWebhook({
        reservation_id: reservationId,
        status: "confirmed",
        client_name: (data.client_name as string) || "",
        client_phone: clientPhone,
        client_dni: (data.client_dni as string) || null,
        room_type: (data.room_type as string) || "",
        room_number: (data.room_number as string) || "",
        check_in: (data.check_in_target as string) || "",
        check_out: (data.check_out_target as string) || "",
        total_price: Number(data.total_price) || 0,
        hotel_phone: settings.contact_phone || "",
      });
      whatsappSent = result.success;
      await updateWhatsappStatus(reservationId, whatsappSent);
    }

    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");
    revalidatePath("/admin/solicitudes");
    return { success: true, data: { whatsappSent } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al confirmar la reserva.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleResendWhatsapp(
  reservationId: string
): Promise<ActionResult<{ whatsappSent: boolean }>> {
  try {
    const reservation = await getReservationWithRoom(reservationId);
    const settings = await getHotelSettings();

    if (!reservation.client_phone) {
      return { success: false, error: "La reserva no tiene teléfono registrado." };
    }

    const result = await notifyReservationWebhook({
      reservation_id: reservationId,
      status: reservation.status,
      client_name: reservation.client_name,
      client_phone: reservation.client_phone,
      client_dni: reservation.client_dni,
      room_type: reservation.room_type,
      room_number: reservation.room_number,
      check_in: reservation.check_in_target,
      check_out: reservation.check_out_target,
      total_price: Number(reservation.total_price) || 0,
      hotel_phone: settings.contact_phone || "",
    });

    await updateWhatsappStatus(reservationId, result.success);

    revalidatePath("/admin/solicitudes");
    return { success: true, data: { whatsappSent: result.success } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al reenviar el mensaje.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleExtendReservation(reservationId: string, nights: number): Promise<ActionResult> {
  try {
    if (nights <= 0) throw new Error("Debe agregar al menos 1 noche.");
    await extendReservation(reservationId, nights);
    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/caja");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al ampliar la reserva.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleAddExtraCharge(
  reservationId: string,
  chargeType: string,
  amount: number,
  description?: string
): Promise<ActionResult> {
  try {
    if (!reservationId) throw new Error("Reserva invalida.");
    if (!chargeType) throw new Error("El tipo de cargo es obligatorio.");
    if (!amount || amount <= 0) throw new Error("El monto debe ser mayor a 0.");
    await addExtraCharge(reservationId, chargeType, amount, description);
    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/caja");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al cargar el extra.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleLoadAvailableRoomsForReservation(
  reservationId: string
): Promise<ActionResult<{ rooms: Room[]; currentRoomId: number }>> {
  try {
    if (!reservationId) throw new Error("Reserva invalida.");
    const { rooms, currentRoomId } = await getRoomsAvailableForReservation(reservationId);
    return { success: true, data: { rooms, currentRoomId } };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudieron cargar las habitaciones disponibles.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleLoadReservationForEdit(
  reservationId: string
): Promise<ActionResult<ReservationEditableRow>> {
  try {
    if (!reservationId) throw new Error("Reserva invalida.");
    const row = await getReservationForEdit(reservationId);
    if (!row) throw new Error("Reserva no encontrada.");
    return { success: true, data: row };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo cargar la reserva.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleUpdateReservation(
  input: UpdateReservationInput
): Promise<
  ActionResult<{
    total_price: number;
    base_total_price: number;
    discount_percent: number;
    discount_amount: number;
    dates_changed: boolean;
    price_overridden: boolean;
  }>
> {
  try {
    if (!input.reservationId) throw new Error("Reserva invalida.");
    if (!input.clientName?.trim()) throw new Error("El nombre es obligatorio.");
    if (!input.checkIn || !input.checkOut) throw new Error("Fechas obligatorias.");
    if (new Date(input.checkOut) <= new Date(input.checkIn))
      throw new Error("La salida debe ser posterior a la entrada.");
    const result = await updateReservation(input);
    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/caja");
    return { success: true, data: result };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "No se pudo actualizar la reserva.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}

export async function handleChangeRoom(
  reservationId: string,
  newRoomId: number
): Promise<ActionResult> {
  try {
    if (!reservationId) throw new Error("Reserva invalida.");
    if (!Number.isInteger(newRoomId) || newRoomId <= 0)
      throw new Error("Habitacion destino invalida.");
    await changeReservationRoom(reservationId, newRoomId);
    revalidatePath("/admin");
    revalidateCalendarViews();
    revalidatePath("/admin/guests");
    revalidatePath("/admin/caja");
    return { success: true };
  } catch (error: unknown) {
    const parsed = parseActionError(error, "Error al cambiar de habitacion.");
    return { success: false, error: parsed.error, code: parsed.code };
  }
}
