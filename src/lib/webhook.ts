import "server-only";

type WebhookPayload = {
  reservation_id: string;
  status: string;
  client_name: string;
  client_phone: string | null;
  client_dni: string | null;
  room_type: string;
  room_number: string;
  check_in: string;
  check_out: string;
  total_price: number;
  hotel_phone: string;
};

/**
 * Envía notificación al webhook de n8n para disparar el mensaje de WhatsApp.
 * El teléfono se envía con prefijo 549 (Argentina) si no lo tiene.
 * No lanza errores - retorna { success: false } si falla para no romper el flujo principal.
 */
export async function notifyReservationWebhook(
  payload: WebhookPayload
): Promise<{ success: boolean }> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn("[Webhook] N8N_WEBHOOK_URL no configurada");
    return { success: false };
  }

  // Formatear teléfono: agregar 549 si es número local argentino
  const formattedPhone = formatPhoneForWhatsapp(payload.client_phone);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        client_phone: formattedPhone,
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout
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
 * Formatea un número de teléfono local argentino al formato internacional
 * que necesita Evolution API (sin + ni espacios).
 * Ej: "3814123456" → "5493814123456"
 */
export function formatPhoneForWhatsapp(phone: string | null): string | null {
  if (!phone) return null;

  // Limpiar caracteres no numéricos
  const cleaned = phone.replace(/\D/g, "");

  if (!cleaned) return null;

  // Si ya tiene código de país (549...), dejarlo
  if (cleaned.startsWith("549") && cleaned.length >= 12) {
    return cleaned;
  }

  // Si empieza con 54 pero sin 9 (formato fijo), agregar 9
  if (cleaned.startsWith("54") && !cleaned.startsWith("549")) {
    return "549" + cleaned.slice(2);
  }

  // Número local: agregar 549
  return "549" + cleaned;
}
