import "server-only";

import { translateCancelReason, type Language } from "./cancel-reasons";
import {
  renderConfirmationMessageTemplate,
  type ConfirmationTemplateData,
} from "./message-templates";

export type { Language, CancelReasonKey } from "./cancel-reasons";

export type ReservationMessageData = ConfirmationTemplateData;

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

export function buildConfirmationMessage(
  lang: Language,
  data: ReservationMessageData,
  template?: string | null
): string {
  return renderConfirmationMessageTemplate(lang, data, template);
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
