// ─── Configuración y Variables Globales ───────────────────────────────────────
let modifiedData = {};
let masterData = [];

// Días válidos en la base de datos (sin tildes para coincidir con Supabase)
const DIAS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"];

// Etiquetas de visualización (con tilde para mostrar en tabs)
const DIAS_LABEL = {
  Lunes: "Lunes",
  Martes: "Martes",
  Miercoles: "Miércoles",
  Jueves: "Jueves",
  Viernes: "Viernes",
};

const Instituciones = ["UTE", "ULA 1", "ULA 2", "TSF", "Otra"];
const Programas = [
  "Hotelería",
  "Cocina",
  "Belleza",
  "Auxiliar Administrativo",
  "Otro",
];

const diseaseOptions = [
  { value: "SANOS", text: "SANOS (ingresados a CIDI)" },
  { value: "IRA", text: "IRA (gripes, cuadros virales)" },
  { value: "ALERGIAS", text: "ALERGIAS (respiratoria, piel, medicamentos)" },
  { value: "BROTES", text: "BROTES (escabiosis o contagiosos)" },
  { value: "EDA", text: "EDA (enfermedad diarreica aguda)" },
  { value: "VOMITOS", text: "VÓMITOS" },
  { value: "FIEBRE", text: "FIEBRE" },
  { value: "ACCIDENTE CASERO", text: "ACCIDENTE CASERO" },
  { value: "SITUACION PERSONAL", text: "SITUACIÓN PERSONAL" },
  { value: "ASISTE A FAMI", text: "ASISTE A FAMI" },
  { value: "CITA MEDICA / VACUNAS", text: "CITA MÉDICA / VACUNAS" },
  { value: "HOSPITALIZACION", text: "HOSPITALIZACIÓN" },
  { value: "OTROS", text: "OTROS (Transportes, mamá enferma)" },
];

const columnOrder = [
  "NombreBebe",
  "NombreMadre",
  "InstitucionMadre",
  "ProgramaMadre",
  "Edad",
  "Asistencia",
  "Ubicacion",
  "Reporte",
  "SituacionEspecifica",
  "Nota",
  "Visitante",
  "NoCidi",
];
const columnHeaders = {
  NombreBebe: "Nombre Bebé",
  NombreMadre: "Nombre Madre",
  InstitucionMadre: "Fase",
  ProgramaMadre: "Programa",
  Edad: "Edad (meses)",
  Asistencia: "Asistencia",
  Ubicacion: "Ubicación",
  Reporte: "Reporte",
  SituacionEspecifica: "Situación Específica",
  Nota: "Nota",
  Visitante: "Extras",
  NoCidi: "No CIDI",
};

// ─── Elementos del DOM ────────────────────────────────────────────────────────
const daysTabs    = document.getElementById("days-tabs");
const tabsContent = document.getElementById("tabs-content");
const exportBtn   = document.getElementById("export-btn");
const searchInput = document.getElementById("search-input");

// ─── Inicialización ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => initApp());

async function initApp() {
  loadFromLocalStorage(); // Carga modifiedData y masterData del localStorage
  await loadMasterDataFromServer(); // Sincroniza con Supabase
  openCurrentDayTab();
  setupEventListeners();
  addAddBabyButton();
}

function setupEventListeners() {
  exportBtn.addEventListener("click", exportToExcel);
  searchInput.addEventListener("input", filterData);
}

// ─── Utilidad: normalizar edad ────────────────────────────────────────────────
function normalizarEdad(edad) {
  if (!edad) return "";
  const num = parseInt(String(edad).replace(/\D/g, ""), 10);
  if (isNaN(num)) return "";
  if (num >= 6  && num <= 15) return "6-15";
  if (num >= 16 && num <= 30) return "16-30";
  return String(edad).trim();
}

// ─── API: URL del endpoint por día ───────────────────────────────────────────
// El servidor Express consulta Supabase y devuelve el CSV del día
function apiDayUrl(dia) {
  return `/api/sheet/${dia}`;
}

// ─── Parseo de CSV (respuesta del servidor) ───────────────────────────────────
function parsearCsv(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));

  return lines
    .slice(1)
    .map((line) => {
      const vals = [];
      let cur = "", inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQ = !inQ;
        } else if (c === "," && !inQ) {
          vals.push(cur.trim());
          cur = "";
        } else {
          cur += c;
        }
      }
      vals.push(cur.trim());
      const row = {};
      headers.forEach((h, i) => {
        row[h] = (vals[i] || "").replace(/^"|"$/g, "");
      });
      return row;
    })
    .filter((r) => Object.values(r).some((v) => v !== ""));
}

// ─── Carga desde Supabase (vía endpoints del servidor) ───────────────────────
async function loadMasterDataFromServer() {
  updateSyncStatus("loading", "Conectando con base de datos...");

  try {
    // 1. Catálogo completo de bebés para el buscador del modal
    const resBebes = await fetch("/api/bebes");
    if (!resBebes.ok) throw new Error("Error cargando catálogo de bebés");
    const { bebes } = await resBebes.json();

    masterData = bebes.map((b) => ({
      NombreBebe:      b.NombreBebe      || "",
      NombreMadre:     b.NombreMadre     || "",
      InstitucionMadre: b.InstitucionMadre || "",
      ProgramaMadre:   b.ProgramaMadre   || "",
      Edad:            normalizarEdad(b.Edad),
    }));

    // 2. Días disponibles en la BD
    const resDias = await fetch("/api/dias");
    if (!resDias.ok) throw new Error("Error cargando días disponibles");
    const { dias: diasDisponibles } = await resDias.json();

    // 3. Preservar asistencias ya marcadas hoy (localStorage)
    const asistenciasGuardadas = {};
    Object.keys(modifiedData).forEach((day) => {
      asistenciasGuardadas[day] = {};
      (modifiedData[day] || []).forEach((row) => {
        if (row.Asistencia && row.Asistencia !== "") {
          const key = (row.NombreBebe || "").trim().toLowerCase();
          asistenciasGuardadas[day][key] = {
            Asistencia:          row.Asistencia,
            Ubicacion:           row.Ubicacion,
            Reporte:             row.Reporte,
            SituacionEspecifica: row.SituacionEspecifica,
            Nota:                row.Nota,
          };
        }
      });
    });

    // 4. Listado por día desde Supabase (CSV)
    const results = await Promise.all(
      DIAS.map(async (dia) => {
        if (!diasDisponibles.includes(dia)) return { dayName: dia, rows: [] };
        const res = await fetch(apiDayUrl(dia));
        if (!res.ok) throw new Error(`Error cargando ${dia}`);
        const text = await res.text();
        return { dayName: dia, rows: parsearCsv(text) };
      })
    );

    // 5. Procesar y renderizar
    procesarDesdeBaseDatos(results);

    // 6. Restaurar asistencias guardadas
    Object.keys(asistenciasGuardadas).forEach((day) => {
      if (!modifiedData[day]) return;
      modifiedData[day].forEach((row) => {
        const key = (row.NombreBebe || "").trim().toLowerCase();
        if (asistenciasGuardadas[day][key]) {
          Object.assign(row, asistenciasGuardadas[day][key]);
        }
      });
    });

    saveToLocalStorage();
    exportBtn.disabled = false;
    updateSyncStatus("ok", `BD conectada — ${masterData.length} bebés cargados`);
    console.log(`✅ Supabase cargado — ${masterData.length} bebés únicos`);

  } catch (err) {
    updateSyncStatus("error", "Sin conexión a la BD — usando datos guardados");
    console.warn("No se pudo cargar desde Supabase:", err.message);
  }
}

// ─── Indicador de sincronización ──────────────────────────────────────────────
function updateSyncStatus(state, text) {
  const dot   = document.getElementById("syncDot");
  const label = document.getElementById("syncText");
  if (!dot || !label) return;
  label.textContent = text;
  dot.className = "sync-dot sync-" + state;
}

// ─── Procesamiento de datos desde la base de datos ───────────────────────────
function procesarDesdeBaseDatos(results) {
  modifiedData = {};
  daysTabs.innerHTML    = "";
  tabsContent.innerHTML = "";

  results.forEach(({ dayName, rows }, index) => {
    if (!rows || rows.length === 0) return;

    const jsonData = rows.map((row) => ({
      NombreBebe:      (row["Nombre Bebe"] || row.NombreBebe || "").trim(),
      NombreMadre:     (row["Nombre Madre"] || row.NombreMadre || "").trim(),
      InstitucionMadre:(row.Institucion || row.InstitucionMadre || "").trim(),
      ProgramaMadre:   (row.Programa || row.ProgramaMadre || "").trim(),
      Edad:            normalizarEdad(row.Edad || row["Edad (meses)"] || ""),
    }));

    modifiedData[dayName] = jsonData.map((row) => ({
      ...row,
      Asistencia:          row.Asistencia          || "No",
      Ubicacion:           row.Ubicacion           || "",
      Reporte:             row.Reporte             || "No",
      SituacionEspecifica: row.SituacionEspecifica || "",
      Nota:                row.Nota                || "",
      Visitante:           "",
      NoCidi:              "",
    }));

    // Mostrar etiqueta con tilde en el tab
    renderTabHeader(dayName, index === 0);
    renderTabContainer(dayName, index === 0);
    renderTable(dayName, modifiedData[dayName]);
  });

  saveToLocalStorage();
  addAddBabyButton();
}

// ─── Renderizado de interfaz ──────────────────────────────────────────────────
function renderTabHeader(day, isActive) {
  const tab = document.createElement("div");
  tab.className   = `tab ${isActive ? "active" : ""}`;
  tab.textContent = DIAS_LABEL[day] || day;
  tab.dataset.day = day;
  tab.onclick     = switchTab;
  daysTabs.appendChild(tab);
}

function renderTabContainer(day, isActive) {
  const content = document.createElement("div");
  content.className = `tab-content ${isActive ? "active" : ""}`;
  content.id        = `content-${day}`;
  tabsContent.appendChild(content);
}

function switchTab(e) {
  const day = e.target.dataset.day;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  e.target.classList.add("active");
  document.getElementById(`content-${day}`).classList.add("active");
  if (modifiedData[day]) renderTable(day, modifiedData[day]);
  updateCounter();
}

// ─── Tabla principal ──────────────────────────────────────────────────────────
function renderTable(day, data, searchTerm = "") {
  const container = document.getElementById(`content-${day}`);
  if (!container) return;
  container.innerHTML = "";

  if (!data || data.length === 0) {
    container.innerHTML = "<p>No hay datos para mostrar.</p>";
    return;
  }

  const term = normalizeText(searchTerm);

  const filtered = data
    .map((row, realIndex) => ({ row, realIndex }))
    .filter(
      ({ row }) =>
        normalizeText(row.NombreBebe).includes(term) ||
        normalizeText(row.NombreMadre).includes(term)
    );

  // NoCidi y Extras arriba
  filtered.sort((a, b) => {
    const prioridad = (row) => {
      if (row.NoCidi    === "Sí") return 2;
      if (row.Visitante === "Sí") return 1;
      return 0;
    };
    return prioridad(b.row) - prioridad(a.row);
  });

  if (filtered.length === 0) {
    container.innerHTML = "<p>No se encontraron resultados.</p>";
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Nombre Bebé</th><th>Nombre Madre</th><th>Fase</th>
        <th>Programa</th><th>Edad (meses)</th><th>Asistencia</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  filtered.forEach(({ row, realIndex }) => {
    const tr = document.createElement("tr");
    if (row.NoCidi === "Sí") {
      tr.className = "nocidi-row";
    } else if (row.Visitante === "Sí") {
      tr.className = "visitor-row";
    } else if (row.Asistencia === "Sí") {
      tr.className = "present-row";
    } else {
      tr.className = "absent-row";
    }
    renderRow(tr, row, day, realIndex);
    tbody.appendChild(tr);
    if (tr._accordionTr) tbody.appendChild(tr._accordionTr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
  updateCounter();
}

function renderRow(tr, row, day, index) {
  tr.innerHTML = `<td>${row.NombreBebe}</td><td>${row.NombreMadre}</td>`;

  const selectPrograma = createSelect(
    Programas,
    row.ProgramaMadre,
    (val) => updateField(day, index, "ProgramaMadre", val),
    "Seleccionar"
  );

  const selectFase = createSelect(
    Instituciones,
    row.InstitucionMadre,
    (val) => {
      updateField(day, index, "InstitucionMadre", val);
      if (val === "TSF") {
        updateField(day, index, "ProgramaMadre", "");
        selectPrograma.value    = "";
        selectPrograma.disabled = true;
      } else {
        selectPrograma.disabled = false;
      }
    },
    "Seleccionar"
  );

  if (row.InstitucionMadre === "TSF") selectPrograma.disabled = true;

  tr.appendChild(wrapInTd(selectFase));
  tr.appendChild(wrapInTd(selectPrograma));

  // Edad — chip toggle
  const edadChip = document.createElement("button");
  edadChip.type      = "button";
  const edadClass    = row.Edad ? " has-edad edad-" + row.Edad.replace("-", "_") : "";
  edadChip.className = "btn-edad-chip" + edadClass;
  edadChip.textContent = row.Edad || "—";
  edadChip.title     = "Click para cambiar edad";
  edadChip.addEventListener("click", () => {
    const opciones = ["6-15", "16-30"];
    const idx  = opciones.indexOf(row.Edad);
    const next = opciones[(idx + 1) % opciones.length];
    updateField(day, index, "Edad", next);
    edadChip.textContent = next;
    edadChip.className   = "btn-edad-chip has-edad edad-" + next.replace("-", "_");
  });
  tr.appendChild(wrapInTd(edadChip));

  // ── Celda asistencia: botones Sí/No + acordeón de reporte ──
  const tdAsis = document.createElement("td");
  tdAsis.className = "td-asistencia";

  const btnPair = document.createElement("div");
  btnPair.className = "btn-pair";

  const btnSi = document.createElement("button");
  btnSi.type      = "button";
  btnSi.textContent = "Sí";
  btnSi.className = "btn-asis btn-si" + (row.Asistencia === "Sí" ? " active" : "");

  const btnNo = document.createElement("button");
  btnNo.type      = "button";
  btnNo.textContent = "No";
  btnNo.className = "btn-asis btn-no" + (row.Asistencia === "No" ? " active" : "");

  const btnVer = document.createElement("button");
  btnVer.type      = "button";
  btnVer.className = "btn-ver-reporte" + (row.Reporte === "Sí" ? "" : " acc-hidden");
  btnVer.textContent = "Ver";

  const btnEditar = document.createElement("button");
  btnEditar.type      = "button";
  btnEditar.className = "btn-editar-reporte" + (row.Reporte === "Sí" ? "" : " acc-hidden");
  btnEditar.textContent = "Editar";

  btnPair.appendChild(btnSi);
  btnPair.appendChild(btnNo);
  btnPair.appendChild(btnVer);
  btnPair.appendChild(btnEditar);
  tdAsis.appendChild(btnPair);
  tr.appendChild(tdAsis);

  // ── Fila acordeón ──
  const accordionTr = document.createElement("tr");
  accordionTr.className = "accordion-tr acc-hidden";

  const accordionTd = document.createElement("td");
  accordionTd.colSpan   = 6;
  accordionTd.className = "accordion-td";

  const yaReportado = row.Reporte === "Sí";
  const formDiv = document.createElement("div");
  formDiv.className = "reporte-form" + (yaReportado ? " acc-hidden" : "");

  const grpUbic = document.createElement("div");
  grpUbic.className = "rpf-field";
  grpUbic.innerHTML = "<label>Ubicación</label>";
  const selUbic = createSelect(
    ["Juanfe", "Casa", "Otro"],
    row.Ubicacion,
    (val) => updateField(day, index, "Ubicacion", val),
    "Seleccionar"
  );
  grpUbic.appendChild(selUbic);

  const grpRep = document.createElement("div");
  grpRep.className = "rpf-field";
  grpRep.innerHTML = "<label>Reporte</label>";
  const selRep = createSelect(["Sí", "No"], row.Reporte, (val) => {
    updateField(day, index, "Reporte", val);
    grpSitu.style.display = val === "Sí" ? "" : "none";
    grpNota.style.display = val === "Sí" ? "" : "none";
  });
  grpRep.appendChild(selRep);

  const grpSitu = document.createElement("div");
  grpSitu.className    = "rpf-field";
  grpSitu.style.display = row.Reporte === "Sí" ? "" : "none";
  grpSitu.innerHTML    = "<label>Situación</label>";
  const selSitu = createSelect(
    diseaseOptions,
    row.SituacionEspecifica,
    (val) => updateField(day, index, "SituacionEspecifica", val),
    "Seleccionar"
  );
  grpSitu.appendChild(selSitu);

  const grpNota = document.createElement("div");
  grpNota.className    = "rpf-field";
  grpNota.style.display = row.Reporte === "Sí" ? "" : "none";
  grpNota.innerHTML    = "<label>Nota</label>";
  const inputNota = document.createElement("input");
  inputNota.type        = "text";
  inputNota.value       = row.Nota || "";
  inputNota.placeholder = "Observación...";
  inputNota.oninput = (e) => updateField(day, index, "Nota", e.target.value);
  grpNota.appendChild(inputNota);

  const btnGuardar = document.createElement("button");
  btnGuardar.type      = "button";
  btnGuardar.className = "btn-guardar-reporte";
  btnGuardar.textContent = "Guardar reporte";
  btnGuardar.onclick = () => {
    saveToLocalStorage();
    const r = modifiedData[day][index];
    formDiv.classList.add("acc-hidden");
    summaryDiv.classList.remove("acc-hidden");
    btnVer.classList.remove("acc-hidden");
    btnEditar.classList.remove("acc-hidden");
    btnVer.title = `${r.SituacionEspecifica || "Sin situación"}${r.Nota ? " · " + r.Nota : ""}`;
    accordionTr.classList.add("acc-hidden");
    updateCounter();
  };

  formDiv.appendChild(grpUbic);
  formDiv.appendChild(grpRep);
  formDiv.appendChild(grpSitu);
  formDiv.appendChild(grpNota);
  formDiv.appendChild(btnGuardar);

  const summaryDiv = document.createElement("div");
  summaryDiv.className = "reporte-summary" + (yaReportado ? "" : " acc-hidden");

  const summaryText = document.createElement("span");
  summaryText.className = "reporte-summary-text";
  summaryText.innerHTML = yaReportado
    ? `✅ <strong>${row.SituacionEspecifica || "Sin situación"}</strong>${row.Nota ? " · " + row.Nota : ""}`
    : "";

  summaryDiv.appendChild(summaryText);
  accordionTd.appendChild(formDiv);
  accordionTd.appendChild(summaryDiv);
  accordionTr.appendChild(accordionTd);

  const getRowClass = () => {
    if (row.NoCidi    === "Sí") return "nocidi-row";
    if (row.Visitante === "Sí") return "visitor-row";
    return "";
  };

  btnSi.addEventListener("click", () => {
    if (row.Asistencia === "Sí") {
      updateField(day, index, "Asistencia", "");
      btnSi.classList.remove("active");
      btnNo.classList.remove("active");
      tr.className = getRowClass() || "neutral-row";
      accordionTr.classList.add("acc-hidden");
    } else {
      updateField(day, index, "Asistencia", "Sí");
      btnSi.classList.add("active");
      btnNo.classList.remove("active");
      tr.className = getRowClass() || "present-row";
      accordionTr.classList.add("acc-hidden");
    }
    updateCounter();
  });

  btnNo.addEventListener("click", () => {
    if (row.Asistencia === "No") {
      updateField(day, index, "Asistencia", "");
      btnNo.classList.remove("active");
      btnSi.classList.remove("active");
      tr.className = getRowClass() || "neutral-row";
      accordionTr.classList.add("acc-hidden");
    } else {
      updateField(day, index, "Asistencia", "No");
      btnNo.classList.add("active");
      btnSi.classList.remove("active");
      tr.className = getRowClass() || "absent-row";
      accordionTr.classList.remove("acc-hidden");
    }
    updateCounter();
  });

  btnVer.onclick = () => {
    accordionTr.classList.toggle("acc-hidden");
    if (!accordionTr.classList.contains("acc-hidden")) {
      summaryDiv.classList.remove("acc-hidden");
      formDiv.classList.add("acc-hidden");
    }
  };

  btnEditar.onclick = () => {
    accordionTr.classList.remove("acc-hidden");
    formDiv.classList.remove("acc-hidden");
    summaryDiv.classList.add("acc-hidden");
  };

  tr._accordionTr = accordionTr;
}

// ─── Helpers de UI ────────────────────────────────────────────────────────────
function createSelect(options, currentVal, onChange, placeholder = null) {
  const sel = document.createElement("select");

  if (placeholder) {
    const def = document.createElement("option");
    def.value    = "";
    def.textContent = placeholder;
    def.disabled = true;
    if (!currentVal) def.selected = true;
    sel.appendChild(def);
  }

  options.forEach((opt) => {
    const val  = typeof opt === "string" ? opt : opt.value;
    const text = typeof opt === "string" ? opt : opt.text;
    const o = document.createElement("option");
    o.value       = val;
    o.textContent = text;
    if (val === currentVal) o.selected = true;
    sel.appendChild(o);
  });

  sel.onchange = (e) => onChange(e.target.value);
  return sel;
}

function wrapInTd(el) {
  const td = document.createElement("td");
  td.appendChild(el);
  return td;
}

// ─── Persistencia ─────────────────────────────────────────────────────────────
function updateField(day, index, field, value) {
  if (modifiedData[day]?.[index] !== undefined) {
    modifiedData[day][index][field] = value;
    saveToLocalStorage();
  }
}

function saveToLocalStorage() {
  localStorage.setItem("datos_asistencia", JSON.stringify(modifiedData));
  localStorage.setItem("master_data_babies", JSON.stringify(masterData));
}

function loadFromLocalStorage() {
  const savedData   = localStorage.getItem("datos_asistencia");
  const savedMaster = localStorage.getItem("master_data_babies");
  if (savedData) {
    modifiedData = JSON.parse(savedData);
    renderAllSavedTabs();
    exportBtn.disabled = false;
  }
  if (savedMaster) {
    masterData = JSON.parse(savedMaster);
  }
}

function renderAllSavedTabs() {
  daysTabs.innerHTML    = "";
  tabsContent.innerHTML = "";
  let firstDay = null;

  DIAS.forEach((day) => {
    if (!modifiedData[day]) return;
    if (!firstDay) firstDay = day;
    renderTabHeader(day, false);
    renderTabContainer(day, false);
    renderTable(day, modifiedData[day]);
  });

  if (firstDay) {
    const firstTab     = document.querySelector(`.tab[data-day="${firstDay}"]`);
    const firstContent = document.getElementById(`content-${firstDay}`);
    if (firstTab)    firstTab.classList.add("active");
    if (firstContent) firstContent.classList.add("active");
  }
}

// ─── Exportación a Excel + guardado en Supabase ───────────────────────────────
function exportToExcel() {
  const activeTab = document.querySelector(".tab.active");
  if (!activeTab) {
    alert("Por favor, selecciona un día primero.");
    return;
  }

  const dayToExport = activeTab.dataset.day;
  const sheetName   = dayToExport === "Miércoles" ? "Miercoles" : dayToExport;
  const dataToExport = modifiedData[dayToExport] || [];

  if (dataToExport.length === 0) {
    alert(`No hay datos para exportar en el día ${dayToExport}`);
    return;
  }

  const today    = new Date();
  const fechaISO = today.toISOString().split("T")[0];

  // 1. Preparar filas para el Excel
  const dataOrdered = dataToExport.map((row) => {
    const newRow = { Fecha: fechaISO, Dia: dayToExport };
    columnOrder.forEach((key) => {
      newRow[columnHeaders[key]] =
        key === "Asistencia" ? row[key] || "No" : (row[key] ?? "");
    });
    return newRow;
  });

  // 2. Generar y descargar el Excel
  const newWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    newWb,
    XLSX.utils.json_to_sheet(dataOrdered),
    sheetName
  );
  const nombreArchivo = `asistencia-${dayToExport}-${formatDate(new Date())}.xlsx`;
  XLSX.writeFile(newWb, nombreArchivo);

  // 3. Respaldo en disco del servidor (histórico)
  const wbOut = XLSX.write(newWb, { bookType: "xlsx", type: "base64" });
  fetch("/api/historico/guardar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: nombreArchivo, datos: wbOut }),
  })
    .then((r) => r.json())
    .then((r) => { if (r.ok) console.log("✅ Respaldo en disco:", r.archivo); })
    .catch((e) => console.warn("⚠️ No se pudo guardar respaldo en disco:", e.message));

  // 4. Guardar asistencia en Supabase vía servidor
  const registrosParaSupabase = dataToExport.map((row) => ({
    NombreBebe:          row.NombreBebe          || "",
    NombreMadre:         row.NombreMadre         || "",
    InstitucionMadre:    row.InstitucionMadre    || "",
    ProgramaMadre:       row.ProgramaMadre       || "",
    Edad:                row.Edad                || "",
    Asistencia:          row.Asistencia          || "No",
    Ubicacion:           row.Ubicacion           || "",
    Reporte:             row.Reporte             || "No",
    SituacionEspecifica: row.SituacionEspecifica || "",
    Nota:                row.Nota                || "",
    Visitante:           row.Visitante           || "",
    NoCidi:              row.NoCidi              || "",
  }));

  fetch("/api/asistencia/guardar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fecha:     fechaISO,
      dia:       dayToExport,
      registros: registrosParaSupabase,
    }),
  })
    .then((r) => r.json())
    .then((r) => {
      if (r.ok) {
        console.log(`✅ Supabase: ${r.guardados} registros — ${dayToExport} ${fechaISO}`);
      } else {
        console.warn("⚠️ Supabase error:", r.error);
      }
    })
    .catch((e) => console.warn("⚠️ No se pudo guardar en Supabase:", e.message));

  console.log(`✅ Excel exportado: ${dayToExport} ${fechaISO}`);

  // 5. Limpiar asistencia para el día siguiente (conserva la nómina base)
  modifiedData[dayToExport] = modifiedData[dayToExport].filter(
    (row) => row.Visitante !== "Sí" && row.NoCidi !== "Sí"
  );
  modifiedData[dayToExport].forEach((row) => {
    row.Asistencia          = "";
    row.Edad                = "";
    row.Ubicacion           = "";
    row.Reporte             = "No";
    row.SituacionEspecifica = "";
    row.Nota                = "";
  });

  saveToLocalStorage();
  searchInput.value = "";
  renderTable(dayToExport, modifiedData[dayToExport]);
}

// ─── Navegación de pestañas ───────────────────────────────────────────────────
function openCurrentDayTab() {
  // Mapea número de día JS al nombre usado en la BD (sin tilde)
  const daysMap = {
    1: "Lunes",
    2: "Martes",
    3: "Miercoles",
    4: "Jueves",
    5: "Viernes",
  };
  const todayName = daysMap[new Date().getDay()];
  const todayTab  = todayName && document.querySelector(`.tab[data-day="${todayName}"]`);
  if (todayTab) {
    todayTab.click();
    updateCounter();
  }
}

function getTodaySheetName() {
  const names = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sábado"];
  return names[new Date().getDay()];
}

// ─── Utilidades ───────────────────────────────────────────────────────────────
function normalizeText(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}-${m}-${date.getFullYear()}`;
}

function filterData() {
  const term     = normalizeText(searchInput.value);
  const activeTab = document.querySelector(".tab.active");
  if (!activeTab) return;
  const day = activeTab.dataset.day;
  if (modifiedData[day]) renderTable(day, modifiedData[day], term);
}

function edadRangoLabel(rows) {
  const c615  = rows.filter((r) => r.Edad === "6-15").length;
  const c1630 = rows.filter((r) => r.Edad === "16-30").length;
  if (c615 === 0 && c1630 === 0) return "";
  return `6-15: ${c615}   |   16-30: ${c1630}`;
}

function updateCounter() {
  const activeTab  = document.querySelector(".tab.active");
  const counterBar = document.getElementById("counter-bar");
  if (!activeTab || !counterBar) return;

  const day  = activeTab.dataset.day;
  const data = modifiedData[day] || [];

  const total        = data.length;
  const presentRows  = data.filter((r) => r.Asistencia === "Sí");
  const present      = presentRows.length;
  const absent       = data.filter((r) => r.Asistencia === "No" || r.Asistencia === "" || !r.Asistencia).length;
  const reported     = data.filter((r) => r.Reporte === "Sí").length;
  const extras       = data.filter((r) => r.Visitante === "Sí").length;
  const noCidi       = data.filter((r) => r.NoCidi === "Sí").length;

  document.getElementById("count-total").textContent    = total;
  document.getElementById("count-present").textContent  = present;
  document.getElementById("count-absent").textContent   = absent;
  document.getElementById("count-reported").textContent = reported;
  document.getElementById("count-extras").textContent   = extras;
  document.getElementById("count-nocidi").textContent   = noCidi;

  const ageEl = document.getElementById("count-present-ages");
  if (ageEl) {
    const label = edadRangoLabel(presentRows);
    ageEl.textContent  = label;
    ageEl.style.display = label ? "block" : "none";
  }

  counterBar.style.display = total > 0 ? "flex" : "none";
}

// ─── Modal: Añadir Bebé ───────────────────────────────────────────────────────
function addAddBabyButton() {
  const addBabyBtn = document.getElementById("add-baby-btn");
  if (!addBabyBtn) return;
  if (addBabyBtn.dataset.listenerRegistered) return;
  addBabyBtn.dataset.listenerRegistered = "true";

  const modal          = document.getElementById("addBabyModal");
  const closeBtn       = document.querySelector(".close");
  const babyForm       = document.getElementById("babyForm");
  const searchBabyInput = document.getElementById("searchBaby");
  const searchResults  = document.getElementById("searchResults");
  const babyNameInput  = document.getElementById("babyName");
  const motherNameInput = document.getElementById("motherName");
  const instSelect     = document.getElementById("motherInstitucion");
  const progSelect     = document.getElementById("motherPrograma");
  const edadSelect     = document.getElementById("babyEdad");
  const visitanteCheck = document.getElementById("esVisitante");
  const noCidiCheck    = document.getElementById("esNoCidi");

  // TSF bloquea programa
  instSelect.addEventListener("change", () => {
    if (instSelect.value === "TSF") {
      progSelect.value    = "";
      progSelect.disabled = true;
    } else {
      progSelect.disabled = false;
    }
  });

  // Bloqueo mutuo Visitante ↔ NoCidi
  visitanteCheck.addEventListener("change", () => {
    noCidiCheck.disabled = visitanteCheck.checked;
    if (visitanteCheck.checked) noCidiCheck.checked = false;
  });
  noCidiCheck.addEventListener("change", () => {
    visitanteCheck.disabled = noCidiCheck.checked;
    if (noCidiCheck.checked) visitanteCheck.checked = false;
  });

  function resetModal() {
    babyForm.reset();
    searchBabyInput.value     = "";
    searchResults.innerHTML   = "";
    searchResults.style.display = "none";
    visitanteCheck.disabled   = false;
    noCidiCheck.disabled      = false;
    progSelect.disabled       = false;
  }

  function fillForm(baby) {
    searchBabyInput.value  = baby.NombreBebe;
    babyNameInput.value    = baby.NombreBebe;
    motherNameInput.value  = baby.NombreMadre;
    instSelect.value       = baby.InstitucionMadre || "";
    if (baby.InstitucionMadre === "TSF") {
      progSelect.value    = "";
      progSelect.disabled = true;
    } else {
      progSelect.value    = baby.ProgramaMadre || "";
      progSelect.disabled = false;
    }
    edadSelect.value = baby.Edad || "";
  }

  addBabyBtn.addEventListener("click", () => {
    resetModal();
    modal.style.display = "block";
    searchBabyInput.focus();
  });

  closeBtn.addEventListener("click", () => { modal.style.display = "none"; });

  window.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });

  // Búsqueda en tiempo real dentro del modal
  searchBabyInput.addEventListener("input", () => {
    const term = normalizeText(searchBabyInput.value.trim());
    searchResults.innerHTML = "";
    if (term.length < 2) { searchResults.style.display = "none"; return; }

    const matches = masterData
      .filter(
        (b) =>
          normalizeText(b.NombreBebe).includes(term) ||
          normalizeText(b.NombreMadre).includes(term)
      )
      .slice(0, 8);

    if (matches.length === 0) { searchResults.style.display = "none"; return; }

    matches.forEach((baby) => {
      const item = document.createElement("div");
      item.className = "search-result-item";
      item.innerHTML = `<strong>${baby.NombreBebe}</strong><span>${baby.NombreMadre} · ${baby.InstitucionMadre} ${baby.ProgramaMadre}</span>`;
      item.addEventListener("click", () => {
        fillForm(baby);
        searchResults.style.display = "none";
      });
      searchResults.appendChild(item);
    });
    searchResults.style.display = "block";
  });

  // Submit del formulario
  babyForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const activeTab    = document.querySelector(".tab.active");
    const currentDay   = activeTab ? activeTab.dataset.day : getTodaySheetName();
    const nombreNuevo  = babyNameInput.value.trim();
    const nombreNorm   = normalizeText(nombreNuevo);

    if (modifiedData[currentDay]) {
      const yaExiste = modifiedData[currentDay].some(
        (b) => normalizeText(b.NombreBebe) === nombreNorm
      );
      if (yaExiste) {
        showSmartAlert(
          `El bebé "${nombreNuevo}" ya está en la lista de hoy (${currentDay}). No es necesario agregarlo.`
        );
        return;
      }
    }

    const newBaby = {
      NombreBebe:      babyNameInput.value.trim(),
      NombreMadre:     motherNameInput.value.trim(),
      InstitucionMadre: instSelect.value,
      ProgramaMadre:   progSelect.disabled ? "" : progSelect.value,
      Edad:            edadSelect.value,
      Asistencia:      "Sí",
      Ubicacion:       "",
      Reporte:         "No",
      SituacionEspecifica: "",
      Nota:            "",
      Visitante:       visitanteCheck && visitanteCheck.checked ? "Sí" : "",
      NoCidi:          noCidiCheck    && noCidiCheck.checked    ? "Sí" : "",
    };

    if (!newBaby.NombreBebe || !newBaby.NombreMadre) {
      alert("Por favor complete al menos el nombre del bebé y la madre.");
      return;
    }

    if (!modifiedData[currentDay]) modifiedData[currentDay] = [];

    if (newBaby.Visitante === "Sí" || newBaby.NoCidi === "Sí") {
      modifiedData[currentDay].unshift(newBaby);
    } else {
      modifiedData[currentDay].push(newBaby);
    }

    saveToLocalStorage();
    renderTable(currentDay, modifiedData[currentDay]);
    updateCounter();
    resetModal();
    modal.style.display = "none";
    if (typeof exportBtn !== "undefined") exportBtn.disabled = false;

    console.log(`Bebé "${nombreNuevo}" añadido correctamente.`);
    if (typeof searchInput !== "undefined" && searchInput.value) filterData();
  });
}

// ─── Alerta personalizada ─────────────────────────────────────────────────────
function showSmartAlert(message) {
  const modal   = document.getElementById("smartAlertModal");
  const msgP    = document.getElementById("smartAlertMessage");
  const closeBtn = document.getElementById("closeSmartAlert");

  msgP.textContent    = message;
  modal.style.display = "block";

  closeBtn.onclick = () => { modal.style.display = "none"; };
  window.onclick = (event) => {
    if (event.target == modal) modal.style.display = "none";
  };
}

// ─── Navegar al dashboard ─────────────────────────────────────────────────────
function abrirGraficas() {
  window.location.replace("/dashboard");
}
