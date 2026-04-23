import { getOpenShiftForCurrentUser, getShiftSummary } from "@/lib/data";
import CajaClient from "./CajaClient";

export const revalidate = 0;

export default async function CajaPage() {
  const shift = await getOpenShiftForCurrentUser();
  const summary = shift ? await getShiftSummary(shift.id) : null;
  return <CajaClient summary={summary} />;
}
