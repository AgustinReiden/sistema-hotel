import { getAllActiveRoomsForMaintenance, getHotelSettings } from "@/lib/data";
import MaintenanceDashboard from "./MaintenanceDashboard";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const [roomsResult, hotelSettings] = await Promise.all([
    getAllActiveRoomsForMaintenance().catch((err: unknown) => {
      console.error("[MaintenancePage] getAllActiveRoomsForMaintenance failed:", err);
      throw new Error(
        `No pudimos cargar las habitaciones: ${err instanceof Error ? err.message : String(err)}`
      );
    }),
    getHotelSettings().catch(() => null),
  ]);
  return (
    <MaintenanceDashboard
      rooms={roomsResult}
      hotelTimezone={hotelSettings?.timezone || "America/Argentina/Tucuman"}
    />
  );
}
