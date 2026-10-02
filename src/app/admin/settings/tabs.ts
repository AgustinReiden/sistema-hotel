// Las pestañas de Configuración que viven en /admin/settings (?tab=). "Habitaciones y
// tarifas" es otra pantalla (/admin/rooms) y no pasa por acá.
export const SETTINGS_TABS = ["hotel", "arca", "usuarios"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** La pestaña pedida en la URL; sin valor o con uno desconocido, "Hotel y mensajes". */
export function parseSettingsTab(value: string | string[] | undefined): SettingsTab {
  const first = Array.isArray(value) ? value[0] : value;
  return SETTINGS_TABS.find((t) => t === first) ?? "hotel";
}
