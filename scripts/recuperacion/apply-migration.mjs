// Aplica UNA migración a Supabase leyéndola del disco: lo que entra a la base es
// byte a byte lo que está en el repo, sin transcripción manual de por medio.
// exec_ddl hace EXECUTE de todo el string en una sola llamada => atómico:
// o entra la migración entera o no entra nada.
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

const file = process.argv[2];
if (!file) {
  console.error("uso: node apply-migration.mjs <ruta-al-.sql>");
  process.exit(1);
}

const raw = readFileSync(file, "utf8");
// BEGIN;/COMMIT; no pueden ir dentro de una función: el control de transacción lo
// da la propia llamada a exec_ddl.
const sql = raw
  .split(/\r?\n/)
  .filter((l) => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l))
  .join("\n");

// Desde la migración 84, `exec_ddl` NO es ejecutable por `anon`: la anon key
// viaja al navegador, así que dársela era darle SQL arbitrario como postgres a
// cualquiera que abriera la app. Ahora hace falta la service role key, que vive
// sólo acá y en el server. Sacala de: panel de Supabase → Project Settings →
// API Keys → `service_role` (secret), y agregala a .env.local como
// SUPABASE_SERVICE_ROLE_KEY. Ojo: NUNCA la prefijes con NEXT_PUBLIC_ ni la
// referencies desde src/ — Next hornea esas variables en el bundle del cliente.
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error("FALTA SUPABASE_SERVICE_ROLE_KEY en .env.local.");
  console.error("  La anon key ya no sirve: desde la migración 84 exec_ddl es sólo para service_role.");
  console.error("  Panel de Supabase → Project Settings → API Keys → service_role (secret).");
  console.error("  Alternativa sin tocar claves: pegar el .sql en el SQL editor del panel.");
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey);

const started = Date.now();
const { data, error } = await supabase.rpc("exec_ddl", { p_sql: sql });
const ms = Date.now() - started;

if (error) {
  console.error(`FALLO ${file} (${ms}ms) -> NADA se aplicó (la transacción hizo rollback)`);
  console.error(`  code:    ${error.code ?? "-"}`);
  console.error(`  message: ${error.message}`);
  if (error.details) console.error(`  details: ${error.details}`);
  if (error.hint) console.error(`  hint:    ${error.hint}`);
  process.exit(1);
}

console.log(`OK ${file} (${ms}ms) · ${sql.split("\n").length} lineas · respuesta: ${data}`);
