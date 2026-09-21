import { test } from "node:test";
import assert from "node:assert/strict";

import { armarManifiesto, parsearSeleccion, seleccionar } from "../generador/manifiesto.mjs";

const ZONA = "America/Argentina/Tucuman";
// Nombres ficticios: el repo es publico.
const movimientos = Array.from({ length: 20 }, (_, i) => ({
  movimiento_id: `mov-${i + 1}`,
  cliente: i % 2 ? "ACME SA - PERFUMERIA" : "CLINICA DEMO S.A",
  created_at: `2026-09-${String(i + 1).padStart(2, "0")}T15:00:00.000Z`,
  monto: 1000 * (i + 1),
}));

test("seleccion: rangos y sueltos, sin repetir y en orden", () => {
  assert.deepEqual(parsearSeleccion("7-10"), [7, 8, 9, 10]);
  assert.deepEqual(parsearSeleccion("12, 3,7-8,3"), [3, 7, 8, 12]);
  assert.deepEqual(parsearSeleccion("5"), [5]);
});

test("seleccion invalida: error claro, nunca 'imprimo lo que entendi'", () => {
  assert.throws(() => parsearSeleccion(""), /vacia/);
  assert.throws(() => parsearSeleccion("7 a 20"), /invalida/);
  assert.throws(() => parsearSeleccion("20-7"), /al reves/);
});

test("imprimir parte del lote no cambia la numeracion", () => {
  const todo = armarManifiesto(movimientos, { zona: ZONA });
  const parte = seleccionar(todo, parsearSeleccion("7-20"));
  assert.equal(parte.length, 14);
  assert.equal(parte[0].numero, "T-000007");
  assert.equal(parte[0].movimiento_id, "mov-7");
  assert.deepEqual(parte[0], todo[6]);
  assert.equal(parte.at(-1).numero, "T-000020");
});

test("pedir un numero que no esta en el lote es un error, no un faltante mudo", () => {
  const todo = armarManifiesto(movimientos, { zona: ZONA });
  assert.throws(() => seleccionar(todo, parsearSeleccion("19-21")), /T-000021/);
});
