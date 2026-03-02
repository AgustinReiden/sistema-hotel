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

  if (error instanceof Error) {
    return { error: error.message || fallbackMessage };
  }

  if (isErrorWithMessage(error)) {
    const message =
      error.message ??
      [error.details, error.hint].filter(Boolean).join(" - ") ??
      fallbackMessage;
    return { error: message || fallbackMessage, code: error.code };
  }

  return { error: fallbackMessage };
}
