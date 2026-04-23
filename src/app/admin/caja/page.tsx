import {
  getCurrentUserRole,
  getHotelSettings,
  getOpenShiftForCurrentUser,
  getShiftSummary,
} from "@/lib/data";
import CajaClient from "./CajaClient";

export const revalidate = 0;

export default async function CajaPage() {
  const [shift, role, hotelSettings] = await Promise.all([
    getOpenShiftForCurrentUser(),
    getCurrentUserRole(),
    getHotelSettings().catch(() => null),
  ]);
  const summary = shift ? await getShiftSummary(shift.id) : null;
  return (
    <CajaClient
      summary={summary}
      isAdmin={role === "admin"}
      hotelTimezone={hotelSettings?.timezone || "America/Argentina/Tucuman"}
    />
  );
}
