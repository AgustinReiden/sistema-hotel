export type CancelReasonKey =
  | "fechas_no_disponibles"
  | "habitacion_mantenimiento"
  | "otro";

export type Language = "es" | "pt";

export const CANCEL_REASON_LABELS: Record<CancelReasonKey, Record<Language, string>> = {
  fechas_no_disponibles: {
    es: "Fechas no disponibles",
    pt: "Datas indisponíveis",
  },
  habitacion_mantenimiento: {
    es: "Habitación en mantenimiento",
    pt: "Quarto em manutenção",
  },
  otro: {
    es: "Otro motivo",
    pt: "Outro motivo",
  },
};

export const CANCEL_REASON_OPTIONS: Array<{ key: CancelReasonKey; label: string }> = [
  { key: "fechas_no_disponibles", label: CANCEL_REASON_LABELS.fechas_no_disponibles.es },
  { key: "habitacion_mantenimiento", label: CANCEL_REASON_LABELS.habitacion_mantenimiento.es },
  { key: "otro", label: CANCEL_REASON_LABELS.otro.es },
];

export function translateCancelReason(reason: string, lang: Language): string {
  const entry = Object.entries(CANCEL_REASON_LABELS).find(
    ([, labels]) => labels.es === reason
  );
  if (entry) {
    const [, labels] = entry;
    return labels[lang];
  }
  return reason;
}
