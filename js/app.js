
/**
 * Plataforma EZE - Operativo + Editor protegido
 * - Modo operativo por defecto (lee plano + muestra aviones)
 * - Editor con contraseña 12345678
 * - Cargar posiciones con modal (nombre + HDG slider con flecha/preview)
 * - Editar aeropuerto (líneas con color + grosor, dibujar/borrar, undo)
 * - Mapa fijo (sin pan/zoom nativo), el usuario se mueve arrastrando manual
 * - Aviones: icono naranja, tamaño por tipo, tarjeta de matrícula al costado (no gira)
 * - Sync Excel: pegar URL de Apps Script que devuelve JSON (matricula, posicion, vuelo, origen, tipo opcional)
 */

// ====== CONFIG ======
const EDITOR_PASSWORD = "12345678";
const TYPE_SIZE = { E190: 32, B737: 44, A320: 48 };
const PLANE_COLOR = "#ff7a00";
const STAND_VECTOR_COLOR = "#FFD100";
// Pegá tu Apps Script acá cuando lo tengas (debe devolver JSON array)
const SCRIPT_URL = "PEGAR_URL_APPS_SCRIPT_AQUI";

// ====== STATE ======
let editorMode = false;
let actionMode = null; // 'loadPos' | 'airportDraw' | 'airportErase' | null
let tempPreview = { arrow: null, plane: null };

let stands = JSON.parse(localStorage.getItem("stands") || "[]"); // {id,name,lat,lng,hdg,typeHint?}
let lines  = JSON.parse(localStorage.getItem("lines")  || "[]"); // {id,points,color,weight}
let planes = JSON.parse(localStorage.getItem("planes") || "[]"); // {id,reg,type,state,standId,flight,origin}

let undoStack = []; // snapshots {stands,lines}

// ====== MAP ======
const map = L.map("map", { zoomControl: false, attributionControl: false }).setView([-34.8222, -58.5358], 16);
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}").addTo(map);

// lock native interaction
map.dragging.disable();
map.scrollWheelZoom.disable();
map.doubleClickZoom.disable();
map.boxZoom.disable();
map.keyboard.disable();
map.touchZoom.disable();

// manual drag (you move over the airport)
let dragging = false;
let start = null;
map.getContainer().addEventListener("mousedown", (e) => {
  dragging = true;
  start = { x: e.clientX, y: e.clientY };
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  map.panBy([start.x - e.clientX, start.y - e.clientY], { animate: false });
  start = { x: e.clientX, y: e.clientY };
});
window.addEventListener("mouseup", () => (dragging = false));

// ====== DOM ======
const modePill = document.getElementById("modePill");
const opsPanel = document.getElementById("opsPanel");
const editorPanel = document.getElementById("editorPanel");
const editorOverlay = document.getElementById("editorOverlay");

const btnEnterEditor = document.getElementById("btnEnterEditor");
const btnExitEditor = document.getElementById("btnExitEditor");
const btnLoadPos = document.getElementById("btnLoadPos");
const btnEditAirport = document.getElementById("btnEditAirport");
const btnUndo = document.getElementById("btnUndo");
const btnSync = document.getElementById("btnSync");

const btnDrawLine = document.getElementById("btnDrawLine");
const btnEraseLine = document.getElementById("btnEraseLine");
const lnColor = document.getElementById("lnColor");
const lnWeight = document.getElementById("lnWeight");

const planeList = document.getElementById("planeList");
const standList = document.getElementById("standList");

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalOk = document.getElementById("modalOk");
const modalCancel = document.getElementById("modalCancel");
const modalX = document.getElementById("modalX");

// ====== HELPERS ======
function save() {
  localStorage.setItem("stands", JSON.stringify(stands));
  localStorage.setItem("lines", JSON.stringify(lines));
  localStorage.setItem("planes", JSON.stringify(planes));
}
function snapshot() {
  // deep-ish copy via JSON for simplicity
  undoStack.push(JSON.stringify({ stands, lines }));
  if (undoStack.length > 50) undoStack.shift();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  const data = JSON.parse(prev);
  stands = data.stands;
  lines = data.lines;
  save();
  renderAll();
}
function openModal(title, html, onOk) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modal.hidden = false;

  const close = () => {
    modal.hidden = true;
    clearTempPreview();
  };

  modalOk.onclick = () => {
    onOk?.();
    close();
  };
  modalCancel.onclick = close;
  modalX.onclick = close;
}
function clearTempPreview() {
  if (tempPreview.arrow) map.removeLayer(tempPreview.arrow);
  if (tempPreview.plane) map.removeLayer(tempPreview.plane);
  tempPreview.arrow = null;
  tempPreview.plane = null;
}
function clampDeg(v) {
  const n = Number(v) || 0;
  return ((n % 360) + 360) % 360;
}
function planeSVG(size, color) {
  // simple airplane silhouette; color via currentColor
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="color:${color}">
    <path d="M31 4c3 0 4 2 4 4v15l19 10c1 1 1 3 0 4l-2 2c-1 1-2 1-3 0L35 33v10l6 5c1 1 1 2 0 3l-1 2c-1 1-2 1-3 0l-7-4-7 4c-1 1-2 1-3 0l-1-2c-1-1-1-2 0-3l6-5V33L15 43c-1 1-2 1-3 0l-2-2c-1-1-1-3 0-4l19-10V8c0-2 1-4 2-4z" fill="currentColor"/>
  </svg>`;
}
function standVectorEnd(lat, lng, hdg, len = 0.00009) {
  const rad = (hdg - 90) * Math.PI / 180;
  return [lat + len * Math.sin(rad), lng + len * Math.cos(rad)];
}
function centerOn(lat, lng) {
  map.panTo([lat, lng], { animate: false });
}
function findStandByName(name) {
  const key = String(name || "").trim().toUpperCase();
  return stands.find(s => String(s.name).trim().toUpperCase() === key);
}
function findPlaneByReg(reg) {
  const key = String(reg || "").trim().toUpperCase();
  return planes.find(p => String(p.reg).trim().toUpperCase() === key);
}
function planeCardHtml(p, stand) {
  const size = TYPE_SIZE[p.type] || 44;
  const rot = clampDeg(stand.hdg);
  return `
    <div style="transform:rotate(${rot}deg)">${planeSVG(size, PLANE_COLOR)}</div>
    <div class="planeCard">
      <b>${escapeHtml(p.reg)}</b>
      <small>${escapeHtml(p.type || "B737")} · ${escapeHtml(stand.name)}</small>
      ${p.flight ? `<small>${escapeHtml(p.flight)} · ${escapeHtml(p.origin||"")}</small>` : ""}
    </div>
  `;
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

// ====== RENDER ======
function renderPlaneList() {
  planeList.innerHTML = "";
  const sorted = [...planes].sort((a,b) => (a.reg||"").localeCompare(b.reg||""));
  for (const p of sorted) {
    const stand = stands.find(s => s.id === p.standId);
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="row">
        <div><b>${escapeHtml(p.reg)}</b></div>
        <div class="kbd">${stand ? escapeHtml(stand.name) : "—"}</div>
      </div>
      <small>${escapeHtml(p.type || "B737")}${p.flight ? " · "+escapeHtml(p.flight) : ""}</small>
    `;
    div.onclick = () => { if (stand) centerOn(stand.lat, stand.lng); };
    planeList.appendChild(div);
  }
}

function renderStandList() {
  standList.innerHTML = "";
  const sorted = [...stands].sort((a,b)=> (a.name||"").localeCompare(b.name||""));
  for (const s of sorted) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="row">
        <div><b>${escapeHtml(s.name)}</b></div>
        <div class="kbd">HDG ${clampDeg(s.hdg)}</div>
      </div>
      <small>Click para centrar · Slider para ajustar</small>
      <div class="sep"></div>
      <input data-stand="${s.id}" type="range" min="0" max="360" value="${clampDeg(s.hdg)}"/>
      <div class="row" style="justify-content:space-between;margin-top:8px;gap:10px">
        <button data-del="${s.id}" class="btn" style="padding:8px">🗑️ Eliminar</button>
      </div>
    `;
    div.onclick = (ev) => {
      // don't trigger center when interacting with controls
      const t = ev.target;
      if (t && (t.tagName === "INPUT" || t.dataset.del)) return;
      centerOn(s.lat, s.lng);
    };

    const slider = div.querySelector("input[type=range]");
    slider.oninput = () => {
      if (!editorMode) return;
      snapshot();
      s.hdg = clampDeg(slider.value);
      save();
      renderAll();
    };

    const delBtn = div.querySelector("button[data-del]");
    delBtn.onclick = (ev) => {
      ev.stopPropagation();
      if (!editorMode) return;
      if (!confirm(`Eliminar posición ${s.name}?`)) return;
      snapshot();
      // remove planes assigned to this stand
      planes = planes.filter(p => p.standId !== s.id);
      stands = stands.filter(x => x.id !== s.id);
      save();
      renderAll();
    };

    standList.appendChild(div);
  }
}

let layerGroup = L.layerGroup().addTo(map);

function renderMap() {
  layerGroup.clearLayers();

  // lines
  for (const l of lines) {
    const pl = L.polyline(l.points, { color: l.color, weight: l.weight }).addTo(layerGroup);
    // attach id for eraser lookup
    pl._lineId = l.id;
  }

  // stands
  for (const s of stands) {
    const end = standVectorEnd(s.lat, s.lng, clampDeg(s.hdg));
    L.circleMarker([s.lat, s.lng], { radius: 3, color: STAND_VECTOR_COLOR }).addTo(layerGroup);
    L.polyline([[s.lat, s.lng], end], { color: STAND_VECTOR_COLOR, weight: 2 }).addTo(layerGroup);

    // label a bit forward in heading direction
    const lblEnd = standVectorEnd(s.lat, s.lng, clampDeg(s.hdg), 0.00011);
    L.marker(lblEnd, {
      icon: L.divIcon({ className: "", html: `<div class="standLabel">${escapeHtml(s.name)}</div>` })
    }).addTo(layerGroup);
  }

  // planes
  for (const p of planes) {
    const stand = stands.find(s => s.id === p.standId);
    if (!stand) continue;
    L.marker([stand.lat, stand.lng], {
      icon: L.divIcon({ className: "", html: planeCardHtml(p, stand) })
    }).addTo(layerGroup);
  }
}

function renderAll() {
  renderMap();
  renderPlaneList();
  renderStandList();
}

// ====== MODES ======
function setEditor(on) {
  editorMode = on;
  if (on) {
    modePill.textContent = "Modo Editor";
    modePill.classList.add("warn");
    opsPanel.hidden = TrueFalse(false); // placeholder
  }
}

// helper because older browsers
function TrueFalse(v){ return !!v; }

function enterEditor() {
  const pwd = prompt("Contraseña modo editor");
  if (pwd !== EDITOR_PASSWORD) return alert("Contraseña incorrecta");
  editorMode = true;
  actionMode = null;

  editorOverlay.hidden = false;
  opsPanel.hidden = true;
  editorPanel.hidden = false;

  modePill.textContent = "Modo Editor";
  modePill.classList.add("warn");
}

function exitEditor() {
  editorMode = false;
  actionMode = null;
  clearTempPreview();

  editorOverlay.hidden = true;
  opsPanel.hidden = false;
  editorPanel.hidden = true;

  modePill.textContent = "Modo Operativo";
  modePill.classList.remove("warn");
}

// ====== EDITOR ACTIONS ======
function startLoadPositions() {
  if (!editorMode) return;
  actionMode = "loadPos";
  alert("Cargar posiciones: hacé click en el mapa para crear una posición.");
}
function startEditAirport() {
  if (!editorMode) return;
  actionMode = "airportDraw";
  alert("Editar aeropuerto: usá Dibujar o Borrar en el panel lateral.");
}
function setAirportTool(tool) {
  if (!editorMode) return;
  actionMode = tool; // 'airportDraw' | 'airportErase'
}

// ====== POSITION MODAL with LIVE PREVIEW ======
function showCreateStandModal(latlng) {
  clearTempPreview();

  openModal("Nueva posición", `
    <div class="form">
      <label>
        <span>Nombre de la posición</span>
        <input id="posName" type="text" placeholder="Ej: 14B, 18A, 2"/>
      </label>
      <label>
        <span>Tipo (preview tamaño)</span>
        <select id="posType">
          <option value="E190">E190</option>
          <option value="B737" selected>B737</option>
          <option value="A320">A320</option>
        </select>
      </label>
      <label>
        <span>Heading (0–360)</span>
        <input id="posHdg" type="range" min="0" max="360" value="0"/>
        <div class="kbd">HDG: <span id="posHdgVal">0</span>°</div>
      </label>
      <div class="hint">Mientras movés el slider, se ve la flecha y el avión (preview).</div>
    </div>
  `, () => {
    const name = document.getElementById("posName").value.trim();
    const hdg = clampDeg(document.getElementById("posHdg").value);
    const typeHint = document.getElementById("posType").value;

    if (!name) return alert("Poné un nombre de posición (ej: 14B).");

    snapshot();
    stands.push({
      id: String(Date.now()),
      name,
      lat: latlng.lat,
      lng: latlng.lng,
      hdg,
      typeHint
    });
    save();
    renderAll();
  });

  const hdgSlider = document.getElementById("posHdg");
  const hdgVal = document.getElementById("posHdgVal");
  const typeSel = document.getElementById("posType");

  function updatePreview() {
    clearTempPreview();
    const hdg = clampDeg(hdgSlider.value);
    hdgVal.textContent = String(hdg);

    // arrow
    const end = standVectorEnd(latlng.lat, latlng.lng, hdg, 0.00011);
    tempPreview.arrow = L.polyline([[latlng.lat, latlng.lng], end], {
      color: "#ffffff",
      weight: 2,
      dashArray: "5,5"
    }).addTo(layerGroup);

    // ghost plane
    const type = typeSel.value;
    const size = TYPE_SIZE[type] || 44;
    const html = `<div style="opacity:.55;transform:rotate(${hdg}deg)">${planeSVG(size, "#cccccc")}</div>`;
    tempPreview.plane = L.marker([latlng.lat, latlng.lng], {
      icon: L.divIcon({ className: "", html })
    }).addTo(layerGroup);
  }

  hdgSlider.oninput = updatePreview;
  typeSel.onchange = updatePreview;
  updatePreview();
}

// ====== AIRPORT DRAW/ERASE ======
let drawing = false;
let currentPts = [];
let currentPreview = null;

function currentLineStyle() {
  return {
    color: lnColor.value || "#ffffff",
    weight: Math.max(1, Math.min(8, parseInt(lnWeight.value || "2", 10)))
  };
}

function beginLine(latlng) {
  drawing = true;
  currentPts = [[latlng.lat, latlng.lng]];
  if (currentPreview) layerGroup.removeLayer(currentPreview);
  currentPreview = L.polyline(currentPts, currentLineStyle()).addTo(layerGroup);
}

function addPoint(latlng) {
  currentPts.push([latlng.lat, latlng.lng]);
  if (currentPreview) currentPreview.setLatLngs(currentPts);
}

function finishLine() {
  if (!drawing) return;
  drawing = false;
  if (currentPreview) layerGroup.removeLayer(currentPreview);
  currentPreview = null;

  if (currentPts.length < 2) return;

  snapshot();
  const style = currentLineStyle();
  lines.push({
    id: String(Date.now() + Math.random()),
    points: currentPts,
    color: style.color,
    weight: style.weight
  });
  currentPts = [];
  save();
  renderAll();
}

function eraseNearestLine(latlng) {
  if (!lines.length) return;
  // find closest polyline by distance to any vertex (simple & fast)
  let best = { idx: -1, d: Infinity };
  for (let i = 0; i < lines.length; i++) {
    const pts = lines[i].points;
    for (const [la, ln] of pts) {
      const d = map.distance(latlng, L.latLng(la, ln));
      if (d < best.d) best = { idx: i, d };
    }
  }
  // threshold ~25 meters (tunable)
  if (best.idx >= 0 && best.d < 25) {
    snapshot();
    lines.splice(best.idx, 1);
    save();
    renderAll();
  } else {
    alert("No encontré una línea cerca para borrar (hacé click más cerca).");
  }
}

// ====== SYNC EXCEL ======
async function syncFromExcel() {
  if (SCRIPT_URL.includes("PEGAR_")) {
    return alert("Pegá la URL del Apps Script en js/app.js (SCRIPT_URL).");
  }
  try {
    const res = await fetch(SCRIPT_URL, { cache: "no-store" });
    const rows = await res.json();

    // rows: [{matricula, posicion, vuelo, origen, tipo?}]
    let changed = false;

    for (const r of rows) {
      const reg = String(r.matricula || "").trim();
      const pos = String(r.posicion || "").trim();
      if (!reg || !pos) continue;

      const stand = findStandByName(pos);
      if (!stand) continue; // stand not defined in editor

      const existing = findPlaneByReg(reg);
      const type = (r.tipo && TYPE_SIZE[r.tipo]) ? r.tipo : (existing?.type || stand.typeHint || "B737");

      // rule: one stand = one plane (if stand already occupied, replace occupant with this reg)
      const occupantIdx = planes.findIndex(p => p.standId === stand.id && String(p.reg).toUpperCase() !== reg.toUpperCase());
      if (occupantIdx >= 0) {
        planes.splice(occupantIdx, 1);
        changed = true;
      }

      if (existing) {
        existing.standId = stand.id;
        existing.type = type;
        existing.flight = r.vuelo || existing.flight || "";
        existing.origin = r.origen || existing.origin || "";
        changed = true;
      } else {
        planes.push({
          id: String(Date.now() + Math.random()),
          reg,
          type,
          state: "ARR",
          standId: stand.id,
          flight: r.vuelo || "",
          origin: r.origen || ""
        });
        changed = true;
      }
    }

    if (changed) {
      save();
      renderAll();
    } else {
      alert("No hubo cambios (revisá que existan las posiciones en el plano).");
    }
  } catch (err) {
    console.error(err);
    alert("Error al sincronizar. Revisá la URL del Apps Script y permisos.");
  }
}

// ====== EVENTS ======
btnEnterEditor.onclick = enterEditor;
btnExitEditor.onclick = exitEditor;
btnLoadPos.onclick = startLoadPositions;
btnEditAirport.onclick = startEditAirport;
btnUndo.onclick = undo;
btnSync.onclick = syncFromExcel;

btnDrawLine.onclick = () => setAirportTool("airportDraw");
btnEraseLine.onclick = () => setAirportTool("airportErase");

map.on("click", (e) => {
  if (!editorMode) return;

  if (actionMode === "loadPos") {
    showCreateStandModal(e.latlng);
    return;
  }

  if (actionMode === "airportDraw") {
    if (!drawing) beginLine(e.latlng);
    else addPoint(e.latlng);
    return;
  }

  if (actionMode === "airportErase") {
    eraseNearestLine(e.latlng);
    return;
  }
});

map.on("dblclick", (e) => {
  if (!editorMode) return;
  if (actionMode === "airportDraw") {
    finishLine();
  }
});

// initial UI state: Operativo
editorOverlay.hidden = true;
opsPanel.hidden = false;
editorPanel.hidden = true;
modePill.textContent = "Modo Operativo";
modePill.classList.remove("warn");

renderAll();
