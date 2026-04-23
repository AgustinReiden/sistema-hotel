import { getHotelSettings, getRoomsNeedingCleaning } from "@/lib/data";
import MaintenanceDashboard from "./MaintenanceDashboard";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const [rooms, hotelSettings] = await Promise.all([
    getRoomsNeedingCleaning(),
    getHotelSettings().catch(() => null),
  ]);
  return (
    <MaintenanceDashboard
      rooms={rooms}
      hotelTimezone={hotelSettings?.timezone || "America/Argentina/Tucuman"}
    />
  );
}
