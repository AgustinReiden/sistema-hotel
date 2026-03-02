import { z } from "zod";

export const assignWalkInSchema = z.object({
  roomId: z.number().int().positive("El ID de la habitacion es invalido."),
  clientName: z
    .string()
    .trim()
    .min(2, "El nombre del huesped debe tener al menos 2 caracteres."),
  nights: z
    .number()
    .int()
    .min(1, "Debe ser al menos 1 noche")
    .max(30, "Maximo 30 noches por reserva."),
});

export const createReservationSchema = z
  .object({
    roomId: z.number().int().positive("El ID de la habitacion es invalido."),
    clientName: z
      .string()
      .trim()
      .min(2, "El nombre del huesped debe tener al menos 2 caracteres."),
    checkIn: z.string().datetime({ message: "La fecha de entrada es invalida." }),
    checkOut: z.string().datetime({ message: "La fecha de salida es invalida." }),
  })
  .refine((data) => new Date(data.checkIn) < new Date(data.checkOut), {
    message: "La fecha de salida debe ser posterior a la fecha de entrada.",
    path: ["checkOut"],
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
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "La moneda debe ser un codigo ISO de 3 letras (ej. USD, ARS).")
    .transform((value) => value.toUpperCase()),
  contact_email: z.string().optional().nullable(),
  contact_phone: z.string().min(5, "El teléfono debe tener al menos 5 caracteres."),
  contact_instagram: z.string().optional().nullable(),
  address: z.string().min(5, "La dirección debe tener al menos 5 caracteres."),
  hero_title: z.string().min(5, "El título principal debe tener al menos 5 caracteres."),
  hero_subtitle: z.string().min(5, "El subtítulo debe tener al menos 5 caracteres."),
  hero_image_url: z.string().url("Debe ser una URL válida.").or(z.string().startsWith('/', 'Debe empezar con /')).optional().nullable(),
  services_image_url: z.string().url("Debe ser una URL válida.").or(z.string().startsWith('/', 'Debe empezar con /')).optional().nullable(),
  logo_url: z.string().url("Debe ser una URL válida.").or(z.string().startsWith('/', 'Debe empezar con /')).optional().nullable(),
});
