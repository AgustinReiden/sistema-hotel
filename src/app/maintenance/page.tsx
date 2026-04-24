import { getAllActiveRoomsForMaintenance, getHotelSettings } from "@/lib/data";
import MaintenanceDashboard from "./MaintenanceDashboard";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const [roomsResult, hotelSettings] = await Promise.all([
    getAllActiveRoomsForMaintenance()
      .then((rooms) => ({ rooms, loadError: undefined as string | undefined }))
      .catch((error) => {
        console.error("[MaintenancePage] getAllActiveRoomsForMaintenance failed:", error);
        return {
          rooms: [],
          loadError:
            "No se pudieron cargar las habitaciones. Revisa las migraciones de mantenimiento en Supabase.",
        };
      }),
    getHotelSettings().catch(() => null),
  ]);
  return (
    <MaintenanceDashboard
      rooms={roomsResult.rooms}
      hotelTimezone={hotelSettings?.timezone || "America/Argentina/Tucuman"}
      loadError={roomsResult.loadError}
    />
  );
}
