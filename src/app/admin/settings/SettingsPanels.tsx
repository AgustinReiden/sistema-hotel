"use client";

import { useCallback, useState } from "react";

import type { FiscalSettings, HotelSettings } from "@/lib/types";
import FiscalSettingsPanel from "./FiscalSettingsPanel";
import SettingsForm from "./SettingsForm";
import type { SettingsTab } from "./tabs";
import UsersPanel from "./UsersPanel";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

type Dirty = { hotel: boolean; arca: boolean; usuarios: boolean };

// Los tres paneles siempre están montados y los que no corresponden se esconden con
// `hidden`: así lo que se tipeó en una pestaña sigue ahí al pasar a otra y volver. Acá
// se juntan los avisos de "cambios sin guardar" de los tres para preguntar antes de
// irse de Configuración.
export default function SettingsPanels({
  tab,
  settings,
  fiscalSettings,
}: {
  tab: SettingsTab;
  settings: HotelSettings;
  fiscalSettings: FiscalSettings | null;
}) {
  const [dirty, setDirty] = useState<Dirty>({ hotel: false, arca: false, usuarios: false });
  const setHotelDirty = useCallback((v: boolean) => setDirty((d) => (d.hotel === v ? d : { ...d, hotel: v })), []);
  const setArcaDirty = useCallback((v: boolean) => setDirty((d) => (d.arca === v ? d : { ...d, arca: v })), []);
  const setUsuariosDirty = useCallback(
    (v: boolean) => setDirty((d) => (d.usuarios === v ? d : { ...d, usuarios: v })),
    []
  );

  useUnsavedChangesGuard(dirty.hotel || dirty.arca || dirty.usuarios);

  return (
    <>
      <div hidden={tab !== "hotel"} data-settings-panel="hotel">
        <SettingsForm settings={settings} onDirtyChange={setHotelDirty} />
      </div>
      <div hidden={tab !== "arca"} data-settings-panel="arca">
        <FiscalSettingsPanel settings={fiscalSettings} onDirtyChange={setArcaDirty} />
      </div>
      <div hidden={tab !== "usuarios"} data-settings-panel="usuarios">
        <UsersPanel onDirtyChange={setUsuariosDirty} />
      </div>
    </>
  );
}
