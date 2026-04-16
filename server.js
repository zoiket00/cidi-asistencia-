/**
 * server.js — Fundación Juanfe · CIDI
 * npm install express @supabase/supabase-js dotenv
 *
 * ENDPOINTS:
 * ─────────────────────────────────────────────────────
 *  GET  /api/sheet/:dia          → lista bebés del día (desde tabla bebes)
 *  GET  /api/bebes               → todos los bebés
 *  GET  /api/dias                → días disponibles
 *  POST /api/bebes               → agregar/actualizar bebé
 *
 *  POST /api/asistencia/guardar  → guarda asistencia del día en Supabase  ← NUEVO
 *  GET  /api/asistencia          → consulta registros para el dashboard   ← NUEVO
 *
 *  POST /api/historico/guardar   → guarda Excel en disco (respaldo)
 *  GET  /api/historico           → lista Excels guardados
 *  GET  /api/historico/:nombre   → descarga Excel
 */

require("dotenv").config();
const express = require("express");
const path    = require("path");
const fs      = require("fs");
const { createClient } = require("@supabase/supabase-js");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Conexión a Supabase ────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

supabase.from("bebes").select("id", { count: "exact", head: true })
  .then(({ count, error }) => {
    if (error) console.error("❌  Error conectando a Supabase:", error.message);
    else       console.log(`✅  Supabase conectado — ${count} bebés en la BD`);
  });

// ── Carpeta de respaldo de Excels ──────────────────────────────────────────────
const HISTORICO_DIR = path.join(__dirname, "historico");
if (!fs.existsSync(HISTORICO_DIR)) fs.mkdirSync(HISTORICO_DIR);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "10mb" }));

// ── Ruta del dashboard ─────────────────────────────────────────────────────────
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// =============================================================================
//  ENDPOINTS EXISTENTES (sin cambios)
// =============================================================================

// Devuelve la lista de bebés de un día (para que app.js cargue la tabla)
app.get("/api/sheet/:dia", async (req, res) => {
  const diasValidos = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"];
  const dia = req.params.dia;
  if (!diasValidos.includes(dia))
    return res.status(404).json({ error: `Día no encontrado: ${dia}` });

  try {
    const { data: asistencias, error: errA } = await supabase
      .from("asistencias").select("bebe_id").eq("dia", dia);
    if (errA) throw errA;
    if (!asistencias || asistencias.length === 0)
      return res.send("Nombre Bebe,Nombre Madre,Institucion,Programa,Edad\n");

    const ids = asistencias.map((a) => a.bebe_id);
    const { data: bebes, error: errB } = await supabase
      .from("bebes")
      .select("nombre_bebe, nombre_madre, institucion, programa, edad")
      .in("id", ids).order("nombre_bebe", { ascending: true });
    if (errB) throw errB;

    const csvLines = [
      "Nombre Bebe,Nombre Madre,Institucion,Programa,Edad",
      ...bebes.map((b) =>
        [b.nombre_bebe, b.nombre_madre, b.institucion, b.programa, b.edad]
          .map((v) => { const s = String(v ?? ""); return s.includes(",") ? `"${s}"` : s; })
          .join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(csvLines.join("\n"));
  } catch (err) {
    console.error(`Error /api/sheet/${dia}:`, err.message);
    res.status(500).json({ error: "No se pudo cargar el listado" });
  }
});

// Todos los bebés del catálogo
app.get("/api/bebes", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("bebes").select("nombre_bebe, nombre_madre, institucion, programa, edad")
      .order("nombre_bebe", { ascending: true });
    if (error) throw error;
    res.json({ bebes: data.map((b) => ({
      NombreBebe: b.nombre_bebe, NombreMadre: b.nombre_madre,
      InstitucionMadre: b.institucion, ProgramaMadre: b.programa, Edad: b.edad,
    }))});
  } catch (err) {
    res.status(500).json({ error: "No se pudo cargar bebés" });
  }
});

// Días con bebés registrados
app.get("/api/dias", async (req, res) => {
  try {
    const { data, error } = await supabase.from("asistencias").select("dia");
    if (error) throw error;
    const orden = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"];
    const dias  = [...new Set(data.map((r) => r.dia))].sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
    res.json({ dias });
  } catch (err) {
    res.status(500).json({ error: "No se pudo obtener los días" });
  }
});

// Agregar o actualizar bebé
app.post("/api/bebes", async (req, res) => {
  const { nombre_bebe, nombre_madre, institucion, programa, edad, dias } = req.body;
  if (!nombre_bebe || !nombre_madre)
    return res.status(400).json({ error: "Nombre del bebé y madre son obligatorios" });

  try {
    const { data: existing } = await supabase.from("bebes").select("id")
      .ilike("nombre_bebe", nombre_bebe).maybeSingle();

    let bebeId;
    if (existing) {
      await supabase.from("bebes").update({ nombre_madre, institucion, programa, edad }).eq("id", existing.id);
      bebeId = existing.id;
    } else {
      const { data: inserted, error: errI } = await supabase.from("bebes")
        .insert({ nombre_bebe, nombre_madre, institucion, programa, edad }).select("id").single();
      if (errI) throw errI;
      bebeId = inserted.id;
    }

    if (Array.isArray(dias) && dias.length > 0) {
      const { error: errAs } = await supabase.from("asistencias")
        .upsert(dias.map((dia) => ({ bebe_id: bebeId, dia })), { onConflict: "bebe_id,dia", ignoreDuplicates: true });
      if (errAs) throw errAs;
    }
    res.json({ ok: true, id: bebeId });
  } catch (err) {
    console.error("Error POST /api/bebes:", err.message);
    res.status(500).json({ error: "No se pudo guardar el bebé" });
  }
});

// =============================================================================
//  NUEVOS ENDPOINTS — ASISTENCIA EN SUPABASE
// =============================================================================

/**
 * POST /api/asistencia/guardar
 *
 * Recibe la asistencia completa de un día y la guarda en registros_asistencia.
 * Si ya existe un registro del mismo bebé en la misma fecha, lo ACTUALIZA
 * (no duplica). Así es seguro exportar varias veces el mismo día.
 *
 * Body esperado:
 * {
 *   fecha: "2026-03-16",        ← fecha del día (YYYY-MM-DD)
 *   dia:   "Lunes",             ← nombre del día
 *   registros: [                ← array con todos los bebés del día
 *     {
 *       NombreBebe: "Mia Antonella...",
 *       NombreMadre: "Andrea...",
 *       InstitucionMadre: "UTE",
 *       ProgramaMadre: "Hotelería",
 *       Edad: "6-15",
 *       Asistencia: "Sí",
 *       Ubicacion: "",
 *       Reporte: "No",
 *       SituacionEspecifica: "",
 *       Nota: "",
 *       Visitante: "",
 *       NoCidi: ""
 *     },
 *     ...
 *   ]
 * }
 */
app.post("/api/asistencia/guardar", async (req, res) => {
  const { fecha, dia, registros } = req.body;

  // Validaciones básicas
  if (!fecha || !dia || !Array.isArray(registros) || registros.length === 0)
    return res.status(400).json({ error: "Faltan datos: fecha, dia y registros son obligatorios" });

  try {
    // Convertir cada fila del app.js al formato de la tabla registros_asistencia
    const filas = registros
      .filter((r) => r.NombreBebe && r.NombreBebe.trim())
      .map((r) => ({
        nombre_bebe:          (r.NombreBebe         || "").trim(),
        nombre_madre:         (r.NombreMadre        || "").trim(),
        "Fase":                 (r.InstitucionMadre   || "").trim(),
        programa:             (r.ProgramaMadre      || "").trim(),
        edad:                 (r.Edad               || "").trim(),
        fecha,
        dia,
        asistencia:           (r.Asistencia         || "No").trim(),
        ubicacion:            (r.Ubicacion          || "").trim(),
        reporte:              (r.Reporte            || "No").trim(),
        situacion_especifica: (r.SituacionEspecifica|| "").trim(),
        nota:                 (r.Nota               || "").trim(),
        visitante:            (r.Visitante          || "").trim(),
        no_cidi:              (r.NoCidi             || "").trim(),
      }));

    // upsert: si ya existe (mismo nombre_bebe + nombre_madre + fecha) → actualiza
    // Si no existe → inserta. Nunca duplica.
    const { error } = await supabase
      .from("registros_asistencia")
      .upsert(filas, { onConflict: "nombre_bebe,nombre_madre,fecha" });

    if (error) throw error;

    console.log(`✅ Asistencia guardada: ${filas.length} registros — ${dia} ${fecha}`);
    res.json({ ok: true, guardados: filas.length });

  } catch (err) {
    console.error("Error POST /api/asistencia/guardar:", err.message);
    res.status(500).json({ error: "No se pudo guardar la asistencia: " + err.message });
  }
});

/**
 * GET /api/asistencia
 *
 * Devuelve registros de asistencia para el dashboard.
 * Soporta filtros opcionales por query params:
 *
 *   /api/asistencia                        → todos los registros
 *   /api/asistencia?fecha=2026-03-16       → un día específico
 *   /api/asistencia?desde=2026-03-01&hasta=2026-03-31  → rango de fechas
 *   /api/asistencia?dia=Lunes              → todos los lunes
 *
 * Devuelve JSON con el mismo formato que los Excel,
 * para que el dashboard.js existente los procese sin cambios.
 */
app.get("/api/asistencia", async (req, res) => {
  try {
    const { fecha, desde, hasta, dia } = req.query;

    let query = supabase
      .from("registros_asistencia")
      .select("*")
      .order("fecha", { ascending: true })
      .order("nombre_bebe", { ascending: true });

    // Aplicar filtros según lo que pida el dashboard
    if (fecha)        query = query.eq("fecha", fecha);
    if (dia)          query = query.eq("dia", dia);
    if (desde)        query = query.gte("fecha", desde);
    if (hasta)        query = query.lte("fecha", hasta);

    const { data, error } = await query;
    if (error) throw error;

    // Convertir al formato canónico que espera dashboard.js
    const registros = data.map((r) => ({
      NombreBebe:          r.nombre_bebe,
      NombreMadre:         r.nombre_madre,
      InstitucionMadre:    r["Fase"],
      ProgramaMadre:       r.programa,
      Edad:                r.edad,
      Fecha:               r.fecha,
      Dia:                 r.dia,
      Asistencia:          r.asistencia,
      Ubicacion:           r.ubicacion,
      Reporte:             r.reporte,
      SituacionEspecifica: r.situacion_especifica,
      Nota:                r.nota,
      Visitante:           r.visitante,
      NoCidi:              r.no_cidi,
    }));

    res.json({ ok: true, total: registros.length, registros });

  } catch (err) {
    console.error("Error GET /api/asistencia:", err.message);
    res.status(500).json({ error: "No se pudo obtener la asistencia" });
  }
});

// =============================================================================
//  RESPALDO EN DISCO (Excel histórico — se mantiene como copia de seguridad)
// =============================================================================

app.post("/api/historico/guardar", (req, res) => {
  try {
    const { nombre, datos } = req.body;
    if (!nombre || !datos) return res.status(400).json({ error: "Faltan datos" });
    fs.writeFileSync(path.join(HISTORICO_DIR, nombre), Buffer.from(datos, "base64"));
    res.json({ ok: true, archivo: nombre });
  } catch (err) { res.status(500).json({ error: "No se pudo guardar" }); }
});

app.get("/api/historico", (req, res) => {
  try {
    const archivos = fs.readdirSync(HISTORICO_DIR)
      .filter((f) => f.endsWith(".xlsx")).sort()
      .map((f) => ({
        nombre: f,
        url: `/api/historico/${f}`,
        fecha: fs.statSync(path.join(HISTORICO_DIR, f)).mtime,
      }));
    res.json({ archivos });
  } catch (err) { res.status(500).json({ error: "Error listando historico" }); }
});

app.get("/api/historico/:nombre", (req, res) => {
  const filePath = path.join(HISTORICO_DIR, req.params.nombre);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "No encontrado" });
  res.download(filePath);
});

// ── Fallback SPA ───────────────────────────────────────────────────────────────
app.get("/{*path}", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.listen(PORT, () =>
  console.log(`\n🚀  Servidor CIDI en http://localhost:${PORT}`)
);