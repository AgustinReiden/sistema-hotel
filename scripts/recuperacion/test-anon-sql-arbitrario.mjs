// Suite de regresión de seguridad sobre la superficie ANÓNIMA.
//
// Usa la anon key: la misma que Next hornea en el bundle y que cualquiera puede
// sacar del navegador con F12. O sea, esto es literalmente "qué puede hacer un
// desconocido que abre hotelelrefugio.com.ar".
//
// Existe porque este agujero ya se reabrió solo una vez: la migración 48 cerró
// `run_sql` a anon en la base de Ohio, y la mudanza a Brasil (2026-06-19) la
// recreó desde cero, le aplicó los default privileges de Supabase y la dejó
// abierta ~6 semanas sin que nadie se enterara. Correr esto después de cualquier
// restore, mudanza de proyecto o migración que toque funciones.
//
// Uso (desde la raíz del repo, donde está .env.local):
//   node scripts/recuperacion/test-anon-sql-arbitrario.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let fallas = 0;
const ok = (m) => console.log(`  ok       ${m}`);
const falla = (m) => {
  fallas++;
  console.log(`  FALLA    ${m}`);
};

// ── 1) SQL arbitrario: ninguna de las dos debe responder ─────────────────────
// `run_sql` corre como postgres, así que si contestara saltearía RLS y
// devolvería cualquier tabla. `exec_ddl` es directamente DDL como postgres.
console.log("\nSQL arbitrario (deben dar 42501):");
for (const [fn, args] of [
  ["run_sql", { query: "SELECT count(*) AS n FROM public.guests" }],
  ["exec_ddl", { p_sql: "SELECT 1" }],
  // Anotar migraciones como aplicadas es escribir el registro de deriva (mig 99).
  // Un nombre que no existe: si la funcion contestara, la fila quedaria igual.
  ["record_migration", { p_filename: "00_prueba_anon_no_deberia_entrar.sql" }],
]) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error?.code === "42501") ok(`${fn}: permission denied`);
  else if (error) falla(`${fn}: error inesperado -> ${error.code} ${error.message}`);
  else falla(`${fn}: ABIERTO, respondió -> ${JSON.stringify(data)}`);
}

// ── 2) Datos sensibles: RLS tiene que devolver vacío, no filas ───────────────
console.log("\nTablas sensibles (deben dar 0 filas o permission denied):");
for (const tabla of ["guests", "payments", "invoices", "reservations", "profiles"]) {
  const { data, error } = await supabase.from(tabla).select("*").limit(1);
  if (error) ok(`${tabla}: bloqueado (${error.code ?? "sin code"})`);
  else if (Array.isArray(data) && data.length === 0) ok(`${tabla}: 0 filas (RLS)`);
  else falla(`${tabla}: FUGA, devolvió ${data.length} fila(s) -> ${JSON.stringify(data).slice(0, 200)}`);
}

// ── 3) La web pública tiene que seguir funcionando ───────────────────────────
// Si esto falla, endurecimos de más y la home del hotel está rota para huéspedes.
console.log("\nWeb pública (debe seguir leyendo):");
for (const tabla of ["rooms", "hotel_settings"]) {
  const { data, error } = await supabase.from(tabla).select("*").limit(1);
  if (error) falla(`${tabla}: ROTO para visitantes -> ${error.code} ${error.message}`);
  else if (!data?.length) falla(`${tabla}: devolvió 0 filas, la home se queda sin datos`);
  else ok(`${tabla}: legible`);
}

console.log(
  fallas === 0
    ? "\nTodo en orden: superficie anónima cerrada y web pública intacta."
    : `\n${fallas} problema(s). NO ignorar.`
);
process.exitCode = fallas === 0 ? 0 : 1;
