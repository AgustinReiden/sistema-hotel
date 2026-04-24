import "server-only";

import { translateCancelReason, type Language } from "./cancel-reasons";

export type { Language, CancelReasonKey } from "./cancel-reasons";

export type ReservationMessageData = {
  client_name: string;
  room_type: string;
  room_number: string;
  check_in: string;
  check_out: string;
  total_price: number;
  hotel_phone: string;
};

export function deriveLanguage(countryCode: string): Language {
  if (countryCode === "55") return "pt";
  return "es";
}

export function deriveLanguageFromPhone(phone: string | null | undefined): Language {
  if (!phone) return "es";
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55")) return "pt";
  return "es";
}

function formatDateForLang(iso: string, lang: Language): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const locale = lang === "pt" ? "pt-BR" : "es-AR";
  return date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatPrice(amount: number): string {
  return amount.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

export function buildConfirmationMessage(
  lang: Language,
  data: ReservationMessageData
): string {
  const checkIn = formatDateForLang(data.check_in, lang);
  const checkOut = formatDateForLang(data.check_out, lang);
  const price = formatPrice(data.total_price);

  if (lang === "pt") {
    return (
      `✅ *Reserva Confirmada*\n\n` +
      `Olá ${data.client_name}, sua reserva foi confirmada:\n\n` +
      `🏨 Quarto: ${data.room_type} (Nº ${data.room_number})\n` +
      `📅 Check-in: ${checkIn}\n` +
      `📅 Check-out: ${checkOut}\n` +
      `💰 Total: $${price}\n\n` +
      `Esperamos por você! 🙌`
    );
  }

  return (
    `✅ *Reserva Confirmada*\n\n` +
    `Hola ${data.client_name}, tu reserva ha sido confirmada:\n\n` +
    `🏨 Habitación: ${data.room_type} (Nro ${data.room_number})\n` +
    `📅 Check-in: ${checkIn}\n` +
    `📅 Check-out: ${checkOut}\n` +
    `💰 Total: $${price}\n\n` +
    `¡Te esperamos! 🙌`
  );
}

export function buildCancellationMessage(
  lang: Language,
  data: ReservationMessageData,
  reason: string
): string {
  const translatedReason = translateCancelReason(reason, lang);

  if (lang === "pt") {
    return (
      `❌ *Reserva Cancelada*\n\n` +
      `Olá ${data.client_name}, lamentamos informar que sua reserva foi cancelada.\n\n` +
      `Motivo: ${translatedReason}\n\n` +
      `Para reagendar sua reserva, entre em contato conosco pelo ${data.hotel_phone}.`
    );
  }

  return (
    `❌ *Reserva Cancelada*\n\n` +
    `Hola ${data.client_name}, lamentamos informarte que tu reserva fue cancelada.\n\n` +
    `Motivo: ${translatedReason}\n\n` +
    `Para reprogramar tu reserva, comunicate con nosotros al ${data.hotel_phone}.`
  );
}
