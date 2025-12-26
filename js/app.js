(()=>{
const STORE={stands:'eze_ops_stands',planes:'eze_ops_planes',audit:'eze_ops_audit',session:'eze_ops_session',overlays:'eze_ops_overlays'};
const SYNC={enabled:false,endpoint:'',poll_ms:8000};

const DEFAULT_SESSION={user:'Operador',role:'OPERATOR'};
const ROLES=['OPERATOR','SUPERVISOR','ADMIN'];
const PLANE_TYPES={B737:{scale:1.0},A320:{scale:1.05},E190:{scale:0.85},ATR:{scale:0.75}};
const PLANE_STATUS=['ARR','DEP','TRN','NS','MX'];

let mode='OPERATIVE';
let session=load(STORE.session,DEFAULT_SESSION);
let stands=load(STORE.stands,[]);
let planes=load(STORE.planes,[]);
let audit=load(STORE.audit,[]);
let overlays=load(STORE.overlays,{geojson:null,enabled:false});

let map, overlayLayer=null;
let standLayers=new Map(), planeLayers=new Map();
let timelineIndex=null;

const $=id=>document.getElementById(id);
const ui={btnLogin:$('btnLogin'),btnMode:$('btnMode'),btnAddPlane:$('btnAddPlane'),btnTimeline:$('btnTimeline'),btnLayers:$('btnLayers'),btnAudit:$('btnAudit'),btnSync:$('btnSync'),btnExport:$('btnExport'),btnImport:$('btnImport'),fileImport:$('fileImport'),modeLabel:$('modeLabel'),standList:$('standList'),planeList:$('planeList'),standSearch:$('standSearch'),planeSearch:$('planeSearch'),modal:$('modal'),backdrop:$('backdrop'),modalTitle:$('modalTitle'),modalBody:$('modalBody'),btnClose:$('btnClose'),toast:$('toast'),sessionInfo:$('sessionInfo'),syncState:$('syncState')};

function load(k,f){try{const v=localStorage.getItem(k);return v?JSON.parse(v):f;}catch(e){return f;}}
function save(k,v){localStorage.setItem(k,JSON.stringify(v));}
function nowISO(){return new Date().toISOString();}
function canEditStands(){return session.role==='ADMIN'||session.role==='SUPERVISOR';}
function canOverride(){return session.role==='ADMIN'||session.role==='SUPERVISOR';}
function toast(m){ui.toast.textContent=m;ui.toast.hidden=false;setTimeout(()=>ui.toast.hidden=true,2200);}
function snapshot(){return {stands,planes};}
function addAudit(action,meta={}){audit.unshift({t:nowISO(),user:session.user,role:session.role,action,meta,state:snapshot()});audit=audit.slice(0,500);save(STORE.audit,audit);}

function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);}
function escapeAttr(s){return escapeHtml(s).replace(/"/g,'&quot;');}

function syncHeader(){ui.sessionInfo.textContent=`${session.user} · ${session.role}`;ui.syncState.textContent=SYNC.enabled?'SYNC':'LOCAL';ui.btnMode.disabled=!canEditStands();ui.btnMode.style.opacity=canEditStands()?'1':'.55';}

function openModal(title,html,onSave=null,saveLabel='Guardar'){ui.modalTitle.textContent=title;ui.modalBody.innerHTML=html+(onSave?`<div class="row" style="margin-top:10px;justify-content:flex-end"><button id="modalSave" class="btn primary">${saveLabel}</button></div>`:'');ui.modal.hidden=ui.backdrop.hidden=false;if(onSave)$('modalSave').onclick=()=>{onSave();closeModal();};}
function closeModal(){ui.modal.hidden=ui.backdrop.hidden=true;}
ui.btnClose.onclick=closeModal;ui.backdrop.onclick=closeModal;

function setMode(next){mode=next;ui.modeLabel.textContent=next==='TIMELINE_VIEW'?'TIMELINE':(next==='EDITOR'?'EDITOR':'OPERATIVO');ui.btnMode.textContent=(next==='EDITOR')?'✅ Operativo':'🛠 Editor';}

function getStandById(id){return stands.find(s=>s.id===id);}
function standOccupied(id){return planes.some(p=>p.standId===id);}
function standBusyByPlane(id){return planes.find(p=>p.standId===id)||null;}

function planeColorByStatus(st){return ({ARR:'#ff7a00',DEP:'#2ecc71',TRN:'#f39c12',NS:'#3498db',MX:'#e74c3c'})[st]||'#ff7a00';}

function renderOverlay(){if(overlayLayer){overlayLayer.remove();overlayLayer=null;}if(!overlays.enabled||!overlays.geojson)return;overlayLayer=L.geoJSON(overlays.geojson,{style:()=>({weight:2,color:'#ffffff',opacity:0.5})}).addTo(map);}

function standStyle(s){if(s.locked)return {color:'#3498db',weight:2,fillOpacity:0.9};if(s.status==='MAINT')return {color:'#e74c3c',weight:2,fillOpacity:0.9};if(standOccupied(s.id))return {color:'#f39c12',weight:2,fillOpacity:0.9};return {color:'#ffffff',weight:1,fillOpacity:0.9};}

function clearLayers(){standLayers.forEach(g=>g.remove());standLayers.clear();planeLayers.forEach(m=>m.remove());planeLayers.clear();}

function renderStands(state=null){const sdata=state?state.stands:stands;standLayers.forEach(g=>g.remove());standLayers.clear();sdata.forEach(s=>{const st=standStyle(s);const dot=L.circleMarker([s.lat,s.lng],{radius:3,color:'#fff',weight:1});const ang=(s.heading-90)*Math.PI/180;const len=0.00010;const end=[s.lat+len*Math.sin(ang),s.lng+len*Math.cos(ang)];const line=L.polyline([[s.lat,s.lng],end],{color:'#fff',weight:1});const labelPos=[s.lat+(len*1.25)*Math.sin(ang),s.lng+(len*1.25)*Math.cos(ang)];const label=L.marker(labelPos,{icon:L.divIcon({html:`<div class="stand-label">${escapeHtml(s.name)}</div>`,className:''})});const ring=L.circleMarker([s.lat,s.lng],{radius:7,...st});const group=L.layerGroup([ring,dot,line,label]).addTo(map);standLayers.set(s.id,group);ring.on('click',()=>{if(mode!=='EDITOR')return;if(!canEditStands())return toast('Sin permiso');openStandEditor(s.id);});});}

function planeIconHTML(p,s){const scale=(PLANE_TYPES[p.type]?.scale??1.0);const size=Math.round(40*scale);const color=planeColorByStatus(p.opStatus);const svg=`<svg class="plane-svg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
<path d="M31 4c3 0 4 2 4 4v15l19 10c1 1 1 3 0 4l-2 2c-1 1-2 1-3 0L35 33v10l6 5c1 1 1 2 0 3l-1 2c-1 1-2 1-3 0l-7-4-7 4c-1 1-2 1-3 0l-1-2c-1-1-1-2 0-3l6-5V33L15 43c-1 1-2 1-3 0l-2-2c-1-1-1-3 0-4l19-10V8c0-2 1-4 2-4z"
fill="#ff7a00"/>
</svg>`.replace(/#ff7a00/g,color);return `<div class="plane-wrap" style="width:${size}px;height:${size}px">
  <div style="transform:rotate(${s.heading}deg);transform-origin:center">${svg}</div>
  <div class="plane-label" data-id="${p.id}" style="left:${p.labelDx}px;top:${p.labelDy}px;color:${p.labelColor};background:${p.labelBg}">${escapeHtml(p.reg)}</div>
</div>`;}

function renderPlanes(state=null){const pdata=state?state.planes:planes;planeLayers.forEach(m=>m.remove());planeLayers.clear();pdata.forEach(p=>{if(!p.standId)return;const s=(state?state.stands:stands).find(x=>x.id===p.standId);if(!s)return;const html=planeIconHTML(p,s);const marker=L.marker([s.lat,s.lng],{icon:L.divIcon({html,className:''})}).addTo(map);planeLayers.set(p.id,marker);});makeLabelsDraggable();}

function makeLabelsDraggable(){document.querySelectorAll('.plane-label').forEach(el=>{let sx,sy,ox,oy;el.onmousedown=(e)=>{if(mode==='TIMELINE_VIEW')return;sx=e.clientX;sy=e.clientY;ox=parseInt(el.style.left||'0',10);oy=parseInt(el.style.top||'0',10);document.onmousemove=(ev)=>{el.style.left=(ox+(ev.clientX-sx))+'px';el.style.top=(oy+(ev.clientY-sy))+'px';};document.onmouseup=()=>{document.onmousemove=null;const p=planes.find(x=>String(x.id)===String(el.dataset.id));if(p){p.labelDx=parseInt(el.style.left,10);p.labelDy=parseInt(el.style.top,10);save(STORE.planes,planes);addAudit('MOVE_LABEL',{planeId:p.id,reg:p.reg,dx:p.labelDx,dy:p.labelDy});}};});});}

function renderLists(state=null){const sdata=state?state.stands:stands;const pdata=state?state.planes:planes;const sQ=(ui.standSearch.value||'').toLowerCase().trim();const pQ=(ui.planeSearch.value||'').toLowerCase().trim();
ui.standList.innerHTML='';sdata.filter(s=>!sQ||s.name.toLowerCase().includes(sQ)).sort((a,b)=>a.name.localeCompare(b.name)).forEach(s=>{const occ=pdata.find(p=>p.standId===s.id);const badge=s.locked?'<span class="badge lock">LOCK</span>':(s.status==='MAINT'?'<span class="badge maint">MAINT</span>':(occ?'<span class="badge busy">OCC</span>':'<span class="badge ok">FREE</span>'));const el=document.createElement('div');el.className='item';el.innerHTML=`<div class="t">${escapeHtml(s.name)} ${badge}</div><div class="s">HDG ${s.heading}° · ${occ?('Avión: '+escapeHtml(occ.reg)):'Sin avión'}</div>`;el.onclick=()=>{if(mode==='TIMELINE_VIEW')return;if(mode==='EDITOR'){if(!canEditStands())return toast('Sin permiso');openStandEditor(s.id);}else{openStandActions(s.id);}};ui.standList.appendChild(el);});
ui.planeList.innerHTML='';pdata.filter(p=>!pQ||p.reg.toLowerCase().includes(pQ)).sort((a,b)=>a.reg.localeCompare(b.reg)).forEach(p=>{const s=sdata.find(x=>x.id===p.standId);const el=document.createElement('div');el.className='item';el.innerHTML=`<div class="t">${escapeHtml(p.reg)} <span class="badge ok">${p.opStatus}</span></div><div class="s">${p.type} · Stand: ${s?escapeHtml(s.name):'—'}</div>`;el.onclick=()=>{if(mode==='TIMELINE_VIEW')return;openPlaneEditor(p.id);};ui.planeList.appendChild(el);});}

function redraw(state=null){clearLayers();renderOverlay();renderStands(state);renderPlanes(state);renderLists(state);}

// ----- Modals -----
function openLogin(){const roleOpts=ROLES.map(r=>`<option value="${r}" ${r===session.role?'selected':''}>${r}</option>`).join('');openModal('Sesión',`<div class="kicker">Usuario</div><input id="u" class="input" value="${escapeAttr(session.user)}"/><div class="kicker">Rol</div><select id="r" class="input">${roleOpts}</select><div class="hint">OPERATOR: operar. SUPERVISOR/ADMIN: editor + override.</div>`,()=>{session={user:$('u').value.trim()||'Operador',role:$('r').value};save(STORE.session,session);syncHeader();addAudit('LOGIN',{user:session.user,role:session.role});toast('Sesión actualizada');});}

function openStandEditor(standId=null,latlng=null){const s=standId?getStandById(standId):null;let previewLine=null;const name=s?s.name:'';const heading=s?s.heading:0;const status=s?s.status:'OK';const locked=s?!!s.locked:false;
openModal(s?'Editar posición':'Nueva posición',`<div class="kicker">Nombre</div><input id="sn" class="input" value="${escapeAttr(name)}" placeholder="14B"/><div class="kicker">Heading</div><input id="sh" class="input" type="range" min="0" max="360" value="${heading}"/><div class="row between"><div class="hint">HDG: <b id="shv">${heading}°</b> (preview punteado)</div><label class="hint"><input id="slock" type="checkbox" ${locked?'checked':''}> Locked</label></div><div class="kicker">Estado</div><select id="sst" class="input"><option value="OK" ${status==='OK'?'selected':''}>OK</option><option value="MAINT" ${status==='MAINT'?'selected':''}>MAINT</option></select>`,()=>{const nm=$('sn').value.trim();const hdg=Number($('sh').value)||0;const st=$('sst').value;const lk=$('slock').checked;if(!nm)return toast('Nombre requerido');if(s){s.name=nm;s.heading=hdg;s.status=st;s.locked=lk;save(STORE.stands,stands);addAudit('EDIT_STAND',{id:s.id,name:nm,heading:hdg,status:st,locked:lk});}else{const id=String(Date.now());stands.push({id,name:nm,heading:hdg,status:st,locked:lk,lat:latlng.lat,lng:latlng.lng});save(STORE.stands,stands);addAudit('CREATE_STAND',{id,name:nm,heading:hdg,status:st,locked:lk});}if(previewLine){previewLine.remove();previewLine=null;}redraw();});
setTimeout(()=>{const sh=$('sh');const shv=$('shv');sh.oninput=()=>{shv.textContent=sh.value+'°';if(previewLine)previewLine.remove();if(!latlng&&s)latlng={lat:s.lat,lng:s.lng};const rad=(Number(sh.value)-90)*Math.PI/180;const len=0.00012;const end=[latlng.lat+len*Math.sin(rad),latlng.lng+len*Math.cos(rad)];previewLine=L.polyline([[latlng.lat,latlng.lng],end],{color:'#fff',weight:1,dashArray:'4,4'}).addTo(map);};sh.oninput();},50);}

function openPlaneCreate(preStandId=null){if(mode!=='OPERATIVE')return toast('Sólo en modo operativo');const opts=stands.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<option value="${s.id}" ${s.id===preStandId?'selected':''}>${escapeHtml(s.name)}</option>`).join('');const typeOpts=Object.keys(PLANE_TYPES).map(t=>`<option value="${t}">${t}</option>`).join('');const stOpts=PLANE_STATUS.map(x=>`<option value="${x}">${x}</option>`).join('');
openModal('Nuevo avión',`<div class="kicker">Matrícula</div><input id="pr" class="input" placeholder="LV-KEH"/><div class="grid2"><div><div class="kicker">Tipo</div><select id="pt" class="input">${typeOpts}</select></div><div><div class="kicker">Estado</div><select id="ps" class="input">${stOpts}</select></div></div><div class="kicker">Stand</div><select id="pstand" class="input">${opts}</select><div class="grid2"><div><div class="kicker">Texto</div><input id="pc" class="input" type="color" value="#ffffff"/></div><div><div class="kicker">Fondo</div><input id="pb" class="input" type="color" value="#000000"/></div></div><div class="hint">Arrastrá la matrícula en el mapa para ubicarla.</div>`,()=>{const reg=$('pr').value.trim().toUpperCase();if(!reg)return toast('Matrícula requerida');const standId=$('pstand').value;const st=getStandById(standId);if(!st)return toast('Stand inválido');if(st.locked)return toast('Stand LOCKED');if(st.status==='MAINT')return toast('Stand en MAINT');if(standOccupied(standId)){if(!canOverride())return toast('Stand ocupado (sin override)');const occ=standBusyByPlane(standId);if(!confirm(`Stand ocupado por ${occ?.reg||'otro'}. ¿Override?`))return;addAudit('OVERRIDE_STAND',{standId,by:session.user,occ:occ?.reg});occ.standId=null;}const plane={id:Date.now(),reg,type:$('pt').value,opStatus:$('ps').value,standId,labelDx:44,labelDy:-8,labelColor:$('pc').value,labelBg:$('pb').value};planes.push(plane);save(STORE.planes,planes);addAudit('CREATE_PLANE',{id:plane.id,reg,standId,type:plane.type,status:plane.opStatus});redraw();toast('Avión creado');});}

function openPlaneEditor(planeId){const p=planes.find(x=>x.id===planeId);if(!p)return;const typeOpts=Object.keys(PLANE_TYPES).map(t=>`<option value="${t}" ${t===p.type?'selected':''}>${t}</option>`).join('');const stOpts=PLANE_STATUS.map(x=>`<option value="${x}" ${x===p.opStatus?'selected':''}>${x}</option>`).join('');const standOpts=stands.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<option value="${s.id}" ${s.id===p.standId?'selected':''}>${escapeHtml(s.name)}</option>`).join('');
openModal('Editar avión',`<div class="kicker">Matrícula</div><input id="er" class="input" value="${escapeAttr(p.reg)}"/><div class="grid2"><div><div class="kicker">Tipo</div><select id="et" class="input">${typeOpts}</select></div><div><div class="kicker">Estado</div><select id="es" class="input">${stOpts}</select></div></div><div class="kicker">Stand</div><select id="estand" class="input">${standOpts}</select><div class="grid2"><div><div class="kicker">Color texto</div><input id="ec" class="input" type="color" value="${escapeAttr(p.labelColor)}"/></div><div><div class="kicker">Fondo</div><input id="eb" class="input" type="color" value="${escapeAttr(p.labelBg)}"/></div></div><div class="row between"><button id="resetLabel" class="btn">Reset label</button><button id="delPlane" class="btn" style="border-color:rgba(231,76,60,.6)">Eliminar</button></div>`,()=>{const reg=$('er').value.trim().toUpperCase();const newStandId=$('estand').value;const target=getStandById(newStandId);if(!reg)return toast('Matrícula requerida');if(!target)return toast('Stand inválido');if(target.locked)return toast('Stand LOCKED');if(target.status==='MAINT')return toast('Stand en MAINT');const occ=standBusyByPlane(newStandId);if(occ&&occ.id!==p.id){if(!canOverride())return toast('Stand ocupado (sin override)');if(!confirm(`Stand ocupado por ${occ.reg}. ¿Override?`))return;addAudit('OVERRIDE_STAND',{standId:newStandId,by:session.user,occ:occ.reg});occ.standId=null;}const before={...p};p.reg=reg;p.type=$('et').value;p.opStatus=$('es').value;p.standId=newStandId;p.labelColor=$('ec').value;p.labelBg=$('eb').value;save(STORE.planes,planes);addAudit('EDIT_PLANE',{before,after:p});redraw();toast('Actualizado');});
setTimeout(()=>{$('resetLabel').onclick=()=>{p.labelDx=44;p.labelDy=-8;save(STORE.planes,planes);addAudit('RESET_LABEL',{planeId:p.id,reg:p.reg});redraw();closeModal();};$('delPlane').onclick=()=>{if(!confirm('¿Eliminar avión?'))return;planes=planes.filter(x=>x.id!==p.id);save(STORE.planes,planes);addAudit('DELETE_PLANE',{planeId:p.id,reg:p.reg});redraw();closeModal();};},30);}

function openStandActions(standId){const s=getStandById(standId);if(!s)return;const occ=standBusyByPlane(standId);openModal(`Stand ${escapeHtml(s.name)}`,`
<div class="kicker">Estado</div><div class="hint">HDG ${s.heading}° · ${s.locked?'LOCKED':''} ${s.status}</div>
<div class="divider"></div><div class="kicker">Ocupación</div><div class="hint">${occ?('Ocupado por: <b>'+escapeHtml(occ.reg)+'</b>'):'Libre'}</div>
<div class="divider"></div><button id="assign" class="btn primary">Asignar avión aquí</button>
${occ?'<button id="unassign" class="btn" style="margin-top:8px">Desasignar avión</button>':''}
`,null);
setTimeout(()=>{$('assign').onclick=()=>{closeModal();openPlaneCreate(standId);};if(occ)$('unassign').onclick=()=>{if(!canOverride())return toast('Sólo Supervisor/Admin');if(!confirm('¿Desasignar avión?'))return;occ.standId=null;save(STORE.planes,planes);addAudit('UNASSIGN',{planeId:occ.id,reg:occ.reg,standId});redraw();closeModal();};},20);}

function openAudit(){const rows=audit.slice(0,120).map(a=>`<div style="border-bottom:1px solid var(--line);padding:8px 0"><div><b>${escapeHtml(a.action)}</b> · <span style="color:var(--muted)">${escapeHtml(a.user)} (${a.role})</span></div><div style="color:var(--muted);font-size:12px">${a.t}</div></div>`).join('')||'<div class="hint">Sin eventos</div>';openModal('Auditoría',`<div style="max-height:60vh;overflow:auto">${rows}</div>`,null);}

function openTimeline(){if(audit.length===0)return toast('Sin histórico');const max=audit.length-1;setMode('TIMELINE_VIEW');timelineIndex=0;
openModal('Timeline',`<div class="row"><input id="ts" type="range" class="input" min="0" max="${max}" value="0"/></div><div class="hint">0 = ahora. Arrastrá para ver el estado en ese momento.</div><div class="divider"></div><div class="kicker">Evento</div><div id="te" class="hint"></div><div class="row between" style="margin-top:10px"><button id="exitTL" class="btn primary">Salir timeline</button></div>`,null);
const ts=$('ts'), te=$('te');function apply(i){timelineIndex=Number(i);const ev=audit[timelineIndex];te.innerHTML=`<b>${escapeHtml(ev.action)}</b><br>${escapeHtml(ev.user)} · ${ev.t}`;redraw(ev.state);}
setTimeout(()=>{apply(0);ts.oninput=()=>apply(ts.value);$('exitTL').onclick=()=>{closeModal();timelineIndex=null;setMode('OPERATIVE');redraw();};},50);}

function openLayers(){openModal('Capas',`<div class="row between"><div class="hint">Overlay GeoJSON</div><label class="hint"><input id="oen" type="checkbox" ${overlays.enabled?'checked':''}> Activar</label></div><div class="divider"></div><button id="loadGeo" class="btn">Importar GeoJSON</button><button id="clearGeo" class="btn" style="margin-left:8px">Quitar</button><div class="hint" style="margin-top:10px">Tip: generá GeoJSON con geojson.io/QGIS.</div>`,null);
setTimeout(()=>{$('oen').onchange=(e)=>{overlays.enabled=e.target.checked;save(STORE.overlays,overlays);addAudit('TOGGLE_OVERLAY',{enabled:overlays.enabled});renderOverlay();};$('loadGeo').onclick=()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.json,.geojson,application/geo+json';inp.onchange=(ev)=>{const f=ev.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{overlays.geojson=JSON.parse(r.result);overlays.enabled=true;save(STORE.overlays,overlays);addAudit('LOAD_OVERLAY',{});renderOverlay();toast('Overlay cargado');}catch(e){toast('GeoJSON inválido');}};r.readAsText(f);};inp.click();};$('clearGeo').onclick=()=>{overlays.geojson=null;save(STORE.overlays,overlays);addAudit('CLEAR_OVERLAY',{});renderOverlay();toast('Overlay quitado');};},30);}

function exportAll(){const data={stands,planes,audit,overlays,session};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='eze_plataforma_ops_backup.json';a.click();}
function importAll(file){const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);stands=d.stands||[];planes=d.planes||[];audit=d.audit||[];overlays=d.overlays||{geojson:null,enabled:false};session=d.session||session;save(STORE.stands,stands);save(STORE.planes,planes);save(STORE.audit,audit);save(STORE.overlays,overlays);save(STORE.session,session);addAudit('IMPORT',{});syncHeader();redraw();toast('Importado');}catch(e){toast('Archivo inválido');}};r.readAsText(file);}

// Sync optional (manual)
async function syncPull(){if(!SYNC.enabled||!SYNC.endpoint)return;try{const res=await fetch(SYNC.endpoint,{method:'GET'});const data=await res.json();if(data&&data.stands&&data.planes){stands=data.stands;planes=data.planes;audit=data.audit||audit;overlays=data.overlays||overlays;save(STORE.stands,stands);save(STORE.planes,planes);save(STORE.audit,audit);save(STORE.overlays,overlays);ui.syncState.textContent='SYNC';redraw();}}catch(e){}}
async function syncPush(){if(!SYNC.enabled||!SYNC.endpoint)return;try{const payload={stands,planes,audit,overlays};await fetch(SYNC.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});ui.syncState.textContent='SYNC';toast('Sync OK');}catch(e){toast('Sync error');}}

// UI wiring
ui.btnLogin.onclick=openLogin;
ui.btnAddPlane.onclick=()=>openPlaneCreate(null);
ui.btnAudit.onclick=openAudit;
ui.btnTimeline.onclick=openTimeline;
ui.btnLayers.onclick=openLayers;
ui.btnExport.onclick=exportAll;
ui.btnImport.onclick=()=>ui.fileImport.click();
ui.fileImport.onchange=(e)=>{const f=e.target.files[0];if(f)importAll(f);ui.fileImport.value='';};
ui.btnMode.onclick=()=>{if(!canEditStands())return toast('Sólo Supervisor/Admin');if(mode==='EDITOR')setMode('OPERATIVE');else setMode('EDITOR');toast(mode==='EDITOR'?'Modo editor':'Modo operativo');};
ui.btnSync.onclick=()=>{if(!SYNC.enabled)return toast('Sync desactivado (ver SYNC en app.js)');syncPush().then(syncPull);};
ui.standSearch.oninput=()=>renderLists(timelineIndex!==null?audit[timelineIndex].state:null);
ui.planeSearch.oninput=()=>renderLists(timelineIndex!==null?audit[timelineIndex].state:null);

// init map
function init(){map=L.map('map').setView([-34.8222,-58.5358],16);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri'}).addTo(map);
map.on('click',(e)=>{if(mode!=='EDITOR')return;if(!canEditStands())return toast('Sin permiso');openStandEditor(null,e.latlng);});
syncHeader();renderOverlay();redraw();
if(SYNC.enabled&&SYNC.endpoint){setInterval(syncPull,SYNC.poll_ms);syncPull();}
}
init();
})();
