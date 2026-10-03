/** "14 activas · 1 inactiva": cuántas habitaciones se venden y cuántas están dadas de baja. */
export function roomsCountLabel(rooms: ReadonlyArray<{ is_active: boolean }>): string {
  const activas = rooms.filter((r) => r.is_active).length;
  const inactivas = rooms.length - activas;
  const partes = [`${activas} ${activas === 1 ? "activa" : "activas"}`];
  if (inactivas > 0) partes.push(`${inactivas} ${inactivas === 1 ? "inactiva" : "inactivas"}`);
  return partes.join(" · ");
}
