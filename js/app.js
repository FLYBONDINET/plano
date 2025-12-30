
/************************
 * CONFIG
 ************************/
const PASSWORD = "12345678";
const API_URL = "https://script.google.com/macros/s/AKfycbxxK76o03FV8J_83wRmrDiySOEsIBdVuErPTD7s1-8QRY2_aT4qFJOfrbE88GIfAZzF2g/exec";

/************************
 * MAPA
 ************************/
const map = L.map("map", { zoomControl: true, attributionControl: false })
  .setView([-34.8222, -58.5358], 16);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19 }
).addTo(map);

/************************
 * UI
 ************************/
const btnEditor = document.getElementById("btnEditor");
const btnRefresh = document.getElementById("btnRefresh");
const editorPills = document.getElementById("editorPills");
const btnAddPos = document.getElementById("btnAddPos");
const btnAirport = document.getElementById("btnAirport");
const btnExitEditor = document.getElementById("btnExitEditor");

const sidebar = document.getElementById("sidebar");
const posList = document.getElementById("posList");
const airportTools = document.getElementById("airportTools");
const lineColor = document.getElementById("lineColor");
const lineWidth = document.getElementById("lineWidth");
const btnFinishLine = document.getElementById("btnFinishLine");
const btnUndo = document.getElementById("btnUndo");
const btnClearLines = document.getElementById("btnClearLines");

const flightBox = document.getElementById("flightBox");
const flightList = document.getElementById("flightList");
document.getElementById("closeFlightBox").onclick = () => (flightBox.style.display = "none");

// Password modal
const pwModal = document.getElementById("pwModal");
const pwInput = document.getElementById("pwInput");
document.getElementById("pwCancel").onclick = () => hidePw();
document.getElementById("pwOk").onclick = () => tryEnterEditor();

// Position modal
const posModal = document.getElementById("posModal");
const posModalTitle = document.getElementById("posModalTitle");
const posName = document.getElementById("posName");
const posHdg = document.getElementById("posHdg");
const posColor = document.getElementById("posColor");
const labelPos = document.getElementById("labelPos");
const hdgVal = document.getElementById("hdgVal");
const posDelete = document.getElementById("posDelete");
document.getElementById("posCancel").onclick = () => closePosModal();
document.getElementById("posSave").onclick = () => savePosFromModal();
posDelete.onclick = () => deleteEditingPos();

/************************
 * ESTADO
 ************************/
let isEditor = false;
let editorMode = null; // "pos" | "apt" | null

// posiciones
let positions = loadJSON("eze_positions", []); // [{id,name,lat,lng,hdg,color,labelPos}]
let lines = loadJSON("eze_airport_lines", []); // [{points:[[lat,lng],...], color, width}]

// capas (posiciones + líneas)
let standLayersById = new Map(); // id -> {group, circle, line, labelMarker}
let airportLineLayers = [];      // L.Polyline[]
let currentAptLine = null;       // L.Polyline in progress

// preview al crear/editar posición
let pendingLatLng = null; // L.LatLng
let previewLine = null;

// aviones
let aircraftLayers = []; // layers to remove
let aircraftObjs = [];   // {posId, marker, labelMarker, labelPos}

// edición de posición
let editingPosId = null;


function distMeters(a,b){
  const R=6371000;
  const dLat=(b.lat-a.lat)*Math.PI/180;
  const dLng=(b.lng-a.lng)*Math.PI/180;
  const la1=a.lat*Math.PI/180;
  const la2=b.lat*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

/************************
 * UTIL
 ************************/
function normPosName(x){
  return String(x || "").trim().toUpperCase();
}
function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function loadJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{
    return fallback;
  }
}
function saveJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

/************************
 * MODO EDITOR (PASSWORD)
 ************************/
btnEditor.onclick = () => {
  pwInput.value = "";
  pwModal.classList.remove("hidden");
  pwInput.focus();
};

function hidePw(){
  pwModal.classList.add("hidden");
}

function tryEnterEditor(){
  const pw = pwInput.value || "";
  if(pw !== PASSWORD){
    alert("Contraseña incorrecta");
    return;
  }
  hidePw();
  enterEditor();
}

function enterEditor(){
  isEditor = true;
  editorMode = null;

  editorPills.hidden = false;
  btnEditor.disabled = true;

  sidebar.hidden = false;
  airportTools.hidden = true;

  // botones del editor visibles
  btnAddPos.disabled = false;
  btnAirport.disabled = false;
  btnExitEditor.disabled = false;
}

btnExitEditor.onclick = () => {
  isEditor = false;
  editorMode = null;
  btnEditor.disabled = false;
  editorPills.hidden = true;
  sidebar.hidden = true;
  airportTools.hidden = true;

  closePosModal();
  clearPreview();

  // al salir del editor: refrescar aviones (para que aparezcan si ya hay match)
  loadFlightsAndPlaceAircraft();
};

btnAddPos.onclick = () => {
  if(!isEditor) return;
  editorMode = (editorMode === "pos") ? null : "pos";
  airportTools.hidden = true;
};

btnAirport.onclick = () => {
  if(!isEditor) return;
  editorMode = (editorMode === "apt") ? null : "apt";
  airportTools.hidden = (editorMode !== "apt");
  // cerrar línea en progreso si salgo del modo
  if(editorMode !== "apt") finishAirportLine();
};

/************************
 * POSICIONES (DIBUJO)
 ************************/
function computeEnd(lat, lng, hdg, dist=0.00009){
  const r = (hdg - 90) * Math.PI/180;
  return [lat + dist*Math.sin(r), lng + dist*Math.cos(r)];
}

function labelOffsetFor(labelPosValue){
  // offset en píxeles relativo al punto del stand
  switch(labelPosValue){
    case "front": return [18, -22];
    case "back":  return [-38, 18];
    case "left":  return [-60, -6];
    case "right": return [30, -6];
    default: return [18, -22];
  }
}

function clearStands(){
  for(const {group} of standLayersById.values()){
    map.removeLayer(group);
  }
  standLayersById.clear();
}

function drawAllStands(){
  clearStands();

  for(const p of positions){
    const group = L.layerGroup().addTo(map);

    const circle = L.circleMarker([p.lat, p.lng], {
      radius: 4,
      color: p.color || "#FFD100",
      weight: 2,
      fillOpacity: 1
    }).addTo(group);

    const end = computeEnd(p.lat, p.lng, +p.hdg || 0);
    const hdgLine = L.polyline([[p.lat, p.lng], end], {
      color: p.color || "#FFD100",
      weight: 3,
      opacity: 0.95
    }).addTo(group);

    // nombre (stand) desplazado
    const [ox, oy] = labelOffsetFor(p.labelPos || "front");
    const labelLatLng = pointOffsetToLatLng([p.lat, p.lng], ox, oy);
    const labelMarker = L.marker(labelLatLng, {
      interactive: true,
      icon: L.divIcon({
        className: "stand-label",
        html: `<span style="color:${p.color||"#FFD100"}">${escapeHtml(p.name)}</span>`
      })
    }).addTo(group);

    // click para editar
    const onEdit = () => {
      if(!isEditor) return;
      openEditPos(p.id);
    };
    circle.on("click", onEdit);
    hdgLine.on("click", onEdit);
    labelMarker.on("click", onEdit);

    standLayersById.set(p.id, {group, circle, hdgLine, labelMarker});
  }

  // cuando se mueve el mapa, recalcular labels y aircraft labels
  syncAllDynamicLabels();
}

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function pointOffsetToLatLng(latlngArr, dx, dy){
  const latlng = L.latLng(latlngArr[0], latlngArr[1]);
  const pt = map.latLngToLayerPoint(latlng);
  const pt2 = L.point(pt.x + dx, pt.y + dy);
  return map.layerPointToLatLng(pt2);
}

function syncAllDynamicLabels(){
  // stands
  for(const p of positions){
    const layer = standLayersById.get(p.id);
    if(!layer) continue;
    const [ox, oy] = labelOffsetFor(p.labelPos || "front");
    const ll = pointOffsetToLatLng([p.lat, p.lng], ox, oy);
    layer.labelMarker.setLatLng(ll);
  }
  // aircraft labels
  for(const a of aircraftObjs){
    const p = positions.find(x => x.id === a.posId);
    if(!p) continue;
    const [ox, oy] = aircraftLabelOffsetFor(a.labelPos || "right");
    const ll = pointOffsetToLatLng([p.lat, p.lng], ox, oy);
    a.labelMarker.setLatLng(ll);
  }
}

map.on("zoomend moveend", syncAllDynamicLabels);

/************************
 * MODAL POSICIÓN + PREVIEW
 ************************/
function openNewPos(latlng){
  editingPosId = null;
  pendingLatLng = latlng;

  posModalTitle.textContent = "Nueva posición";
  posDelete.hidden = true;

  posName.value = "";
  posHdg.value = 0;
  hdgVal.textContent = "0";
  posColor.value = "#FFD100";
  labelPos.value = "front";

  posModal.classList.remove("hidden");
  drawPreview();
}

function openEditPos(posId){
  const p = positions.find(x => x.id === posId);
  if(!p) return;

  editingPosId = posId;
  pendingLatLng = L.latLng(p.lat, p.lng);

  posModalTitle.textContent = `Editar posición ${p.name}`;
  posDelete.hidden = false;

  posName.value = p.name;
  posHdg.value = +p.hdg || 0;
  hdgVal.textContent = String(+p.hdg || 0);
  posColor.value = p.color || "#FFD100";
  labelPos.value = p.labelPos || "front";

  posModal.classList.remove("hidden");
  drawPreview();
}

function closePosModal(){
  posModal.classList.add("hidden");
  clearPreview();
}

posHdg.oninput = () => {
  hdgVal.textContent = String(posHdg.value);
  drawPreview();
};
posColor.oninput = () => drawPreview();

function drawPreview(){
  clearPreview();
  if(!pendingLatLng) return;
  const end = computeEnd(pendingLatLng.lat, pendingLatLng.lng, +posHdg.value || 0);
  previewLine = L.polyline([[pendingLatLng.lat, pendingLatLng.lng], end], {
    color: posColor.value || "#FFD100",
    weight: 3,
    dashArray: "5,5",
    opacity: 0.95
  }).addTo(map);
}

function clearPreview(){
  if(previewLine){
    map.removeLayer(previewLine);
    previewLine = null;
  }
}

function savePosFromModal(){
  const name = normPosName(posName.value);
  if(!name){
    alert("Nombre requerido");
    return;
  }
  if(!pendingLatLng){
    alert("Punto inválido");
    return;
  }

  const payload = {
    id: editingPosId || uid(),
    name,
    lat: pendingLatLng.lat,
    lng: pendingLatLng.lng,
    hdg: +posHdg.value || 0,
    color: posColor.value || "#FFD100",
    labelPos: labelPos.value || "front"
  };

  // upsert
  const idx = positions.findIndex(x => x.id === payload.id);
  if(idx >= 0) positions[idx] = payload;
  else positions.push(payload);

  saveJSON("eze_positions", positions);
  closePosModal();

  drawAllStands();
  renderPosSidebar();

  // refrescar aviones si hay datos
  loadFlightsAndPlaceAircraft();
}

function deleteEditingPos(){
  if(!editingPosId) return;
  const p = positions.find(x => x.id === editingPosId);
  if(!p) return;

  if(!confirm(`Eliminar posición ${p.name}?`)) return;

  positions = positions.filter(x => x.id !== editingPosId);
  saveJSON("eze_positions", positions);

  closePosModal();
  drawAllStands();
  renderPosSidebar();
  loadFlightsAndPlaceAircraft();
}

/************************
 * SIDEBAR POSICIONES (EDIT/DEL)
 ************************/
function renderPosSidebar(){
  posList.innerHTML = "";

  const sorted = [...positions].sort((a,b) => a.name.localeCompare(b.name));
  for(const p of sorted){
    const li = document.createElement("li");
    li.className = "pos-item";

    const name = document.createElement("div");
    name.className = "pos-name";
    name.textContent = p.name;

    const actions = document.createElement("div");
    actions.className = "pos-actions";

    const bEdit = document.createElement("button");
    bEdit.className = "icon-btn";
    bEdit.title = "Editar";
    bEdit.textContent = "✏️";
    bEdit.onclick = () => openEditPos(p.id);

    const bDel = document.createElement("button");
    bDel.className = "icon-btn";
    bDel.title = "Eliminar";
    bDel.textContent = "🗑️";
    bDel.onclick = () => {
      editingPosId = p.id;
      deleteEditingPos();
    };

    actions.appendChild(bEdit);
    actions.appendChild(bDel);

    li.appendChild(name);
    li.appendChild(actions);

    // click en el item centra el mapa
    li.onclick = (ev) => {
      // si clic en botones, no centrar
      if(ev.target === bEdit || ev.target === bDel) return;
      map.panTo([p.lat, p.lng]);
    };

    posList.appendChild(li);
  }
}

/************************
 * AEROPUERTO (LÍNEAS POR PUNTOS)
 ************************/
function clearAirportLinesLayers(){
  for(const l of airportLineLayers) map.removeLayer(l);
  airportLineLayers = [];
  if(currentAptLine){
    map.removeLayer(currentAptLine);
    currentAptLine = null;
  }
}

function drawAirportLines(){
  clearAirportLinesLayers();
  for(const ln of lines){
    const poly = L.polyline(ln.points, {color: ln.color, weight: ln.width, opacity: 0.95}).addTo(map);
    airportLineLayers.push(poly);
  }
}

function startOrAddAirportPoint(latlng){
  if(!currentAptLine){
    currentAptLine = L.polyline([latlng], {
      color: lineColor.value || "#ffffff",
      weight: +lineWidth.value || 3,
      opacity: 0.95
    }).addTo(map);
  } else {
    currentAptLine.addLatLng(latlng);
  }
}

function finishAirportLine(){
  if(!currentAptLine) return;
  const pts = currentAptLine.getLatLngs().map(ll => [ll.lat, ll.lng]);
  if(pts.length >= 2){
    lines.push({
      points: pts,
      color: lineColor.value || "#ffffff",
      width: +lineWidth.value || 3
    });
    saveJSON("eze_airport_lines", lines);
  }
  map.removeLayer(currentAptLine);
  currentAptLine = null;
  drawAirportLines();
}

btnFinishLine.onclick = () => finishAirportLine();

btnUndo.onclick = () => {
  // si hay línea en progreso: sacar último punto
  if(currentAptLine){
    const pts = currentAptLine.getLatLngs();
    if(pts.length > 1){
      pts.pop();
      currentAptLine.setLatLngs(pts);
      return;
    } else {
      map.removeLayer(currentAptLine);
      currentAptLine = null;
      return;
    }
  }
  // si no: borrar última línea guardada
  if(lines.length){
    lines.pop();
    saveJSON("eze_airport_lines", lines);
    drawAirportLines();
  }
};

btnClearLines.onclick = () => {
  if(!confirm("Borrar TODAS las líneas del aeropuerto?")) return;
  lines = [];
  saveJSON("eze_airport_lines", lines);
  drawAirportLines();
};

lineColor.oninput = () => {
  if(currentAptLine){
    currentAptLine.setStyle({color: lineColor.value});
  }
};
lineWidth.oninput = () => {
  if(currentAptLine){
    currentAptLine.setStyle({weight: +lineWidth.value});
  }
};

/************************
 * CLICK EN MAPA SEGÚN MODO
 ************************/
map.on("click", (e) => {
  if(!isEditor) return;

  if(editorMode === "pos"){
    openNewPos(e.latlng);
    return;
  }
  if(editorMode === "apt"){
    startOrAddAirportPoint(e.latlng);
    return;
  }
  // si no seleccionó modo, no hace nada
});

/************************
 * EXCEL -> PANEL + AVIONES
 ************************/
btnRefresh.onclick = () => loadFlightsAndPlaceAircraft();

function setFlightListError(msg){
  flightList.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = msg;
  flightList.appendChild(li);

    li.style.cursor = "pointer";
    li.onclick = () => {
      const stand = positions.find(p => p.name === posName);
      if(stand){
        map.setView([stand.lat, stand.lng], Math.max(map.getZoom(), 18), {animate:true});
      }
    };

}

async function loadFlightsAndPlaceAircraft(){
  // panel siempre se actualiza
  flightList.innerHTML = "";

  // limpiar aviones anteriores
  clearAircraft();

  // si no hay API URL pegada, no rompas la app
  if(!API_URL || API_URL.includes("PEGAR_AQUI")){
    setFlightListError("Pegá la URL del Apps Script en js/app.js (API_URL).");
    return;
  }

  let vuelos;
  try{
    const res = await fetch(API_URL, { cache: "no-store" });
    vuelos = await res.json();
    if(!Array.isArray(vuelos)) throw new Error("Respuesta no válida");
  }catch(err){
    setFlightListError("Error leyendo Excel (Apps Script). Revisá la URL y permisos.");
    return;
  }

  // listar + colocar
  for(const v of vuelos){
    const vuelo = String(v.vuelo || "").trim();
    const matricula = String(v.matricula || "").trim();
    const origen = String(v.origen || "").trim();
    const posName = normPosName(v.posicion);

    const li = document.createElement("li");
    li.textContent = `${vuelo || "-"} · ${matricula || "-"} · ${origen || "-"} · ${posName || "-"}`;
    flightList.appendChild(li);

    li.style.cursor = "pointer";
    li.onclick = () => {
      const stand = positions.find(p => p.name === posName);
      if(stand){
        map.setView([stand.lat, stand.lng], Math.max(map.getZoom(), 18), {animate:true});
      }
    };


    if(!posName) continue;

    const stand = positions.find(p => p.name === posName);
    if(!stand) continue; // no existe posición creada

    // crear avión sobre el punto
    placeAircraftOnStand({ vuelo, matricula, origen, posName }, stand);
  }

  // actualizar labels por si cambia zoom
  syncAllDynamicLabels();
}

function clearAircraft(){
  for(const l of aircraftLayers) map.removeLayer(l);
  aircraftLayers = [];
  aircraftObjs = [];

  // devolver estilo de stands (ocupado/libre)
  for(const p of positions){
    const layer = standLayersById.get(p.id);
    if(layer){
      layer.circle.setStyle({color: p.color || "#FFD100"});
    }
  }
}

// offsets de etiqueta de avión (más separada)
function aircraftLabelOffsetFor(labelPosValue){
  switch(labelPosValue){
    case "front": return [26, -38];
    case "back":  return [-60, 28];
    case "left":  return [-90, -8];
    case "right": return [34, -8];
    default: return [34, -8];
  }
}

function placeAircraftOnStand(v, stand){
  // detectar si hay otros aviones muy cerca
  let nearby = aircraftObjs.filter(a=>{
    const p = positions.find(x=>x.id===a.posId);
    return p && distMeters({lat:stand.lat,lng:stand.lng},{lat:p.lat,lng:p.lng}) < 40;
  }).length;

  // offset automático si hay más de uno
  const autoOffset = nearby * 20;

  // marcar stand ocupado (gris)
  const sLayer = standLayersById.get(stand.id);
  if(sLayer){
    sLayer.circle.setStyle({color: "#b0b0b0"});
  }

  // marcador avión (emoji) sobre el punto, rotado por HDG del stand
  const deg = (+stand.hdg || 0);
  
  const size = aircraftSizeByModel(v.matricula, v.vuelo);
  const html = `<div class="aircraft-icon" style="font-size:${size}px; transform: rotate(${deg}deg); color:#ff8c00;">✈️</div>`;


  const marker = L.marker([stand.lat, stand.lng], {
    interactive: false,
    icon: L.divIcon({
      className: "",
      html
    })
  }).addTo(map);

  aircraftLayers.push(marker);

  // etiqueta (no rota) al costado
  const labelPosValue = "right"; // fijo por ahora, luego lo hacemos arrastrable
  const [ox, oy] = aircraftLabelOffsetFor(labelPosValue);
  const oy2 = oy + autoOffset;
  const ll = pointOffsetToLatLng([stand.lat, stand.lng], ox, oy2);
  const labelHtml = `<div class="aircraft-label">${escapeHtml(v.matricula || "-")}<br>${escapeHtml(v.origen || "-")}</div>`;

  const labelMarker = L.marker(ll, {
    interactive: false,
    icon: L.divIcon({
      className: "",
      html: labelHtml
    })
  }).addTo(map);

  aircraftLayers.push(labelMarker);
  aircraftObjs.push({posId: stand.id, marker, labelMarker, labelPos: labelPosValue});

  // permitir drag del label
  labelMarker.on("mousedown", (ev)=>{
    ev.originalEvent.preventDefault();
    map.dragging.disable();

    const startPt = map.latLngToLayerPoint(labelMarker.getLatLng());
    const startMouse = ev.originalEvent;

    function onMove(e){
      const dx = e.clientX - startMouse.clientX;
      const dy = e.clientY - startMouse.clientY;
      const newPt = L.point(startPt.x + dx, startPt.y + dy);
      labelMarker.setLatLng(map.layerPointToLatLng(newPt));
    }
    function onUp(){
      map.dragging.enable();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

}


function aircraftSizeByModel(matricula, vuelo){
  // Heurística simple (se puede refinar luego)
  // Widebody
  if(/A330|A350|B77|B78|B74|B76/.test(vuelo)) return 36;
  // Narrowbody
  if(/A32|B73/.test(vuelo)) return 28;
  // Regional
  if(/E19|CRJ|AT7|DH8/.test(vuelo)) return 22;
  return 26;
}

/************************
 * INIT
 ************************/
drawAirportLines();
drawAllStands();
renderPosSidebar();
loadFlightsAndPlaceAircraft();
