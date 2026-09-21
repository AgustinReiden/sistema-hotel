import { test } from "node:test";
import assert from "node:assert/strict";

import { calcularDV, formatearCodigo, interpretarCodigo, numeroVisible } from "../comun/codigo.mjs";

test("formatea y vuelve a interpretar el mismo codigo", () => {
  const cod = formatearCodigo("T", 123);
  assert.match(cod, /^T-000123-\d{2}$/);
  assert.deepEqual(interpretarCodigo(cod), { ok: true, prefijo: "T", numero: 123, visible: "T-000123" });
});

test("el prefijo entra en el DV: T y R con el mismo numero no comparten codigo", () => {
  assert.notEqual(calcularDV("T", 123), calcularDV("R", 123));
  const conPrefijoCambiado = formatearCodigo("T", 123).replace(/^T/, "R");
  assert.deepEqual(interpretarCodigo(conPrefijoCambiado), { ok: false, motivo: "dv_invalido" });
});

test("detecta todo cambio de un digito en el numero", () => {
  for (const numero of [0, 1, 123, 45678, 999999]) {
    const cod = formatearCodigo("T", numero);
    const nro = cod.slice(2, 8);
    for (let pos = 0; pos < 6; pos++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === nro[pos]) continue;
        const malo = `T-${nro.slice(0, pos)}${d}${nro.slice(pos + 1)}-${cod.slice(9)}`;
        assert.equal(interpretarCodigo(malo).ok, false, `${malo} no deberia validar`);
      }
    }
  }
});

test("detecta la transposicion de dos digitos vecinos", () => {
  const cod = formatearCodigo("T", 123456);
  const nro = cod.slice(2, 8);
  for (let pos = 0; pos < 5; pos++) {
    if (nro[pos] === nro[pos + 1]) continue;
    const t = nro.slice(0, pos) + nro[pos + 1] + nro[pos] + nro.slice(pos + 2);
    assert.equal(interpretarCodigo(`T-${t}-${cod.slice(9)}`).ok, false);
  }
});

test("rechaza lo que no tiene el formato", () => {
  for (const t of ["", "T-123-45", "T000123-45", "t-000123-45", "https://x.com", "ABCD-000123-45"]) {
    assert.deepEqual(interpretarCodigo(t), { ok: false, motivo: "formato" });
  }
});

test("numero visible", () => {
  assert.equal(numeroVisible("T", 7), "T-000007");
});

test("fuera de rango tira", () => {
  assert.throws(() => calcularDV("T", 1_000_000));
  assert.throws(() => calcularDV("t", 1));
});
