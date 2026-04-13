/**
 * conexionexcel.js — Importa el Excel Maestro a Supabase
 * Uso: node conexionexcel.js ./Excel_Maestro.xlsx
 *
 * npm install xlsx @supabase/supabase-js dotenv
 */

require("dotenv").config();
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");

const EXCEL_PATH = process.argv[2] || "./Excel_Maestro.xlsx";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("❌  Falta SUPABASE_URL o SUPABASE_SERVICE_KEY en el archivo .env");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DIAS_VALIDOS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"];

async function seed() {
  console.log(`\n📂  Leyendo Excel: ${path.resolve(EXCEL_PATH)}`);
  const wb = XLSX.readFile(EXCEL_PATH);

  let totalBebes = 0;
  let totalAsistencias = 0;

  for (const sheetName of wb.SheetNames) {
    const diaNorm = sheetName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!DIAS_VALIDOS.includes(diaNorm)) {
      console.warn(`⚠️  Hoja ignorada: "${sheetName}"`);
      continue;
    }

    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
    console.log(`\n📋  ${sheetName} → ${rows.length} filas`);

    for (const row of rows) {
      const nombre_bebe  = (row["Nombre Bebe"]  || row.NombreBebe  || "").trim();
      const nombre_madre = (row["Nombre Madre"] || row.NombreMadre || "").trim();
      const institucion  = (row.Institucion || row.InstitucionMadre || "").trim();
      const programa     = (row.Programa    || row.ProgramaMadre   || "").trim();
      const edad         = String(row.Edad || "").trim();

      if (!nombre_bebe) continue;

      // Buscar si el bebé ya existe
      const { data: existing } = await supabase
        .from("bebes")
        .select("id")
        .ilike("nombre_bebe", nombre_bebe)
        .maybeSingle();

      let bebeId;
      if (existing) {
        await supabase.from("bebes")
          .update({ nombre_madre, institucion, programa, edad })
          .eq("id", existing.id);
        bebeId = existing.id;
      } else {
        const { data: inserted, error } = await supabase
          .from("bebes")
          .insert({ nombre_bebe, nombre_madre, institucion, programa, edad })
          .select("id").single();
        if (error) { console.error(`❌  Error insertando ${nombre_bebe}:`, error.message); continue; }
        bebeId = inserted.id;
        totalBebes++;
      }

      // Insertar asistencia para este día
      const { error: errA } = await supabase
        .from("asistencias")
        .upsert({ bebe_id: bebeId, dia: diaNorm }, { onConflict: "bebe_id,dia", ignoreDuplicates: true });

      if (!errA) {
        totalAsistencias++;
        console.log(`  ✅  ${nombre_bebe} → ${diaNorm}`);
      } else {
        console.log(`  ⏭️   ${nombre_bebe} → ${diaNorm} (ya existía)`);
      }
    }
  }

  console.log("\n══════════════════════════════════════");
  console.log(`✅  Importación completada`);
  console.log(`   Bebés nuevos   : ${totalBebes}`);
  console.log(`   Asistencias    : ${totalAsistencias}`);
  console.log("══════════════════════════════════════\n");
}

seed().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});