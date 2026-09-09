import { ZodError } from "zod";

type MaybeErrorWithMessage = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function isErrorWithMessage(error: unknown): error is MaybeErrorWithMessage {
  return typeof error === "object" && error !== null;
}

// SQLSTATEs cuyo mensaje crudo es técnico y no debe mostrarse al recepcionista.
// Las RPC del sistema lanzan mensajes en español con otros códigos (22023, 23P01,
// 42501, P0001), que SÍ se muestran tal cual.
const TECHNICAL_SQLSTATES = new Set([
  "23505", // unique_violation
  "23503", // foreign_key_violation
  "23502", // not_null_violation
  "23514", // check_violation
  "22P02", // invalid_text_representation
  "22003", // numeric_value_out_of_range
  "42703", // undefined_column
  "42P01", // undefined_table
  "42601", // syntax_error
  "42883", // undefined_function
  "08000",
  "08003",
  "08006", // connection
  "40001",
  "40P01", // serialization / deadlock
  "XX000", // internal_error
]);

// Denegacion de RLS pura (no de una RPC): Postgres la manda en ingles y con el nombre
// de la tabla adentro. Al recepcionista eso no le dice nada.
const RLS_DENIED_MESSAGE = "No tenés permiso para hacer esta operación.";

const GENERIC_MESSAGE =
  "Ocurrió un error inesperado al procesar la operación. Probá de nuevo; si persiste, avisá al administrador.";

export function parseActionError(
  error: unknown,
  fallbackMessage: string
): { error: string; code?: string } {
  if (error instanceof ZodError) {
    return {
      error: error.issues[0]?.message ?? fallbackMessage,
      code: "VALIDATION_ERROR",
    };
  }

  if (isErrorWithMessage(error)) {
    const code = typeof error.code === "string" ? error.code : undefined;

    // 42501 llega por dos caminos distintos y solo uno se enmascara: el de la RLS
    // ("new row violates row-level security policy for table ..."). El otro es el
    // `RAISE 'Acceso denegado'` de las RPC del sistema, que ya viene en castellano.
    if (code === "42501" && /row-level security/i.test(String(error.message ?? ""))) {
      console.error("[parseActionError] Escritura bloqueada por RLS:", error.message);
      return { error: RLS_DENIED_MESSAGE, code };
    }

    // Error técnico de Postgres: ocultar el detalle crudo, loguear el real.
    if (code && TECHNICAL_SQLSTATES.has(code)) {
      console.error("[parseActionError] Error técnico de DB:", code, error.message);
      return { error: GENERIC_MESSAGE, code };
    }

    if (error instanceof Error) {
      // PostgrestError extiende Error y trae el SQLSTATE en `code`: propagarlo
      // para que el front pueda discriminar (P0003 caja cerrada, P0011 salidas
      // vencidas, P0012 nota obligatoria) sin depender de regex sobre el mensaje.
      return { error: error.message || fallbackMessage, code };
    }

    const message =
      error.message ??
      [error.details, error.hint].filter(Boolean).join(" - ") ??
      fallbackMessage;
    return { error: message || fallbackMessage, code };
  }

  return { error: fallbackMessage };
}
