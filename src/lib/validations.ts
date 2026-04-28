import { z } from "zod";

const optionalPhoneSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z
    .string()
    .trim()
    .min(8, "El telefono debe tener al menos 8 digitos.")
    .regex(/^[\d\s\-+()]+$/, "El telefono contiene caracteres invalidos.")
    .optional()
);

const optionalTextAsNull = (maxLength = 500) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    },
    z.string().max(maxLength, `No puede superar los ${maxLength} caracteres.`).nullable()
  );

const optionalEmailAsNull = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  },
  z.string().email("El email de contacto no es valido.").nullable()
);

const optionalContactPhoneAsNull = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  },
  z
    .string()
    .min(5, "El telefono debe tener al menos 5 caracteres.")
    .regex(/^[\d\s\-+()]+$/, "El telefono contiene caracteres invalidos.")
    .nullable()
);

const associatedClientIdSchema = z.string().uuid("El asociado seleccionado es invalido.");

const percentageSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return value;
      return Number(trimmed);
    }
    return value;
  },
  z
    .number()
    .min(0, "El descuento no puede ser negativo.")
    .max(100, "El descuento no puede superar el 100%.")
);

const guestCountSchema = z
  .preprocess((v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    if (typeof v === "string") return Number(v);
    return v;
  }, z.number().int().min(1, "La cantidad de pasajeros debe ser al menos 1.").max(20, "Maximo 20 pasajeros por reserva."))
  .optional();

const walkInBaseSchema = {
  customerMode: z.enum(["manual", "associated"]),
  roomId: z.number().int().positive("El ID de la habitacion es invalido."),
  nights: z
    .number()
    .int()
    .min(1, "Debe ser al menos 1 noche")
    .max(30, "Maximo 30 noches por reserva."),
  guestCount: guestCountSchema,
};

export const assignWalkInSchema = z.discriminatedUnion("customerMode", [
  z.object({
    ...walkInBaseSchema,
    customerMode: z.literal("manual"),
    clientName: z
      .string()
      .trim()
      .min(2, "El nombre del huesped debe tener al menos 2 caracteres."),
  }),
  z.object({
    ...walkInBaseSchema,
    customerMode: z.literal("associated"),
    associatedClientId: associatedClientIdSchema,
  }),
]);

export const createReservationSchema = z
  .discriminatedUnion("customerMode", [
    z.object({
      customerMode: z.literal("manual"),
      roomId: z.number().int().positive("El ID de la habitacion es invalido."),
      clientName: z
        .string()
        .trim()
        .min(2, "El nombre del huesped debe tener al menos 2 caracteres."),
      clientDni: z
        .string()
        .trim()
        .min(6, "El DNI o CUIT debe tener al menos 6 caracteres."),
      clientPhone: optionalPhoneSchema,
      checkIn: z.string().datetime({ message: "La fecha de entrada es invalida." }),
      checkOut: z.string().datetime({ message: "La fecha de salida es invalida." }),
      guestCount: guestCountSchema,
    }),
    z.object({
      customerMode: z.literal("associated"),
      roomId: z.number().int().positive("El ID de la habitacion es invalido."),
      associatedClientId: associatedClientIdSchema,
      checkIn: z.string().datetime({ message: "La fecha de entrada es invalida." }),
      checkOut: z.string().datetime({ message: "La fecha de salida es invalida." }),
      guestCount: guestCountSchema,
    }),
  ])
  .refine((data) => new Date(data.checkIn) < new Date(data.checkOut), {
    message: "La fecha de salida debe ser posterior a la fecha de entrada.",
    path: ["checkOut"],
  });

export const associatedClientSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "El nombre del asociado debe tener al menos 2 caracteres."),
  documentId: z
    .string()
    .trim()
    .min(6, "El DNI o CUIT debe tener al menos 6 caracteres."),
  phone: optionalPhoneSchema,
  discountPercent: percentageSchema,
  notes: z
    .preprocess(
      (value) => {
        if (typeof value !== "string") return value;
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
      },
      z.string().max(500, "Las notas no pueden superar los 500 caracteres.").optional()
    ),
});

const currencyAmount = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return undefined;
      return Number(trimmed.replace(",", "."));
    }
    return value;
  },
  z
    .number()
    .refine((v) => !Number.isNaN(v), { message: "El monto debe ser numerico." })
    .min(0, "El monto no puede ser negativo.")
);

export const closeShiftSchema = z.object({
  shiftId: z.string().uuid("El identificador del turno es invalido."),
  actualCash: currencyAmount,
  notes: z
    .preprocess(
      (value) => {
        if (typeof value !== "string") return value;
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
      },
      z.string().max(500, "Las notas no pueden superar los 500 caracteres.").optional()
    ),
});

export const SUPPORTED_PHONE_COUNTRY_CODES = [
  "54",
  "55",
  "598",
  "56",
  "595",
  "591",
] as const;

export const publicBookingSchema = z.object({
  roomType: z
    .string()
    .trim()
    .min(1, "La categoria de habitacion es obligatoria."),
  clientName: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres."),
  clientDni: z
    .string()
    .trim()
    .min(6, "El DNI o CUIT debe tener al menos 6 caracteres."),
  phoneCountryCode: z.enum(SUPPORTED_PHONE_COUNTRY_CODES, {
    message: "Selecciona un prefijo de pais valido.",
  }),
  phoneLocal: z
    .string()
    .trim()
    .regex(/^\d{6,14}$/, "El telefono debe tener entre 6 y 14 digitos."),
  checkIn: z.string().min(1, "La fecha de entrada es requerida."),
  checkOut: z.string().min(1, "La fecha de salida es requerida."),
});

export const hotelSettingsSchema = z.object({
  name: z.string().trim().min(3, "El nombre del hotel debe tener al menos 3 caracteres."),
  standard_check_in_time: z
    .string()
    .regex(
      /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/,
      "Formato de hora invalido (HH:MM o HH:MM:SS)"
    ),
  standard_check_out_time: z
    .string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/, "Formato de hora invalido"),
  late_check_out_time: z
    .string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/, "Formato de hora invalido"),
  timezone: z
    .string()
    .min(1, "La zona horaria es obligatoria."),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "La moneda debe ser un codigo ISO de 3 letras (ej. USD, ARS).")
    .transform((value) => value.toUpperCase()),
  contact_email: optionalEmailAsNull,
  contact_phone: optionalContactPhoneAsNull,
  contact_whatsapp_phone: optionalContactPhoneAsNull,
  contact_fixed_phone: optionalContactPhoneAsNull,
  contact_instagram: optionalTextAsNull(120),
  address: optionalTextAsNull(250).refine(
    (value) => value === null || value.length >= 5,
    "La direccion debe tener al menos 5 caracteres."
  ),
  hero_title: z.string().min(5, "El titulo principal debe tener al menos 5 caracteres."),
  hero_subtitle: z.string().min(5, "El subtitulo debe tener al menos 5 caracteres."),
  hero_image_url: z.string().url("Debe ser una URL valida.").or(z.string().startsWith("/", "Debe empezar con /")).optional().nullable(),
  services_image_url: z.string().url("Debe ser una URL valida.").or(z.string().startsWith("/", "Debe empezar con /")).optional().nullable(),
  logo_url: z.string().url("Debe ser una URL valida.").or(z.string().startsWith("/", "Debe empezar con /")).optional().nullable(),
  confirmation_message_template: optionalTextAsNull(2000).optional(),
});
