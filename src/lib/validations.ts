import { z } from "zod";

import { isValidCuit } from "./arca/amounts";

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

// Id opcional (huesped del padron / pasajero de la empresa): vacio -> undefined; si viene, uuid.
const optionalUuid = (msg: string) =>
  z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid(msg).optional()
  );

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

const optionalGuestText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().max(120, "Maximo 120 caracteres.").optional()
);

// Cliente ocasional (modo manual): nombre y apellido separados + DNI obligatorio.
const clientFirstNameSchema = z
  .string()
  .trim()
  .min(2, "El nombre debe tener al menos 2 caracteres.")
  .max(120, "Maximo 120 caracteres.");
const clientLastNameSchema = z
  .string()
  .trim()
  .min(2, "El apellido debe tener al menos 2 caracteres.")
  .max(120, "Maximo 120 caracteres.");
const clientDniSchema = z
  .string()
  .trim()
  .min(6, "El DNI o CUIT debe tener al menos 6 caracteres.")
  .max(60, "Maximo 60 caracteres.");

// Datos del pasajero real: obligatorios cuando la reserva va a nombre de un asociado.
const requiredPassengerName = z
  .string()
  .trim()
  .min(2, "El nombre del pasajero es obligatorio.")
  .max(120, "Maximo 120 caracteres.");
const requiredPassengerDni = z
  .string()
  .trim()
  .min(6, "El DNI/CUIT del pasajero es obligatorio (minimo 6 caracteres).")
  .max(60, "Maximo 60 caracteres.");

const optionalDateText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().max(20).optional()
);

/** Campos opcionales del registro de huespedes (libro de pasajeros). */
const guestRegistrySchemaFields = {
  guestProfession: optionalGuestText,
  guestAddress: optionalGuestText,
  guestLocality: optionalGuestText,
  guestNationality: optionalGuestText,
  guestDocType: optionalGuestText,
  guestBirthDate: optionalDateText,
  guestVehicle: optionalGuestText,
};

const walkInBaseSchema = {
  roomId: z.number().int().positive("El ID de la habitacion es invalido."),
  nights: z
    .number()
    .int()
    .min(1, "Debe ser al menos 1 noche")
    .max(30, "Maximo 30 noches por reserva."),
  guestCount: guestCountSchema,
  stayType: z.enum(["night", "half_day"]).optional(),
  ...guestRegistrySchemaFields,
};

// Check-in directo: persona (huesped) o empresa (con pasajero real).
export const assignWalkInSchema = z.discriminatedUnion("mode", [
  z.object({
    ...walkInBaseSchema,
    mode: z.literal("person"),
    guestId: optionalUuid("El huesped seleccionado es invalido."),
    clientFirstName: clientFirstNameSchema,
    clientLastName: clientLastNameSchema,
    clientDni: clientDniSchema,
  }),
  z.object({
    ...walkInBaseSchema,
    mode: z.literal("company"),
    associatedClientId: associatedClientIdSchema,
    companyPassengerId: optionalUuid("El pasajero seleccionado es invalido."),
    passengerName: requiredPassengerName,
    passengerDni: requiredPassengerDni,
  }),
]);

const checkInOutFields = {
  roomId: z.number().int().positive("El ID de la habitacion es invalido."),
  checkIn: z.string().datetime({ message: "La fecha de entrada es invalida." }),
  checkOut: z.string().datetime({ message: "La fecha de salida es invalida." }),
  guestCount: guestCountSchema,
  ...guestRegistrySchemaFields,
};

// La reserva es PERSONA (huesped) o EMPRESA (con pasajero real).
export const createReservationSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("person"),
      guestId: optionalUuid("El huesped seleccionado es invalido."),
      clientFirstName: clientFirstNameSchema,
      clientLastName: clientLastNameSchema,
      clientDni: clientDniSchema,
      clientPhone: optionalPhoneSchema,
      ...checkInOutFields,
    }),
    z.object({
      mode: z.literal("company"),
      associatedClientId: associatedClientIdSchema,
      companyPassengerId: optionalUuid("El pasajero seleccionado es invalido."),
      passengerName: requiredPassengerName,
      passengerDni: requiredPassengerDni,
      passengerPhone: optionalPhoneSchema,
      ...checkInOutFields,
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
  condicionIva: z
    .preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.enum(["responsable_inscripto", "monotributo", "consumidor_final"]).optional()
    ),
  domicilio: z
    .preprocess(
      (value) => {
        if (typeof value !== "string") return value;
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
      },
      z.string().max(200, "El domicilio no puede superar los 200 caracteres.").optional()
    ),
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

export const reportShiftConflictSchema = z.object({
  reservationId: z.string().uuid("El identificador de la reserva es invalido."),
  notes: z
    .string()
    .trim()
    .min(5, "Explica el conflicto en la nota (minimo 5 caracteres).")
    .max(500, "La nota no puede superar los 500 caracteres."),
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


// ─────────────────────── Facturación electrónica ARCA ───────────────────────

/** Config fiscal (panel admin). Si enabled=true, exige la config completa. */
export const fiscalSettingsSchema = z
  .object({
    enabled: z.boolean(),
    environment: z.enum(["homologacion", "produccion"], {
      message: "El ambiente debe ser homologacion o produccion.",
    }),
    cuit: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/\D/g, "") : v),
      z
        .string()
        .refine((v) => v === "" || (v.length === 11 && isValidCuit(v)), {
          message: "El CUIT no es valido (11 digitos con digito verificador).",
        })
    ),
    razon_social: z.string().trim().max(200, "Maximo 200 caracteres."),
    domicilio_fiscal: z.string().trim().max(300, "Maximo 300 caracteres."),
    iibb: z.string().trim().max(60, "Maximo 60 caracteres."),
    inicio_actividades: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), {
        message: "La fecha de inicio de actividades debe ser AAAA-MM-DD.",
      }),
    punto_venta: z.preprocess(
      (v) => {
        if (typeof v !== "string" || v.trim() === "") return undefined;
        return Number(v.trim());
      },
      z
        .number()
        .int("El punto de venta debe ser un numero entero.")
        .min(1, "El punto de venta debe ser 1 o mayor.")
        .max(99998, "El punto de venta no puede superar 99998.")
        .optional()
    ),
  })
  .superRefine((data, ctx) => {
    if (!data.enabled) return;
    if (!data.cuit) {
      ctx.addIssue({ code: "custom", path: ["cuit"], message: "Para habilitar la facturacion falta el CUIT." });
    }
    if (!data.razon_social) {
      ctx.addIssue({ code: "custom", path: ["razon_social"], message: "Para habilitar la facturacion falta la razon social." });
    }
    if (data.punto_venta === undefined) {
      ctx.addIssue({ code: "custom", path: ["punto_venta"], message: "Para habilitar la facturacion falta el punto de venta." });
    }
  });
