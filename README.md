# CIDI Asistencia — Fundación Juanfe

Sistema de control de asistencia para el CIDI (Centro Integral de Desarrollo Infantil).
Conectado directamente a **Supabase** como base de datos principal.

---

## Estructura del proyecto

```
cidi-asistencia/
├── server.js               ← Servidor Express + endpoints API
├── package.json
├── .env                    ← Variables de entorno (no subir a Git)
├── .gitignore
│
├── public/
│   ├── index.html          ← App de asistencia diaria (profesoras)
│   ├── app.js              ← Lógica principal — carga desde Supabase
│   ├── style.css
│   ├── dashboard.html      ← Dashboard de gráficas (coordinadora)
│   ├── dashboard.js        ← Lógica del dashboard
│   ├── dashboard.css
│   └── img/
│       └── Logo-Juanfe-verde-1-1.png
│
├── historico/              ← Respaldo local de Excels exportados
├── conexionexcel.js        ← Script de importación del Excel Maestro
└── importar2.js            ← Script de importación histórica
```

---

## Variables de entorno (.env)

Crear un archivo `.env` en la raíz del proyecto con:

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...
PORT=3000
```

---

## Tablas en Supabase

El proyecto usa **3 tablas** en Supabase:

### 1. `bebes` — Catálogo maestro de bebés
```sql
CREATE TABLE public.bebes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_bebe   text NOT NULL,
  nombre_madre  text,
  institucion   text,   -- Fase: UTE, ULA 1, ULA 2, TSF, Otra
  programa      text,   -- Hotelería, Cocina, Belleza, etc.
  edad          text,   -- Rango: "6-15" o "16-30"
  created_at    timestamptz DEFAULT now()
);
```

### 2. `asistencias` — Qué días asiste cada bebé (nómina semanal)
```sql
CREATE TABLE public.asistencias (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bebe_id  uuid REFERENCES public.bebes(id) ON DELETE CASCADE,
  dia      text NOT NULL,  -- Lunes, Martes, Miercoles, Jueves, Viernes
  UNIQUE (bebe_id, dia)
);
```

### 3. `registros_asistencia` — Registro diario de asistencia
```sql
CREATE TABLE public.registros_asistencia (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_bebe          text NOT NULL,
  nombre_madre         text,
  institucion          text,
  programa             text,
  edad                 text,
  fecha                date NOT NULL,
  dia                  text,
  asistencia           text DEFAULT 'No',
  ubicacion            text,
  reporte              text DEFAULT 'No',
  situacion_especifica text,
  nota                 text,
  visitante            text,
  no_cidi              text,
  created_at           timestamptz DEFAULT now(),
  UNIQUE (nombre_bebe, nombre_madre, fecha)
);
```

---

## Correr localmente

```bash
npm install
npm start
# App principal:  http://localhost:3000
# Dashboard:      http://localhost:3000/dashboard
```

---

## Deploy en Railway

1. Subir el proyecto a un repositorio de GitHub
2. Entrar a [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Seleccionar el repositorio
4. En **Variables** agregar `SUPABASE_URL` y `SUPABASE_SERVICE_KEY`
5. Railway detecta el `package.json` y hace el deploy automáticamente
6. En **Settings → Networking → Generate Domain** → copiar la URL pública

---

## Importar el Excel Maestro a Supabase

Cuando se tiene un Excel Maestro con la nómina de bebés:

```bash
node conexionexcel.js ./Excel_Maestro.xlsx
```

Este script lee cada hoja (Lunes, Martes, etc.) e inserta los bebés
en la tabla `bebes` y sus días en `asistencias`.

---

## Importar histórico de Excels

Para cargar múltiples archivos de asistencia histórica desde una carpeta:

```bash
# 1. Crear la carpeta y copiar los Excels ahí
mkdir historico
# copiar los archivos .xlsx dentro de /historico

# 2. Ejecutar el importador
node importar2.js
```

Los registros se guardan en `registros_asistencia` sin duplicar
(usa upsert por `nombre_bebe + nombre_madre + fecha`).

---

## Flujo completo del sistema

```
Excel Maestro
     ↓ node conexionexcel.js
  Supabase (bebes + asistencias)
     ↓ GET /api/sheet/:dia
  App profesora (index.html)
     ↓ marca asistencia → "Exportar"
     ↓ POST /api/asistencia/guardar
  Supabase (registros_asistencia)
     ↓ GET /api/asistencia?desde=...&hasta=...
  Dashboard coordinadora (dashboard.html)
     ↓ gráficas, KPIs, exportar Excel
```

---

## Cómo agregar un bebé nuevo

1. La coordinadora abre la app → botón **＋ Añadir Bebé**
2. Completa el formulario (nombre, madre, fase, programa, edad)
3. El bebé queda guardado en Supabase y aparece en el listado
4. Si el bebé debe asistir varios días, se agrega en cada tab correspondiente

---

## Endpoints del servidor

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/sheet/:dia` | Lista de bebés del día (CSV) |
| GET | `/api/bebes` | Catálogo completo de bebés |
| GET | `/api/dias` | Días disponibles en la BD |
| POST | `/api/bebes` | Agregar o actualizar bebé |
| POST | `/api/asistencia/guardar` | Guardar asistencia del día |
| GET | `/api/asistencia` | Consultar registros (con filtros de fecha) |
| GET | `/api/historico` | Listar Excels de respaldo |
| GET | `/api/historico/:nombre` | Descargar Excel de respaldo |