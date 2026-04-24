import "server-only";

const SUPPORTED_COUNTRY_CODES = ["54", "55", "598", "56", "595", "591"] as const;
export type CountryCode = (typeof SUPPORTED_COUNTRY_CODES)[number];

/**
 * Envía al webhook de n8n el mensaje ya armado. El workflow sólo hace forward a Evolution API.
 * No lanza errores — retorna { success: false } si falla para no romper el flujo principal.
 */
export async function notifyReservationWebhook(payload: {
  number: string;
  text: string;
}): Promise<{ success: boolean }> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn("[Webhook] N8N_WEBHOOK_URL no configurada");
    return { success: false };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[Webhook] Error HTTP ${response.status}: ${response.statusText}`);
      return { success: false };
    }

    const result = await response.json().catch(() => ({}));
    return { success: result.success !== false };
  } catch (error) {
    console.error("[Webhook] Error al enviar notificación:", error);
    return { success: false };
  }
}

/**
 * Formatea un número local al formato internacional que Evolution API requiere
 * (sólo dígitos, con prefijo país). Para Argentina inserta el "9" de móvil.
 *
 * - phone: número tal como lo tipeó el cliente (puede tener espacios, guiones, etc.)
 * - countryCode: prefijo de país explícito ("54" Arg, "55" Brasil, etc.)
 */
export function formatPhoneForWhatsapp(
  phone: string | null | undefined,
  countryCode: string
): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, "");
  if (!cleaned) return null;

  let normalized = cleaned;

  // Remove leading country code if already present (any of the supported ones).
  // Sort by length desc so "598" is tried before "59"/"5".
  const sortedPrefixes = [...SUPPORTED_COUNTRY_CODES].sort(
    (a, b) => b.length - a.length
  );
  for (const prefix of sortedPrefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }

  // Argentina: Evolution API exige el "9" de móvil tras el 54.
  if (countryCode === "54") {
    if (normalized.startsWith("9")) {
      return `54${normalized}`;
    }
    return `549${normalized}`;
  }

  return `${countryCode}${normalized}`;
}
