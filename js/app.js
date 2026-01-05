/*********************************************************
 * SAEZCONTROL – TRFC (FULL)
 * - Operativo + Editor + Replay + Log + Capas + Reglas
 *********************************************************/

const KEY_POS = "trfc_positions_v1";
const KEY_LINES = "trfc_airport_lines_v1";
const KEY_CARD_OFF = "trfc_card_offsets_v1";
const KEY_SNAPS = "trfc_snapshots_v1";
const KEY_LOG = "trfc_event_log_v1";
const KEY_UI = "trfc_ui_v1";

const PASS_EDITOR = "12345678";

/* DOM */
const elFlightList = document.getElementById("flightList");
const elCardLayer = document.getElementById("cardLayer");
const elStatusLine = document.getElementById("statusLine");

const elTimelinePanel = document.getElementById("timelinePanel");
const elTimelineRange = document.getElementById("timelineRange");
const elTimelineLabel = document.getElementById("timelineLabel");
const btnCloseTimeline = document.getElementById("btnCloseTimeline");

const darkOverlay = document.getElementById("darkOverlay");

/* UI */
let ui = loadJSON(KEY_UI, { dark: 35, night: false });
applyDark();

/* MAP */
const map = L.map("map", { zoomControl: true }).setView([-34.8222, -58.5358], 15);

const sat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Tiles © Esri" }
).addTo(map);

/* Layers */
const posLayer = L.layerGroup().addTo(map);
const planeLayer = L.layerGroup().addTo(map);
const transferLayer = L.layerGroup().addTo(map);
const planLayer = L.layerGroup().addTo(map);
const lineLayer = L.layerGroup().addTo(map);

let showCards = true;

/* Controls (capas) */
L.control.layers(
  { "Satélite": sat },
  {
    "Posiciones": posLayer,
    "Aviones": planeLayer,
    "Flechas traslado": transferLayer,
    "Flechas plan": planLayer,
    "Líneas aeropuerto": lineLayer
  },
  { collapsed: true }
).addTo(map);

/* DATA */
let positions = loadJSON(KEY_POS, []);
let lines = loadJSON(KEY_LINES, []); // [{color,width,points:[[lat,lng],...]}]
let cardOffsets = loadJSON(KEY_CARD_OFF, {}); // {mat:{dx,dy,manual}}
let snapshots = loadJSON(KEY_SNAPS, []); // [{ts,data}]
let eventLog = loadJSON(KEY_LOG, []); // [{ts,type,msg,mat,from,to}]

let currentData = [];
let currentFilter = "ALL";
let replayTimer = null;
let lastKey = snapshots[0] ? makeKey(snapshots[0].data) : "";
let lastStandByMat = {}; // for transfer arrows

/* COLORS */
const COLORS = {
  ARR: "#38bdf8",
  TRN: "#facc15",
  NS:  "#22c55e",
  MX:  "#ef4444",
  DEP: "#9ca3af",
  WARN:"#fb7185",

  PRE:"#38bdf8",
  BOR:"#facc15",
  ULT:"#fb7185",
  ATE:"#22c55e"
};

function loadJSON(key, fallback){
  try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch{ return fallback; }
}
function saveJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}
function norm(v){ return (v||"").toString().trim().toUpperCase(); }
function nowISO(){ return new Date().toISOString(); }
function fmtTS(ts){ return new Date(ts).toLocaleString(); }

/* === Derivación de estado operativo (ARR/TRN/MX/NS/DEP) === */
function calcOpState(v){
  const e = norm(v.estado);
  if (e.includes("MX")) return "MX";
  if (e.includes("NS")) return "NS";
  // si dep.hora existe, consideramos DEP
  if (v.dep && v.dep.hora) return "DEP";
  // si tiene arr y dep (aunque dep sin hora) -> TRN
  if (v.arr && v.dep) return "TRN";
  return "ARR";
}

/* === Estado para pintar tarjeta (PRE/BOR/ULT/ATE/DEP) ===
   Se toma de v.estado (salida/arribo) y fallback al estado operativo.
*/
function calcCardPaint(v){
  const s = norm(v.estado);
  if (s.includes("PRE")) return "PRE";
  if (s.includes("BOR")) return "BOR";
  if (s.includes("ULT")) return "ULT";
  if (s.includes("ATE")) return "ATE";
  if (s.includes("DEP")) return "DEP";
  // fallback por opState
  const op = calcOpState(v);
  if (op === "DEP") return "DEP";
  return "PRE";
}

function passesFilter(opState){
  return currentFilter === "ALL" ? true : opState === currentFilter;
}

/* === Tamaño avión por tipo/modelo (si viene) === */
function aircraftScale(v){
  const t = norm(v.type || v.model || v.aircraftType || v.acType);
  // heurística simple si viene algo reconocible
  if (t.includes("E190") || t.includes("E-190") || t.includes("EMB")) return 20;
  if (t.includes("A319")) return 22;
  if (t.includes("A320")) return 24;
  if (t.includes("A321")) return 26;
  if (t.includes("B737") || t.includes("737")) return 24;
  if (t.includes("B738") || t.includes("B737-800")) return 24;
  if (t.includes("B739") || t.includes("MAX")) return 25;
  if (t.includes("B777") || t.includes("787") || t.includes("A330") || t.includes("A350")) return 30;
  return 24;
}

/* === Icono avión (emoji) con halo estado === */
function planeIcon(hdg, opState, v, conflict=false){
  const size = aircraftScale(v);
  const color = COLORS[opState] || "#fff";
  const halo = conflict ? COLORS.WARN : color;

  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;transform:rotate(${hdg}deg);">
        <div style="
          position:absolute;left:50%;top:50%;
          width:10px;height:10px;border-radius:999px;
          transform:translate(-50%,-50%);
          background:${halo};box-shadow:0 0 14px ${halo};
          opacity:.95;"></div>
        <div style="
          position:absolute;left:50%;top:50%;
          transform:translate(-50%,-50%);
          font-size:${Math.round(size*0.9)}px;
          filter: drop-shadow(0 0 8px rgba(0,0,0,.65));
        ">✈️</div>
      </div>
    `,
    iconSize:[size,size],
    iconAnchor:[size/2,size/2]
  });
}

/* === POSICIONES + LÍNEAS === */
function drawPositions(){
  posLayer.clearLayers();
  positions.forEach(p=>{
    const off = labelOffsetFromSide(p.labelSide || "right");
    L.circleMarker([p.lat,p.lng],{
      radius:5,color:p.color||"#fff",weight:2,
      fillColor:p.color||"#fff",fillOpacity:1
    }).addTo(posLayer)
      .bindTooltip(p.name, { permanent:true, offset: off });
  });
}
function labelOffsetFromSide(side){
  if(side==="left") return [-18,0];
  if(side==="top") return [0,-16];
  if(side==="bottom") return [0,16];
  return [18,0];
}

function drawLines(){
  lineLayer.clearLayers();
  for(const Ls of lines){
    if(!Ls.points || Ls.points.length<2) continue;
    L.polyline(Ls.points, { color: Ls.color||"#fff", weight: Number(Ls.width||3), opacity: 0.95 })
      .addTo(lineLayer);
  }
}

/* === CONFLICTOS === */
function conflictMap(data){
  const m = {};
  for(const v of data){
    const s = (v.stand||"").trim();
    if(!s) continue;
    m[s] = m[s] || [];
    m[s].push(v);
  }
  const c = {};
  for(const s of Object.keys(m)){
    if(m[s].length>1) c[s] = m[s].map(x=>x.matricula);
  }
  return c;
}

/* === LOG === */
function pushLog(type, msg, extra={}){
  eventLog.unshift({ ts: nowISO(), type, msg, ...extra });
  if(eventLog.length>500) eventLog = eventLog.slice(0,500);
  saveJSON(KEY_LOG, eventLog);
}

/* === SNAPSHOTS EVENT-BASED === */
function makeKey(data){
  const parts = (data||[])
    .filter(v=>v && v.matricula)
    .map(v=>{
      const a=v.arr?.hora||"", d=v.dep?.hora||"";
      return `${v.matricula}|${v.stand||""}|${norm(v.estado)||""}|${a}|${d}`;
    })
    .sort();
  return parts.join(";");
}

function pushSnapshotIfChanged(data){
  const k = makeKey(data);
  if(!k) return;
  if(k === lastKey) return;
  lastKey = k;

  snapshots.unshift({ ts: nowISO(), data });
  if(snapshots.length>240) snapshots = snapshots.slice(0,240);
  saveJSON(KEY_SNAPS, snapshots);

  elTimelineRange.max = String(Math.max(0, snapshots.length-1));
}

/* === FETCH === */
async function fetchData(){
  const res = await fetch(window.API_URL, { cache:"no-store" });
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

/* === REGLAS DURAS === */
function applyHardRules(data){
  // MX: inmóvil (si el stand cambia desde el anterior, lo mantenemos y log)
  // DEP: opcional ocultar del mapa si estado operativo DEP y está marcado depegado
  const prevSnap = snapshots[0]?.data || [];
  const prevByMat = {};
  for(const v of prevSnap) prevByMat[v.matricula] = v;

  return data.map(v=>{
    const op = calcOpState(v);
    if(op === "MX"){
      const prev = prevByMat[v.matricula];
      if(prev && prev.stand && v.stand && prev.stand !== v.stand){
        pushLog("RULE", `MX inmóvil: ${v.matricula} se mantuvo en ${prev.stand} (Excel decía ${v.stand})`,
          { mat:v.matricula, from:v.stand, to:prev.stand });
        return { ...v, stand: prev.stand, _mxLocked:true };
      }
      return { ...v, _mxLocked:true };
    }
    return v;
  }).filter(v=>{
    // ocultar DEP si ya está en DEP y además estado contiene DEP o dep.hora
    const op = calcOpState(v);
    if(op === "DEP"){
      // si querés ocultar siempre DEP, descomentá:
      // return false;
      return true;
    }
    return true;
  });
}

/* === BUILD CARD === */
function buildCard(v, opState, conflict){
  const cardPaint = calcCardPaint(v);
  const card = document.createElement("div");
  card.className = `aircard ${cardPaint}${conflict ? " CONFLICT" : ""}`;
  card.dataset.mat = v.matricula || "";

  const arr = v.arr || {};
  const dep = v.dep || {};
  const warn = conflict ? `<span class="pill warn">⚠ CONFLICT</span>` : "";
  const mxLock = v._mxLocked ? `<span class="pill mx">MX LOCK</span>` : "";

  card.innerHTML = `
    <div class="dragbar">
      <div>
        <div class="mat">${v.matricula || "-"}</div>
        <div class="sub">Stand ${v.stand || "-"} • <b style="color:${COLORS[opState]||"#fff"}">${opState}</b></div>
      </div>
      <div class="row">
        ${warn}
        ${mxLock}
        <span class="pill ${opState.toLowerCase()}">${opState}</span>
      </div>
    </div>

    <div class="grid">
      <div class="kv">
        <b>ARR</b>
        <span>${arr.vuelo || "-"}</span>
        <div class="meta">
          ${arr.origen ? `ORG <b>${arr.origen}</b>` : "ORG —"}
          ${arr.hora ? ` • <b>${arr.hora}</b>` : ""}
          ${arr.estado ? `<br><span class="muted">${norm(arr.estado)}</span>` : ""}
        </div>
      </div>

      <div class="kv">
        <b>DEP</b>
        <span>${dep.vuelo || "-"}</span>
        <div class="meta">
          ${dep.destino ? `DST <b>${dep.destino}</b>` : "DST —"}
          ${dep.hora ? ` • <b>${dep.hora}</b>` : ""}
          ${dep.estado ? `<br><span class="muted">${norm(dep.estado)}</span>` : ""}
        </div>
      </div>
    </div>
  `;

  makeCardDraggableRelative(card);
  return card;
}

/* === BUILD SIDEBAR ROW === */
function buildSidebarRow(v, opState, conflict){
  const row = document.createElement("div");
  row.className = "flight-row";
  const paint = calcCardPaint(v);
  const arr = v.arr || {};
  const dep = v.dep || {};

  row.innerHTML = `
    <div class="top">
      <div>
        <div class="mat">${v.matricula || "-"}</div>
        <div class="stand">Stand ${v.stand || "-"}</div>
      </div>
      <div class="row">
        <span class="pill ${opState.toLowerCase()}">${opState}</span>
        <span class="pill" style="border-color:${COLORS[paint]||"#334155"};color:${COLORS[paint]||"#e5e7eb"}">${paint}</span>
        ${conflict ? `<span class="pill warn">⚠</span>` : ""}
      </div>
    </div>
    <div class="meta">
      ARR: <b>${arr.vuelo||"-"}</b> ${arr.hora||""} ${arr.origen?`• ${arr.origen}`:""}<br>
      DEP: <b>${dep.vuelo||"-"}</b> ${dep.hora||""} ${dep.destino?`• ${dep.destino}`:""}
    </div>
  `;
  return row;
}

/* === CARD PLACEMENT + OVERLAP === */
function placeCardAt(card, left, top){
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}
function rectOf(el){
  const r = el.getBoundingClientRect();
  return {l:r.left,t:r.top,r:r.right,b:r.bottom};
}
function intersects(a,b){
  return !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
}
function smartAntiOverlap(items){
  const placed = [];
  const ring = [
    {dx:0,dy:0},{dx:0,dy:28},{dx:0,dy:-28},{dx:28,dy:0},{dx:-28,dy:0},
    {dx:28,dy:28},{dx:28,dy:-28},{dx:-28,dy:28},{dx:-28,dy:-28},
    {dx:56,dy:0},{dx:-56,dy:0},{dx:0,dy:56},{dx:0,dy:-56},
  ];

  for(const it of items){
    const {card, anchor, mat} = it;
    const off = cardOffsets[mat] || {dx:18,dy:-18,manual:false};
    const baseX = anchor.x + off.dx;
    const baseY = anchor.y + off.dy;

    let ok = false;
    for(const step of ring){
      placeCardAt(card, baseX + step.dx, baseY + step.dy);
      const r = rectOf(card);
      let hit = false;
      for(const p of placed){
        if(intersects(r,p)){ hit = true; break; }
      }
      if(!hit){
        placed.push(r);
        ok = true;

        if(!off.manual && (step.dx!==0 || step.dy!==0)){
          cardOffsets[mat] = { dx: off.dx + step.dx, dy: off.dy + step.dy, manual:false };
          saveJSON(KEY_CARD_OFF, cardOffsets);
        }
        break;
      }
    }
    if(!ok){
      placeCardAt(card, baseX, baseY + 90);
      placed.push(rectOf(card));
    }
  }
}

/* === DRAG RELATIVE (cards move with aircraft) === */
function makeCardDraggableRelative(card){
  const bar = card.querySelector(".dragbar");
  const mat = card.dataset.mat;

  let dragging=false,startX=0,startY=0,startL=0,startT=0;

  const startDrag=(x,y)=>{
    dragging=true;
    map.dragging.disable();
    const r = card.getBoundingClientRect();
    startL=r.left; startT=r.top; startX=x; startY=y;
  };
  const moveDrag=(x,y)=>{
    if(!dragging) return;
    const dx=x-startX, dy=y-startY;
    placeCardAt(card, startL+dx, startT+dy);
  };
  const endDrag=()=>{
    if(!dragging) return;
    dragging=false;
    map.dragging.enable();

    const snap = snapshots[0];
    if(!snap) return;
    const v = snap.data.find(x=>x.matricula===mat);
    if(!v) return;
    const pos = positions.find(p=>p.name===v.stand);
    if(!pos) return;

    const anchor = map.latLngToContainerPoint([pos.lat,pos.lng]);
    const r = card.getBoundingClientRect();

    cardOffsets[mat] = { dx: (r.left - anchor.x), dy: (r.top - anchor.y), manual:true };
    saveJSON(KEY_CARD_OFF, cardOffsets);
  };

  bar.addEventListener("mousedown",(e)=>{ e.preventDefault(); e.stopPropagation(); startDrag(e.clientX,e.clientY); });
  document.addEventListener("mousemove",(e)=>moveDrag(e.clientX,e.clientY));
  document.addEventListener("mouseup", endDrag);

  bar.addEventListener("touchstart",(e)=>{
    e.preventDefault(); e.stopPropagation();
    const t=e.touches[0]; startDrag(t.clientX,t.clientY);
  },{passive:false});
  document.addEventListener("touchmove",(e)=>{
    if(!dragging) return;
    e.preventDefault();
    const t=e.touches[0]; moveDrag(t.clientX,t.clientY);
  },{passive:false});
  document.addEventListener("touchend", endDrag);
}

/* === RELAYOUT cards on map move === */
function relayoutCards(){
  if(!showCards) return;
  const snap = snapshots[0];
  if(!snap) return;

  const cards = Array.from(document.querySelectorAll(".aircard"));
  const items = [];
  for(const card of cards){
    const mat = card.dataset.mat;
    const v = snap.data.find(x=>x.matricula===mat);
    if(!v) continue;
    const pos = positions.find(p=>p.name===v.stand);
    if(!pos) continue;
    const anchor = map.latLngToContainerPoint([pos.lat,pos.lng]);
    items.push({card, anchor, mat});
  }
  smartAntiOverlap(items);
}

/* === RENDER === */
function render(data, {drawTransfers=true} = {}){
  currentData = data;

  planeLayer.clearLayers();
  transferLayer.clearLayers();
  planLayer.clearLayers();
  elCardLayer.innerHTML = "";
  elFlightList.innerHTML = "";

  const conflicts = conflictMap(data);

  // stand -> list of aircraft in same stand (for conflict stack)
  const standGroups = {};
  for(const v of data){
    const s = (v.stand||"").trim();
    if(!s) continue;
    standGroups[s] = standGroups[s] || [];
    standGroups[s].push(v);
  }

  let shown = 0;
  const cardItems = [];

  for(const stand of Object.keys(standGroups).sort()){
    const group = standGroups[stand];
    const pos = positions.find(p=>p.name===stand);
    if(!pos) continue;

    // Si no hay conflicto, mostramos 1 avión (bloqueo duro). Si hay conflicto, mostramos todos apilados.
    const isConflict = !!conflicts[stand];
    const showList = isConflict ? group : [group[0]];

    for(let i=0;i<showList.length;i++){
      const v = showList[i];
      const opState = calcOpState(v);
      if(!passesFilter(opState)) continue;

      const hdg = Number(pos.hdg || 0);
      const marker = L.marker([pos.lat,pos.lng], {
        icon: planeIcon(hdg, opState, v, isConflict)
      }).addTo(planeLayer);

      // Flecha traslado real (stand change)
      if(drawTransfers && !v._mxLocked){
        const prev = lastStandByMat[v.matricula];
        const cur = v.stand;
        if(prev && cur && prev !== cur){
          const fromPos = positions.find(p=>p.name===prev);
          if(fromPos){
            L.polyline([[fromPos.lat,fromPos.lng],[pos.lat,pos.lng]],{
              color: COLORS.TRN, weight:3, opacity:0.95
            }).addTo(transferLayer);
            pushLog("MOVE", `${v.matricula}: ${prev} ➜ ${cur}`, { mat:v.matricula, from:prev, to:cur });
          }
        }
        lastStandByMat[v.matricula] = cur;
      }

      // Flecha plan (si backend trae nextStand/planStand)
      const next = (v.nextStand || v.standPlan || v.planStand || v.toStand || "").toString().trim();
      if(next){
        const toPos = positions.find(p=>p.name===next);
        if(toPos){
          L.polyline([[pos.lat,pos.lng],[toPos.lat,toPos.lng]],{
            color: COLORS.NS, weight:2, opacity:0.9, dashArray:"6 6"
          }).addTo(planLayer);
        }
      }

      // Card
      if(showCards){
        const card = buildCard(v, opState, isConflict);
        elCardLayer.appendChild(card);

        const anchor = map.latLngToContainerPoint([pos.lat,pos.lng]);
        const mat = v.matricula || "";
        const off = cardOffsets[mat] || {dx:18,dy:-18,manual:false};

        // stack conflicts a bit
        const stackDy = isConflict ? i*28 : 0;
        placeCardAt(card, anchor.x + off.dx, anchor.y + off.dy + stackDy);
        cardItems.push({card, anchor, mat});
      }

      // Sidebar
      const row = buildSidebarRow(v, opState, isConflict);
      row.onclick = ()=> map.setView([pos.lat,pos.lng], Math.max(map.getZoom(), 18));
      elFlightList.appendChild(row);

      // hover link
      row.addEventListener("mouseenter", ()=>{ marker.setZIndexOffset(9999); });
      row.addEventListener("mouseleave", ()=>{ marker.setZIndexOffset(0); });

      shown++;
    }
  }

  if(showCards) smartAntiOverlap(cardItems);

  elStatusLine.textContent = `Mostrando: ${shown} • Posiciones: ${positions.length} • Snapshots: ${snapshots.length}`;
}

/* === MAIN REFRESH === */
async function refresh({transfers=true} = {}){
  try{
    elStatusLine.textContent = "Cargando…";
    let data = await fetchData();
    data = applyHardRules(data);

    pushSnapshotIfChanged(data);
    render(data, {drawTransfers: transfers});
  }catch(err){
    console.error(err);
    elStatusLine.textContent = "Error al cargar";
  }
}

/* === TIMELINE / REPLAY === */
function showTimeline(){
  elTimelinePanel.classList.remove("hidden");
  elTimelineRange.max = String(Math.max(0, snapshots.length-1));
  elTimelineRange.value = "0";
  elTimelineLabel.textContent = snapshots[0] ? fmtTS(snapshots[0].ts) : "—";
}
function hideTimeline(){ elTimelinePanel.classList.add("hidden"); }

function startReplay(){
  if(!snapshots.length) return alert("No hay snapshots aún. Tocá refrescar.");
  showTimeline();
  stopReplay();

  let idx = snapshots.length - 1; // oldest
  replayTimer = setInterval(()=>{
    if(idx < 0){ stopReplay(); return; }
    elTimelineRange.value = String(idx);
    elTimelineLabel.textContent = fmtTS(snapshots[idx].ts);
    render(snapshots[idx].data, {drawTransfers:false});
    idx--;
  }, 900);
}
function stopReplay(){
  if(replayTimer){ clearInterval(replayTimer); replayTimer = null; }
}
elTimelineRange.oninput = (e)=>{
  const idx = Number(e.target.value || 0);
  const snap = snapshots[idx];
  if(!snap) return;
  elTimelineLabel.textContent = fmtTS(snap.ts);
  render(snap.data, {drawTransfers:false});
};
btnCloseTimeline.onclick = hideTimeline;

/* === FILTER CHIPS === */
document.querySelectorAll(".chip").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".chip").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter || "ALL";
    render(currentData, {drawTransfers:false});
  });
});

/* === UI BUTTONS === */
document.getElementById("btnRefresh").onclick = ()=>refresh({transfers:true});
document.getElementById("btnReplay").onclick = startReplay;
document.getElementById("btnStop").onclick = stopReplay;

document.getElementById("btnNight").onclick = ()=>{
  ui.night = !ui.night;
  ui.dark = ui.night ? 55 : (ui.dark || 35);
  saveJSON(KEY_UI, ui);
  applyDark();
};

document.getElementById("btnExportLog").onclick = ()=>{
  downloadJSON(eventLog, `trfc_log_${new Date().toISOString().slice(0,10)}.json`);
};
document.getElementById("btnExportSnap").onclick = ()=>{
  downloadJSON(snapshots, `trfc_replay_${new Date().toISOString().slice(0,10)}.json`);
};

function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* === DARK OVERLAY === */
function applyDark(){
  const val = Number(ui.dark ?? 35);
  darkOverlay.style.background = `rgba(0,0,0,${val/100})`;
}
document.getElementById("darkRange").oninput = (e)=>{
  ui.dark = Number(e.target.value || 35);
  saveJSON(KEY_UI, ui);
  applyDark();
};

/* === EDITOR MODE === */
let editorMode = false;
let editorAction = null; // ADD_POS / EDIT_POS / DEL_POS / LINES
let tempClickLatLng = null;
let editingPosIndex = -1;

// editor DOM
const editorOverlay = document.getElementById("editorOverlay");
const lineTools = document.getElementById("lineTools");

const posModal = document.getElementById("posModal");
const posModalTitle = document.getElementById("posModalTitle");
const posName = document.getElementById("posName");
const posColor = document.getElementById("posColor");
const posHdg = document.getElementById("posHdg");
const posHdgVal = document.getElementById("posHdgVal");
const posPreviewIcon = document.getElementById("posPreviewIcon");
const posLabelSide = document.getElementById("posLabelSide");

document.getElementById("btnEditor").onclick = ()=>{
  const pass = prompt("Contraseña editor:");
  if(pass !== PASS_EDITOR) return;
  editorMode = true;
  editorAction = null;
  editorOverlay.classList.remove("hidden");
};

document.getElementById("edExit").onclick = ()=>{
  editorMode = false;
  editorAction = null;
  lineTools.classList.add("hidden");
  editorOverlay.classList.add("hidden");
  refresh({transfers:false});
};

document.getElementById("edAddPos").onclick = ()=>{
  editorAction = "ADD_POS";
  lineTools.classList.add("hidden");
};

document.getElementById("edEditPos").onclick = ()=>{
  editorAction = "EDIT_POS";
  lineTools.classList.add("hidden");
};

document.getElementById("edDelPos").onclick = ()=>{
  editorAction = "DEL_POS";
  lineTools.classList.add("hidden");
};

document.getElementById("edLines").onclick = ()=>{
  editorAction = "LINES";
  lineTools.classList.remove("hidden");
  startLineSession();
};

document.getElementById("edExportPos").onclick = ()=>{
  downloadJSON(positions, "positions.json");
};

document.getElementById("edImportPos").onclick = ()=>{
  document.getElementById("importFile").click();
};

document.getElementById("importFile").onchange = async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  try{
    const txt = await file.text();
    const json = JSON.parse(txt);
    if(!Array.isArray(json)) throw new Error("No es array");
    // validación básica
    positions = json.filter(p=>p && p.name && typeof p.lat==="number" && typeof p.lng==="number");
    saveJSON(KEY_POS, positions);
    drawPositions();
    alert("Posiciones importadas OK.");
  }catch(err){
    alert("Error importando: " + err.message);
  }finally{
    e.target.value = "";
  }
};

/* === POS MODAL === */
function openPosModal(mode){
  posModal.classList.remove("hidden");
  posModalTitle.textContent = mode === "edit" ? "Editar posición" : "Nueva posición";
  posHdgVal.textContent = `${posHdg.value}°`;
  posPreviewIcon.style.transform = `rotate(${posHdg.value}deg)`;
}
function closePosModal(){
  posModal.classList.add("hidden");
  tempClickLatLng = null;
  editingPosIndex = -1;
}
document.getElementById("posCancel").onclick = closePosModal;

posHdg.oninput = ()=>{
  posHdgVal.textContent = `${posHdg.value}°`;
  posPreviewIcon.style.transform = `rotate(${posHdg.value}deg)`;
};

document.getElementById("posOk").onclick = ()=>{
  const name = (posName.value||"").trim();
  if(!name){ alert("Poné nombre de posición"); return; }
  const color = posColor.value || "#ffffff";
  const hdg = Number(posHdg.value||0);
  const labelSide = posLabelSide.value || "right";

  if(editingPosIndex >= 0){
    positions[editingPosIndex] = {
      ...positions[editingPosIndex],
      name, color, hdg, labelSide
    };
    pushLog("EDIT_POS", `Edit ${name}`, { mat:"", from:"", to:"" });
  }else{
    if(!tempClickLatLng){ alert("No hay punto"); return; }
    positions.push({ name, color, hdg, labelSide, lat: tempClickLatLng.lat, lng: tempClickLatLng.lng });
    pushLog("ADD_POS", `Add ${name}`, {});
  }

  saveJSON(KEY_POS, positions);
  drawPositions();
  closePosModal();
};

/* === LINE EDITOR === */
let lineSession = null; // {color,width,points:[]}
function startLineSession(){
  lineSession = {
    color: document.getElementById("lineColor").value || "#fff",
    width: Number(document.getElementById("lineWidth").value || 3),
    points: []
  };
}
document.getElementById("lineColor").oninput = (e)=>{
  if(lineSession) lineSession.color = e.target.value;
};
document.getElementById("lineWidth").oninput = (e)=>{
  if(lineSession) lineSession.width = Number(e.target.value||3);
};
document.getElementById("lineUndo").onclick = ()=>{
  if(editorAction!=="LINES") return;
  if(lineSession?.points?.length){ lineSession.points.pop(); redrawLiveLine(); }
  else if(lines.length){ lines.pop(); saveJSON(KEY_LINES, lines); drawLines(); }
};
document.getElementById("lineClear").onclick = ()=>{
  if(editorAction!=="LINES") return;
  if(confirm("Borrar todas las líneas?")){
    lines = [];
    saveJSON(KEY_LINES, lines);
    drawLines();
  }
};

let liveLine = null;
function redrawLiveLine(){
  if(liveLine){ lineLayer.removeLayer(liveLine); liveLine=null; }
  if(lineSession && lineSession.points.length>=2){
    liveLine = L.polyline(lineSession.points, { color: lineSession.color, weight: lineSession.width, opacity:0.95 }).addTo(lineLayer);
  }
}

/* === MAP CLICK HANDLER (EDITOR) === */
map.on("click", (e)=>{
  if(!editorMode) return;

  if(editorAction==="ADD_POS"){
    tempClickLatLng = e.latlng;
    editingPosIndex = -1;
    posName.value = "";
    posColor.value = "#ffffff";
    posHdg.value = "0";
    posLabelSide.value = "right";
    openPosModal("new");
    return;
  }

  if(editorAction==="EDIT_POS"){
    // encontrar posición más cercana
    const idx = nearestPositionIndex(e.latlng);
    if(idx < 0){ alert("No se encontró posición cercana"); return; }
    editingPosIndex = idx;
    const p = positions[idx];
    tempClickLatLng = { lat:p.lat, lng:p.lng };

    posName.value = p.name || "";
    posColor.value = p.color || "#ffffff";
    posHdg.value = String(p.hdg || 0);
    posLabelSide.value = p.labelSide || "right";
    openPosModal("edit");
    return;
  }

  if(editorAction==="DEL_POS"){
    const idx = nearestPositionIndex(e.latlng);
    if(idx < 0){ alert("No se encontró posición cercana"); return; }
    const p = positions[idx];
    if(confirm(`Eliminar posición ${p.name}?`)){
      positions.splice(idx,1);
      saveJSON(KEY_POS, positions);
      drawPositions();
      pushLog("DEL_POS", `Del ${p.name}`, {});
    }
    return;
  }

  if(editorAction==="LINES"){
    if(!lineSession) startLineSession();
    lineSession.color = document.getElementById("lineColor").value || lineSession.color;
    lineSession.width = Number(document.getElementById("lineWidth").value || lineSession.width);

    lineSession.points.push([e.latlng.lat, e.latlng.lng]);
    redrawLiveLine();

    // al llegar a 2+ puntos, dejamos “confirmar” implícito: si el usuario cambia acción o sale, guardamos.
    return;
  }
});

/* guardar líneas al salir del editor o cambiar de modo */
document.getElementById("edAddPos").addEventListener("click", commitLineSessionIfNeeded);
document.getElementById("edEditPos").addEventListener("click", commitLineSessionIfNeeded);
document.getElementById("edDelPos").addEventListener("click", commitLineSessionIfNeeded);
document.getElementById("edExit").addEventListener("click", commitLineSessionIfNeeded);

function commitLineSessionIfNeeded(){
  if(lineSession && lineSession.points.length>=2){
    lines.push({ color: lineSession.color, width: lineSession.width, points: lineSession.points });
    saveJSON(KEY_LINES, lines);
    drawLines();
  }
  // limpiar live
  if(liveLine){ lineLayer.removeLayer(liveLine); liveLine=null; }
  lineSession = null;
}

/* nearest pos */
function nearestPositionIndex(latlng){
  if(!positions.length) return -1;
  let best=-1, bestD=Infinity;
  for(let i=0;i<positions.length;i++){
    const p = positions[i];
    const d = dist2(latlng.lat, latlng.lng, p.lat, p.lng);
    if(d<bestD){ bestD=d; best=i; }
  }
  // umbral ~ (0.00002~2m) depende zoom; usamos algo razonable
  return bestD < 0.00015 ? best : -1;
}
function dist2(a,b,c,d){
  const dx = a-c, dy = b-d;
  return Math.sqrt(dx*dx+dy*dy);
}

/* === MAP MOVE RELAYOUT === */
map.on("move zoom", ()=>{ relayoutCards(); });

/* === INIT === */
drawPositions();
drawLines();
refresh({transfers:true});

/* === TIMELINE BUTTONS === */
document.getElementById("btnReplay").onclick = startReplay;
document.getElementById("btnStop").onclick = stopReplay;
