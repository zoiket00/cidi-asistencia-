// importar2.js — versión simplificada
const { execSync } = require("child_process");

// Cargar variables manualmente desde .env
const fs = require("fs");
const path = require("path");

// Leer .env manualmente
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] = val;
  }
}

const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

console.log("\n══════════════════════════════════════════");
console.log("  Importador histórico — Fundación Juanfe");
console.log("══════════════════════════════════════════\n");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  Falta SUPABASE_URL o SUPABASE_SERVICE_KEY");
  process.exit(1);
}

console.log("✅  Supabase URL:", SUPABASE_URL.slice(0, 30) + "...");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const CARPETA  = "./historico";

// Mapeo de columnas
function normCol(str) {
  return String(str).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").trim();
}

const COL_MAP = {
  "nombre bebe": "NombreBebe", "nombre bebé": "NombreBebe", nombrebebe: "NombreBebe",
  "nombre madre": "NombreMadre", nombremadre: "NombreMadre",
  "institucion": "Institucion", "institución": "Institucion",
  "programa": "Programa",
  "edad (meses)": "Edad", edad: "Edad",
  fecha: "Fecha", dia: "Dia", "día": "Dia",
  asistencia: "Asistencia",
  "ubicacion": "Ubicacion", "ubicación": "Ubicacion",
  reporte: "Reporte",
  "situacion especifica": "SituacionEspecifica", "situación específica": "SituacionEspecifica",
  nota: "Nota",
  extras: "Visitante", visitante: "Visitante",
  "no cidi": "NoCidi", nocidi: "NoCidi",
};

function normalizarFila(rawRow) {
  const out = {};
  for (const [k, v] of Object.entries(rawRow)) {
    const canon = COL_MAP[normCol(k)];
    if (canon) out[canon] = String(v ?? "").trim();
  }
  return out;
}

function extraerFechaDelNombre(nombreArchivo) {
  const base = path.basename(nombreArchivo, ".xlsx").replace(/\s*\(\d+\)\s*/g, "");
  const m = base.match(/[Aa]sistencia-(\w+)-(\d{2})-(\d{2})-(\d{4})/);
  if (m) {
    const [, dia, dd, mm, yyyy] = m;
    return { fecha: `${yyyy}-${mm}-${dd}`, dia };
  }
  return { fecha: null, dia: null };
}

function normalizarFecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().split("T")[0];
  }
  return null;
}

function esSi(v) {
  const n = normCol(String(v || ""));
  return n === "si" || n === "sí";
}

async function run() {
  const archivos = fs.readdirSync(CARPETA)
    .filter(f => /\.xlsx?$/i.test(f)).sort();

  console.log(`📂  Carpeta: ${path.resolve(CARPETA)}`);
  console.log(`📋  Archivos: ${archivos.length}\n`);

  let totalRegistros = 0;
  let errores = 0;

  for (const archivo of archivos) {
    const rutaArchivo = path.join(CARPETA, archivo);
    const { fecha: fechaNombre, dia: diaNombre } = extraerFechaDelNombre(archivo);
    console.log(`📄  ${archivo}`);

    try {
      const wb = XLSX.readFile(rutaArchivo, { cellDates: true });
      let filas = [];

      for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
        for (const rawRow of rows) {
          const r = normalizarFila(rawRow);
          if (!r.NombreBebe) continue;

          const fecha = normalizarFecha(r.Fecha) || fechaNombre;
          const dia   = r.Dia || diaNombre || sheetName;
          if (!fecha) { console.log(`   ⚠️  Sin fecha: ${r.NombreBebe}`); continue; }

          filas.push({
            nombre_bebe:          r.NombreBebe.trim(),
            nombre_madre:         (r.NombreMadre || "").trim(),
            institucion:          (r.Institucion || "").trim(),
            programa:             (r.Programa || "").trim(),
            edad:                 (r.Edad || "").trim(),
            fecha,
            dia: dia.trim(),
            asistencia:           esSi(r.Asistencia) ? "Sí" : "No",
            ubicacion:            (r.Ubicacion || "").trim(),
            reporte:              esSi(r.Reporte) ? "Sí" : "No",
            situacion_especifica: (r.SituacionEspecifica || "").trim(),
            nota:                 (r.Nota || "").trim(),
            visitante:            esSi(r.Visitante) ? "Sí" : "",
            no_cidi:              esSi(r.NoCidi) ? "Sí" : "",
          });
        }
      }

      // Deduplicar por nombre_bebe+nombre_madre+fecha antes de insertar
      const seen = new Set();
      filas = filas.filter(f => {
        const key = f.nombre_bebe + "|" + f.nombre_madre + "|" + f.fecha;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Insertar en lotes de 50
      for (let i = 0; i < filas.length; i += 50) {
        const lote = filas.slice(i, i + 50);
        const { error } = await supabase
          .from("registros_asistencia")
          .upsert(lote, { onConflict: "nombre_bebe,nombre_madre,fecha" });
        if (error) throw error;
      }

      console.log(`   ✅  ${filas.length} registros guardados`);
      totalRegistros += filas.length;

    } catch (err) {
      console.error(`   ❌  Error: ${err.message}`);
      errores++;
    }
  }

  console.log("\n══════════════════════════════════════════");
  console.log(`✅  Completado — ${totalRegistros} registros en Supabase`);
  if (errores) console.log(`❌  Errores: ${errores}`);
  console.log("══════════════════════════════════════════\n");
}

run().catch(err => {
  console.error("❌  Error fatal:", err.message);
  process.exit(1);
});