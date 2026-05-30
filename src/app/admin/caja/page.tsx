import {
  getActiveOpenShift,
  getCurrentUserRole,
  getHotelSettings,
  getShiftSummary,
} from "@/lib/data";
import CajaClient from "./CajaClient";

export const revalidate = 0;

export default async function CajaPage() {
  const [role, hotelSettings] = await Promise.all([
    getCurrentUserRole(),
    getHotelSettings().catch(() => null),
  ]);
  const shift = await getActiveOpenShift(role);
  const summary = shift ? await getShiftSummary(shift.id) : null;
  return (
    <CajaClient
      summary={summary}
      isAdmin={role === "admin"}
      hotelTimezone={hotelSettings?.timezone || "America/Argentina/Tucuman"}
    />
  );
}
