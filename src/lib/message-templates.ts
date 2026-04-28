import type { Language } from "./cancel-reasons";

export type ConfirmationTemplateData = {
  client_name: string;
  room_type: string;
  room_number: string;
  check_in: string;
  check_out: string;
  total_price: number;
  hotel_phone: string;
};

export const CONFIRMATION_HELP_PHONE = "+54 9 364 438-6455";

export const DEFAULT_CONFIRMATION_MESSAGE_TEMPLATE_ES =
  `✅ *¡Reserva confirmada!*\n\n` +
  `Hola {nombre}, qué alegría recibirte. Ya dejamos todo reservado para tu estadía:\n\n` +
  `🏨 Habitación: {habitacion} (Nro {numero_habitacion})\n` +
  `📅 Llegada: {llegada}\n` +
  `📅 Salida: {salida}\n` +
  `💰 Total: {total}\n\n` +
  `Si necesitás algo antes de llegar, escribinos por WhatsApp al {telefono_consultas}.\n\n` +
  `¡Te esperamos con todo listo! 🙌`;

export const DEFAULT_CONFIRMATION_MESSAGE_TEMPLATE_PT =
  `✅ *Reserva confirmada!*\n\n` +
  `Olá {nombre}, que alegria receber você. Já deixamos tudo reservado para sua estadia:\n\n` +
  `🏨 Quarto: {habitacion} (Nº {numero_habitacion})\n` +
  `📅 Entrada: {llegada}\n` +
  `📅 Saída: {salida}\n` +
  `💰 Total: {total}\n\n` +
  `Se precisar de algo antes de chegar, fale com a gente pelo {telefono_consultas}.\n\n` +
  `Esperamos por você com tudo pronto! 🙌`;

export const DEFAULT_CONFIRMATION_MESSAGE_TEMPLATE = DEFAULT_CONFIRMATION_MESSAGE_TEMPLATE_ES;

export const CONFIRMATION_MESSAGE_PLACEHOLDERS = [
  { token: "{nombre}", label: "Huésped" },
  { token: "{habitacion}", label: "Tipo de habitación" },
  { token: "{numero_habitacion}", label: "Número" },
  { token: "{llegada}", label: "Llegada" },
  { token: "{salida}", label: "Salida" },
  { token: "{total}", label: "Total" },
  { token: "{telefono_consultas}", label: "WhatsApp dudas" },
] as const;

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

export function getDefaultConfirmationMessageTemplate(lang: Language): string {
  return lang === "pt"
    ? DEFAULT_CONFIRMATION_MESSAGE_TEMPLATE_PT
    : DEFAULT_CONFIRMATION_MESSAGE_TEMPLATE_ES;
}

export function renderConfirmationMessageTemplate(
  lang: Language,
  data: ConfirmationTemplateData,
  template?: string | null
): string {
  const checkIn = formatDateForLang(data.check_in, lang);
  const checkOut = formatDateForLang(data.check_out, lang);
  const price = formatPrice(data.total_price);
  const source = template?.trim() || getDefaultConfirmationMessageTemplate(lang);
  const hotelPhone = data.hotel_phone.trim() || CONFIRMATION_HELP_PHONE;
  const replacements: Record<string, string> = {
    nombre: data.client_name,
    habitacion: data.room_type,
    numero_habitacion: data.room_number,
    llegada: checkIn,
    salida: checkOut,
    total: `$${price}`,
    telefono_consultas: CONFIRMATION_HELP_PHONE,
    telefono_hotel: hotelPhone,
    client_name: data.client_name,
    room_type: data.room_type,
    room_number: data.room_number,
    check_in: checkIn,
    check_out: checkOut,
    total_price: `$${price}`,
    hotel_phone: hotelPhone,
  };

  return source.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    return replacements[key] ?? match;
  });
}
