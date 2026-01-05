/******** CONFIG ********/
const KEY_POS = "trfc_positions_v1";

/******** MAP ********/
const map = L.map("map").setView([-34.8222,-58.5358],15);
L.tileLayer(
 "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
).addTo(map);

const posLayer = L.layerGroup().addTo(map);
const planeLayer = L.layerGroup().addTo(map);
const cardLayer = document.getElementById("cardLayer");

/******** DATA ********/
let positions = JSON.parse(localStorage.getItem(KEY_POS)||"[]");

/******** UTIL ********/
function savePos(){ localStorage.setItem(KEY_POS,JSON.stringify(positions)); }

/******** POSICIONES ********/
function drawPositions(){
  posLayer.clearLayers();
  positions.forEach(p=>{
    L.circleMarker([p.lat,p.lng],{
      radius:5,
      color:p.color,
      fillColor:p.color,
      fillOpacity:1
    }).addTo(posLayer)
     .bindTooltip(p.name,{permanent:true,offset:[10,0]});
  });
}

/******** AVION ********/
function iconPlane(hdg){
  return L.divIcon({
    html:`<div style="transform:rotate(${hdg}deg);font-size:22px">✈️</div>`,
    iconSize:[24,24],
    iconAnchor:[12,12]
  });
}

function estadoClase(v){
  const s=(v.estado||"").toUpperCase();
  if(s.includes("BOR"))return"BOR";
  if(s.includes("ULT"))return"ULT";
  if(s.includes("ATE"))return"ATE";
  if(s.includes("DEP"))return"DEP";
  return"PRE";
}

/******** CARGA DATOS ********/
async function loadData(){
  const r = await fetch(API_URL);
  const data = await r.json();

  planeLayer.clearLayers();
  cardLayer.innerHTML="";
  document.getElementById("flightList").innerHTML="";

  data.forEach(v=>{
    const pos = positions.find(p=>p.name===v.stand);
    if(!pos) return;

    L.marker([pos.lat,pos.lng],{
      icon:iconPlane(pos.hdg||0)
    }).addTo(planeLayer);

    const card=document.createElement("div");
    card.className="aircard "+estadoClase(v);
    card.innerHTML=`
      <div class="full">
        <div class="mat">${v.matricula}</div>
        Stand ${v.stand}<br>
        ARR ${v.arr?.vuelo||""} ${v.arr?.hora||""}<br>
        DEP ${v.dep?.vuelo||""} ${v.dep?.hora||""}
      </div>
    `;

    const pt = map.latLngToContainerPoint([pos.lat,pos.lng]);
    card.style.left=(pt.x+18)+"px";
    card.style.top=(pt.y-18)+"px";

    cardLayer.appendChild(card);

    const row=document.createElement("div");
    row.className="flight-row";
    row.textContent=`${v.matricula} – ${v.stand}`;
    row.onclick=()=>map.setView([pos.lat,pos.lng],18);
    document.getElementById("flightList").appendChild(row);
  });
}

map.on("move zoom",loadData);

/******** EDITOR ********/
let editor=false,tempPos=null;
const editorOverlay=document.getElementById("editorOverlay");
const posModal=document.getElementById("posModal");

document.getElementById("btnEditor").onclick=()=>{
  if(prompt("Contraseña editor")!=="12345678")return;
  editor=true;
  editorOverlay.classList.remove("hidden");
};

document.getElementById("edExit").onclick=()=>{
  editor=false;
  editorOverlay.classList.add("hidden");
};

document.getElementById("edAddPos").onclick=()=>editor=true;

map.on("click",e=>{
  if(!editor)return;
  tempPos={lat:e.latlng.lat,lng:e.latlng.lng};
  posModal.classList.remove("hidden");
});

document.getElementById("posCancel").onclick=()=>posModal.classList.add("hidden");

document.getElementById("posHdg").oninput=()=>{
  document.getElementById("posPreview").style.transform=
    `rotate(${document.getElementById("posHdg").value}deg)`;
};

document.getElementById("posOk").onclick=()=>{
  positions.push({
    name:document.getElementById("posName").value,
    color:document.getElementById("posColor").value,
    hdg:Number(document.getElementById("posHdg").value),
    lat:tempPos.lat,lng:tempPos.lng
  });
  savePos();
  drawPositions();
  posModal.classList.add("hidden");
};

/******** INIT ********/
drawPositions();
loadData();
