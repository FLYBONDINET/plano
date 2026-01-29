// app.js - main UI + map + rendering
(() => {
  const { Editor, Modal, toast } = window.SAEZ_EDITOR;
  const API = window.SAEZ_API;
  const TL = window.SAEZ_TL;

  // Ezeiza coordinates
  const SAEZ = { lat: -34.8222, lng: -58.5358 };

  // Map setup
  const map = L.map('map', {
    zoomControl: true,
    preferCanvas: true
  }).setView([SAEZ.lat, SAEZ.lng], 15);

  // Free satellite imagery (Esri)
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles © Esri' }
  ).addTo(map);

  // Layers
  const layerPositions = L.layerGroup().addTo(map);
  const layerMoves = L.layerGroup().addTo(map);

  // DOM
  const positionsList = document.getElementById('positionsList');
  const flightsList = document.getElementById('flightsList');
  const posCount = document.getElementById('posCount');
  const fltCount = document.getElementById('fltCount');
  const btnEdit = document.getElementById('btnEdit');
  const btnRefresh = document.getElementById('btnRefresh');
  const editorBadge = document.getElementById('editorBadge');
  const connDot = document.getElementById('connDot');
  const connText = document.getElementById('connText');

  const simTimeEl = document.getElementById('simTime');
  const timeSlider = document.getElementById('timeSlider');
  const btnPlay = document.getElementById('btnPlay');
  const btnPause = document.getElementById('btnPause');
  const speedSel = document.getElementById('speedSel');

  // Cards state
const cardByKey = new Map(); // key => { el, latlng, pinned, offsetPx:{dx,dy} }

  let currentData = { arrivals: [], departures: [], merged: [] };

  // Helpers
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  function setConn(state, text){
    const colors = {
      idle: 'rgba(255,255,255,0.25)',
      ok: 'rgba(45,212,191,0.95)',
      warn: 'rgba(245,158,11,0.95)',
      bad: 'rgba(251,113,133,0.95)',
    };
    connDot.style.background = colors[state] || colors.idle;
    connDot.style.boxShadow = `0 0 0 4px rgba(255,255,255,0.05), 0 0 18px ${colors[state] || colors.idle}`;
    connText.textContent = text || '—';
  }

  function normalizePosName(s){
    return String(s || '').trim().toUpperCase();
  }

  function parseMovement(posStr){
    // expects "72>50B" or "72 > 50B"
    if (!posStr) return null;
    const s = String(posStr).replace(/\s+/g,'').toUpperCase();
    const m = s.match(/^([A-Z0-9-]+)>([A-Z0-9-]+)$/);
    if (!m) return null;
    return { from: m[1], to: m[2] };
  }

  function badgeForStatus(status){
    const s = String(status||'').toUpperCase();
    if (s.includes('ATERR') || s.includes('LAND') || s.includes('ON')) return ['bad','ATERR'];
    if (s.includes('VUELO') || s.includes('AIR')) return ['warn','EN VUELO'];
    if (['PRE','BOR','ULT','CER'].includes(s)) return ['good', s];
    return ['badge', s || '—'];
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ===========================
  // ✅ Modal: cierre robusto
  // ===========================
  function forceCloseModal(){
    try{
      Modal.close();
    }catch(e){
      const bd = document.getElementById("modalBackdrop");
      if (bd) bd.hidden = true;
    }
  }

  // Botón X (1 sola vez, sin acumulación)
  const modalCloseBtn = document.getElementById("modalClose");
  if (modalCloseBtn) modalCloseBtn.onclick = forceCloseModal;

  // Click afuera
  const modalBackdrop = document.getElementById("modalBackdrop");
  if (modalBackdrop){
    modalBackdrop.onclick = (e) => {
      if (e.target && e.target.id === "modalBackdrop") forceCloseModal();
    };
  }

  // Tecla ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") forceCloseModal();
  });

  // ===========================
  // Cards
  // ===========================
function mountCard(key){
  if (cardByKey.has(key)) return cardByKey.get(key).el;

  const el = document.createElement('div');
  el.className = 'flight-card';
  el.dataset.key = key;
  el.innerHTML = `
    <div class="fc-head">
      <div class="fc-title" data-role="title">—</div>
      <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
        <span class="fc-pill" data-role="pos">POS —</span>
        <span class="fc-pill" data-role="type">—</span>
      </div>
    </div>
    <div class="fc-body" data-role="body"></div>
  `;
  document.querySelector('.map-wrap').appendChild(el);

  // offset default: “al lado” (derecha y un poquito arriba)
  const obj = { el, pinned:false, latlng:null, offsetPx:{ dx: 26, dy: -30 } };
  cardByKey.set(key, obj);

  // Drag (actualiza offset relativo al punto)
  const head = el.querySelector('.fc-head');
  let dragging = false;

  const onDown = (ev) => {
    if (!obj.latlng) return;
    dragging = true;
    head.setPointerCapture(ev.pointerId);
    el.style.zIndex = 450;

    // durante drag trabajamos sin transform para mover “exacto”
    const r = el.getBoundingClientRect();
    el.style.transform = 'none';
    el.style.left = r.left + 'px';
    el.style.top  = r.top  + 'px';
  };

  const onMove = (ev) => {
    if (!dragging) return;
    // mover directo en pantalla
    el.style.left = (ev.clientX - el.offsetWidth/2) + 'px';
    el.style.top  = (ev.clientY - 20) + 'px';
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;

    if (!obj.latlng) return;

    // calcular nuevo offset relativo al punto de la posición
    const anchor = map.latLngToContainerPoint(obj.latlng);
    const left = parseFloat(el.style.left || '0');
    const top  = parseFloat(el.style.top  || '0');

    // como durante drag no hay transform, convertimos a offset para el modo anclado
    obj.offsetPx.dx = (left - anchor.x) + (el.offsetWidth/2);
    obj.offsetPx.dy = (top  - anchor.y) + 20;

    obj.pinned = true;

    // volver a modo anclado
    el.style.transform = 'translate(-50%, -100%)';
    placeCardAtLatLng(key, obj.latlng);
  };

  head.addEventListener('pointerdown', onDown);
  head.addEventListener('pointermove', onMove);
  head.addEventListener('pointerup', onUp);
  head.addEventListener('pointercancel', onUp);

  return el;
}


  function unmountMissingCards(validKeys){
    for (const [key, obj] of cardByKey.entries()){
      if (!validKeys.has(key)){
        obj.el.remove();
        cardByKey.delete(key);
      }
    }
  }

function placeCardAtLatLng(key, latlng){
  const obj = cardByKey.get(key);
  if (!obj) return;

  obj.latlng = latlng;

  const p = map.latLngToContainerPoint(latlng);

  // offset “al lado de la posición”
  const dx = obj.offsetPx?.dx ?? 26;
  const dy = obj.offsetPx?.dy ?? -30;

  obj.el.style.left = (p.x + dx) + 'px';
  obj.el.style.top  = (p.y + dy) + 'px';
  obj.el.style.transform = 'translate(-50%, -100%)';
}


  function hashCode(s){
    let h = 0;
    for (let i=0;i<s.length;i++) h = ((h<<5)-h) + s.charCodeAt(i) | 0;
    return Math.abs(h);
  }

  function nudgeToAvoidOverlap(){
    const cards = Array.from(cardByKey.values()).map(o => o.el);
    const rects = cards.map(c => ({ el:c, r:c.getBoundingClientRect() }));
    for (let iter=0; iter<2; iter++){
      for (let i=0;i<rects.length;i++){
        for (let j=i+1;j<rects.length;j++){
          const a = rects[i], b = rects[j];
          const keyA = a.el.dataset.key, keyB = b.el.dataset.key;
          if (cardByKey.get(keyA)?.pinned || cardByKey.get(keyB)?.pinned) continue;

          const ra = a.r, rb = b.r;
          const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (overlapX > 0 && overlapY > 0){
            const pushX = overlapX/2 + 6;
            const pushY = overlapY/2 + 6;
            const dirX = (rb.left + rb.width/2) - (ra.left + ra.width/2);
            const dirY = (rb.top + rb.height/2) - (ra.top + ra.height/2);
            const sx = dirX >= 0 ? 1 : -1;
            const sy = dirY >= 0 ? 1 : -1;

            const bLeft = parseFloat(b.el.style.left || '0');
            const bTop  = parseFloat(b.el.style.top  || '0');
            b.el.style.left = (bLeft + sx*pushX) + 'px';
            b.el.style.top  = (bTop  + sy*pushY) + 'px';
            b.el.style.transform = 'translate(-50%, -100%)';
            b.r = b.el.getBoundingClientRect();
          }
        }
      }
    }
  }

  // Render positions to map and sidebar
  const posMarkerById = new Map();

  function renderPositions(){
    posCount.textContent = String(Editor.positions.length);

    layerPositions.clearLayers();
    posMarkerById.clear();

    Editor.positions.forEach(p => {
      const icon = L.divIcon({
        className: 'pos-icon',
        html: `<div class="pos-dot"><div class="pos-label">${escapeHtml(p.name)}</div></div>`,
        iconSize: [1,1]
      });

      const m = L.marker([p.lat, p.lng], { icon }).addTo(layerPositions);
      posMarkerById.set(p.id, m);
    });

    positionsList.innerHTML = '';
    Editor.positions.forEach(p => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="item-row">
          <div>
            <div class="item-title">${escapeHtml(p.name)}</div>
            <div class="item-sub">
              <span class="badge">HDG ${escapeHtml(String(p.hdg))}°</span>
              <span class="badge mono">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span>
            </div>
          </div>
          <div class="item-actions">
            <button class="icon-btn" title="Editar" data-act="edit"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn" title="Eliminar" data-act="del"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
      `;
      el.querySelector('[data-act="edit"]').addEventListener('click', () => openEditPosition(p));
      el.querySelector('[data-act="del"]').addEventListener('click', () => {
        if (confirm(`Eliminar posición ${p.name}?`)) Editor.removePosition(p.id);
      });
      el.addEventListener('dblclick', () => {
        map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17));
      });
      positionsList.appendChild(el);
    });
  }

  // Custom CSS for position markers
  const stylePos = document.createElement('style');
  stylePos.textContent = `
    .pos-dot{
      position:relative;
      width: 10px; height: 10px;
      border-radius:50%;
      background: rgba(255,209,0,0.95);
      box-shadow: 0 0 0 6px rgba(255,209,0,0.10), 0 10px 18px rgba(0,0,0,.45);
      border: 1px solid rgba(0,0,0,0.35);
    }
    .pos-label{
      position:absolute;
      top:-28px; left:50%;
      transform: translateX(-50%);
      background: rgba(16,22,34,0.92);
      border: 1px solid rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.92);
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .2px;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(stylePos);

  // ===========================
  // Editor interactions
  // ===========================
  async function toggleEditor(){
    if (Editor.enabled){
      Editor.setEnabled(false);
      editorBadge.hidden = true;
      toast('Modo editor desactivado.');
      await refreshData();
      return;
    }

    const pass = prompt('Contraseña para modo editor:');
    if (pass !== '12345678'){
      toast('Contraseña incorrecta.');
      return;
    }
    Editor.setEnabled(true);
    editorBadge.hidden = false;
    toast('Modo editor activado. Click en el mapa para crear una posición.');
  }

  btnEdit.addEventListener('click', toggleEditor);

  // ✅ OPCIONAL MEJOR: si no está editor, no abre modal, muestra toast
  map.on("click", (ev) => {
    if (!Editor.enabled) {
      toast("Activá el modo editor para crear posiciones.");
      return;
    }
    openCreatePosition(ev.latlng);
  });

  function openCreatePosition(latlng){
    const tmpCircle = L.circleMarker(latlng, {
      radius: 7,
      weight: 2,
      color: '#FFD100',
      fillColor: '#FFD100',
      fillOpacity: 0.25
    }).addTo(map);

    const tmpLine = L.polyline([latlng, offsetLatLng(latlng, 120, 0)], {
      weight: 3,
      opacity: 0.9
    }).addTo(map);

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="row2">
        <div class="field">
          <div class="label">Número / nombre de posición</div>
          <input class="input mono" id="posName" placeholder="Ej: 72, 50B, 14A" />
        </div>
        <div class="field">
          <div class="label">HDG (0-359)</div>
          <input class="input mono" id="posHdg" type="number" min="0" max="359" value="0" />
        </div>
      </div>
      <div class="field">
        <div class="label">Vista previa: mové el HDG para girar la línea</div>
        <input id="hdgSlider" type="range" min="0" max="359" value="0" />
      </div>
      <div class="hint">
        <i class="fa-solid fa-bullseye"></i>
        <span>Al aceptar, se guarda la posición (punto + etiqueta). El HDG queda registrado en la lista.</span>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '10px';
    footer.style.justifyContent = 'flex-end';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-ghost';
    btnCancel.innerHTML = '<i class="fa-solid fa-ban"></i><span>Cancelar</span>';

    const btnOk = document.createElement('button');
    btnOk.className = 'btn btn-primary';
    btnOk.innerHTML = '<i class="fa-solid fa-check"></i><span>Guardar</span>';

    footer.appendChild(btnCancel);
    footer.appendChild(btnOk);

    Modal.open({ title:'Nueva posición', bodyEl: body, footerEl: footer });

    const nameEl = body.querySelector('#posName');
    const hdgEl = body.querySelector('#posHdg');
    const hdgSlider = body.querySelector('#hdgSlider');

    const syncHdg = (v) => {
      const hdg = (Number(v) || 0) % 360;
      hdgEl.value = String(hdg);
      hdgSlider.value = String(hdg);
      const end = offsetLatLng(latlng, 120, hdg);
      tmpLine.setLatLngs([latlng, end]);
    };

    hdgEl.addEventListener('input', () => syncHdg(hdgEl.value));
    hdgSlider.addEventListener('input', () => syncHdg(hdgSlider.value));

    btnCancel.addEventListener('click', () => {
      try { map.removeLayer(tmpCircle); } catch(e){}
      try { map.removeLayer(tmpLine); } catch(e){}
      forceCloseModal();
    });

    btnOk.addEventListener('click', () => {
      const name = normalizePosName(nameEl.value);
      const hdg = Math.floor(Number(hdgEl.value) || 0) % 360;
      if (!name){
        toast('Ingresá un número/nombre de posición.');
        return;
      }
      const pos = { id: uid(), name, hdg, lat: latlng.lat, lng: latlng.lng, createdAt: Date.now() };

      try { map.removeLayer(tmpCircle); } catch(e){}
      try { map.removeLayer(tmpLine); } catch(e){}
      forceCloseModal();

      Editor.addPosition(pos);
      toast(`Posición ${name} creada.`);
    });

    setTimeout(() => nameEl.focus(), 50);
  }

  function openEditPosition(p){
    const latlng = L.latLng(p.lat, p.lng);

    const tmpLine = L.polyline([latlng, offsetLatLng(latlng, 120, p.hdg)], {
      weight: 3,
      opacity: 0.9
    }).addTo(map);

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="row2">
        <div class="field">
          <div class="label">Posición</div>
          <input class="input mono" id="posName" value="${escapeHtml(p.name)}" />
        </div>
        <div class="field">
          <div class="label">HDG (0-359)</div>
          <input class="input mono" id="posHdg" type="number" min="0" max="359" value="${escapeHtml(String(p.hdg))}" />
        </div>
      </div>
      <div class="field">
        <div class="label">Giro de línea (preview)</div>
        <input id="hdgSlider" type="range" min="0" max="359" value="${escapeHtml(String(p.hdg))}" />
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.gap = '10px';
    footer.style.justifyContent = 'flex-end';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-ghost';
    btnCancel.innerHTML = '<i class="fa-solid fa-ban"></i><span>Cerrar</span>';

    const btnOk = document.createElement('button');
    btnOk.className = 'btn btn-primary';
    btnOk.innerHTML = '<i class="fa-solid fa-check"></i><span>Guardar</span>';

    footer.appendChild(btnCancel);
    footer.appendChild(btnOk);

    Modal.open({ title:`Editar posición ${p.name}`, bodyEl: body, footerEl: footer });

    const nameEl = body.querySelector('#posName');
    const hdgEl = body.querySelector('#posHdg');
    const hdgSlider = body.querySelector('#hdgSlider');

    const syncHdg = (v) => {
      const hdg = (Number(v) || 0) % 360;
      hdgEl.value = String(hdg);
      hdgSlider.value = String(hdg);
      const end = offsetLatLng(latlng, 120, hdg);
      tmpLine.setLatLngs([latlng, end]);
    };

    hdgEl.addEventListener('input', () => syncHdg(hdgEl.value));
    hdgSlider.addEventListener('input', () => syncHdg(hdgSlider.value));

    const cleanup = () => { try { map.removeLayer(tmpLine); } catch(e){} };

    btnCancel.addEventListener('click', () => {
      cleanup();
      forceCloseModal();
    });

    btnOk.addEventListener('click', () => {
      const name = normalizePosName(nameEl.value);
      const hdg = Math.floor(Number(hdgEl.value) || 0) % 360;
      if (!name){ toast('Nombre inválido.'); return; }
      Editor.updatePosition(p.id, { name, hdg });
      cleanup();
      forceCloseModal();
      toast(`Posición ${name} actualizada.`);
    });
  }

  function offsetLatLng(latlng, meters, bearingDeg){
    const R = 6378137;
    const brng = (bearingDeg * Math.PI) / 180;
    const dLat = (meters * Math.cos(brng)) / R;
    const dLng = (meters * Math.sin(brng)) / (R * Math.cos((latlng.lat*Math.PI)/180));
    return L.latLng(latlng.lat + (dLat*180/Math.PI), latlng.lng + (dLng*180/Math.PI));
  }

  // Flights logic
  function mergeFlights(arrivals, departures){
    const byReg = new Map();
    const regKey = (r) => String(r||'').trim().toUpperCase();

    arrivals.forEach(a => {
      const k = regKey(a.reg);
      if (!k || k === '-') return;
      byReg.set(k, { reg: k, arrival: { ...a, reg: k }, departure: null });
    });
    departures.forEach(d => {
      const k = regKey(d.reg);
      if (!k || k === '-') return;
      const cur = byReg.get(k) || { reg: k, arrival: null, departure: null };
      cur.departure = { ...d, reg: k };
      byReg.set(k, cur);
    });

    const merged = Array.from(byReg.values());
    merged.sort((a,b) => {
      const ap = normalizePosName(getPos(a));
      const bp = normalizePosName(getPos(b));
      if (!!ap && !bp) return -1;
      if (!!bp && !ap) return 1;
      return a.reg.localeCompare(b.reg);
    });
    return merged;

    function getPos(x){
      return x.departure?.pos || x.arrival?.pos || '';
    }
  }

  function computeDisplayState(f){
    const m = TL.minuteOfDay;
    const aMin = TL.toMinutes(f.arrival?.touchdownTime) ?? TL.toMinutes(f.arrival?.arrTime);
    const dMin = TL.toMinutes(f.departure?.updatedDepTime) ?? TL.toMinutes(f.departure?.depTime);

    const arrivalActive = f.arrival && aMin !== null ? (m >= (aMin - 120) && m <= (aMin + 360)) : !!f.arrival;
    const depActive = f.departure && dMin !== null ? (m >= (dMin - 180) && m <= (dMin + 240)) : !!f.departure;

    return { arrivalActive, depActive };
  }

  function renderFlights(){
    layerMoves.clearLayers();
    const validKeys = new Set();
    flightsList.innerHTML = '';

    currentData.merged.forEach(f => {
      const state = computeDisplayState(f);
      const posRaw = f.departure?.pos || f.arrival?.pos || '';
      const move = parseMovement(posRaw);
      const pos = move ? move.from : normalizePosName(posRaw);

      const posObj = pos ? Editor.findByName(pos) : null;
      const latlng = posObj ? L.latLng(posObj.lat, posObj.lng) : null;

      const key = f.reg;
      validKeys.add(key);

      const li = document.createElement('div');
      li.className = 'item';
      const typeLabel = f.arrival && f.departure ? 'TA' : (f.arrival ? 'ARR' : 'DEP');

      const arrLine = f.arrival ? `<span class="badge warn">ARR ${escapeHtml(f.arrival.flight)}</span><span class="badge">${escapeHtml(f.arrival.origin)} • ${escapeHtml(f.arrival.touchdownTime || f.arrival.arrTime || '-')}</span>` : '';
      const depLine = f.departure ? `<span class="badge good">DEP ${escapeHtml(f.departure.flight)}</span><span class="badge">${escapeHtml(f.departure.status)} • ${escapeHtml(f.departure.updatedDepTime || f.departure.depTime || '-')}</span>` : '';

      li.innerHTML = `
        <div class="item-row">
          <div>
            <div class="item-title mono">${escapeHtml(f.reg)}</div>
            <div class="item-sub">
              <span class="badge">${typeLabel}</span>
              ${pos ? `<span class="badge mono">POS ${escapeHtml(posRaw)}</span>` : `<span class="badge mono">SIN POS</span>`}
            </div>
            <div class="item-sub">
              ${arrLine}
              ${depLine}
            </div>
          </div>
          <div class="item-actions">
            <button class="icon-btn" title="Centrar" data-act="center"><i class="fa-solid fa-location-crosshairs"></i></button>
          </div>
        </div>
      `;
      li.querySelector('[data-act="center"]').addEventListener('click', () => {
        if (latlng) {
          map.setView(latlng, Math.max(map.getZoom(), 17), { animate:true });
          flashCard(key);
        } else {
          toast('Este vuelo no tiene posición creada en el mapa.');
        }
      });
      flightsList.appendChild(li);

      // Movimientos
      if (move){
        const from = Editor.findByName(move.from);
        const to = Editor.findByName(move.to);
        if (from && to){
          L.polyline([[from.lat,from.lng],[to.lat,to.lng]], { weight: 3, opacity: 0.9 }).addTo(layerMoves);
          const mid = L.latLng((from.lat+to.lat)/2, (from.lng+to.lng)/2);
          L.marker(mid, { icon: L.divIcon({ className:'', html:`<div class="arrow-head"></div>` })}).addTo(layerMoves);
          injectArrowCss();
        }
      }

      // Card en mapa
      if (latlng){
        const card = mountCard(key);
        updateCard(card, f, posRaw, typeLabel, state);
        placeCardAtLatLng(key, latlng);
      } else {
        if (cardByKey.has(key)){
          cardByKey.get(key).el.remove();
          cardByKey.delete(key);
        }
      }
    });

    unmountMissingCards(validKeys);
    fltCount.textContent = String(currentData.merged.length);
    setTimeout(nudgeToAvoidOverlap, 30);
  }

  function injectArrowCss(){
    if (injectArrowCss._done) return;
    injectArrowCss._done = true;
    const st = document.createElement('style');
    st.textContent = `
      .arrow-head{
        width: 0; height: 0;
        border-left: 8px solid transparent;
        border-right: 8px solid transparent;
        border-top: 14px solid rgba(255,209,0,0.95);
        filter: drop-shadow(0 8px 16px rgba(0,0,0,.45));
        transform: rotate(45deg);
      }
    `;
    document.head.appendChild(st);
  }

  function updateCard(cardEl, f, posRaw, typeLabel){
    const title = cardEl.querySelector('[data-role="title"]');
    const posEl = cardEl.querySelector('[data-role="pos"]');
    const typeEl = cardEl.querySelector('[data-role="type"]');
    const body = cardEl.querySelector('[data-role="body"]');

    title.textContent = f.reg;
    posEl.textContent = `POS ${posRaw || '—'}`;
    typeEl.textContent = typeLabel;

    const parts = [];
    if (f.arrival){
      const a = f.arrival;
      parts.push(`
        <div class="fc-section">
          <div class="fc-section-title"><i class="fa-solid fa-plane-arrival"></i> Arribo</div>
          <div class="fc-line"><span>Vuelo</span><b>${escapeHtml(a.flight)}</b></div>
          <div class="fc-line"><span>Origen</span><b>${escapeHtml(a.origin)}</b></div>
          <div class="fc-line"><span>Hora</span><b>${escapeHtml(a.touchdownTime || a.arrTime || '-')}</b></div>
          <div class="fc-line"><span>Estado</span><b>${escapeHtml(a.status || '-')}</b></div>
        </div>
      `);
    }
    if (f.departure){
      const d = f.departure;
      parts.push(`
        <div class="fc-section">
          <div class="fc-section-title"><i class="fa-solid fa-plane-departure"></i> Salida</div>
          <div class="fc-line"><span>Vuelo</span><b>${escapeHtml(d.flight)}</b></div>
          <div class="fc-line"><span>Hora</span><b>${escapeHtml(d.updatedDepTime || d.depTime || '-')}</b></div>
          <div class="fc-line"><span>Estado</span><b>${escapeHtml(d.status || '-')}</b></div>
          ${d.gate ? `<div class="fc-line"><span>Puerta</span><b>${escapeHtml(d.gate)}</b></div>` : ''}
          ${d.dest ? `<div class="fc-line"><span>Destino</span><b>${escapeHtml(d.dest)}</b></div>` : ''}
        </div>
      `);
    }
    body.innerHTML = parts.join('');
  }

  function flashCard(key){
    const obj = cardByKey.get(key);
    if (!obj) return;
    obj.el.animate(
      [{ transform: obj.el.style.transform }, { transform: obj.el.style.transform + ' scale(1.02)' }, { transform: obj.el.style.transform }],
      { duration: 550 }
    );
  }

  // Data fetching
  async function refreshData(){
    try{
      setConn('warn', 'Actualizando…');

      if (!API.GAS_URL){
        const url = prompt('Pegá la URL de tu Apps Script (Web App) para leer Google Sheets:', '');
        if (url) API.setGasUrl(url);
      }
      if (!API.GAS_URL){
        setConn('bad', 'Falta Apps Script');
        toast('No se configuró la URL del Apps Script.');
        return;
      }

      const todayISO = new Date().toISOString().slice(0,10);
      const data = await API.getData(todayISO);

      const arrivals = Array.isArray(data.arrivals) ? data.arrivals : [];
      const departures = Array.isArray(data.departures) ? data.departures : [];

      currentData = { arrivals, departures, merged: mergeFlights(arrivals, departures) };

      setConn('ok', `OK • ${arrivals.length} ARR • ${departures.length} DEP`);
      renderFlights();
    }catch(err){
      console.error(err);
      setConn('bad', 'Error datos');
      toast('Error al leer datos. Revisá la URL del Apps Script y el despliegue.');
    }
  }

  btnRefresh.addEventListener('click', refreshData);

map.on('move zoom', () => {
  for (const [key, obj] of cardByKey.entries()){
    if (!obj.latlng) continue;
    placeCardAtLatLng(key, obj.latlng);
  }
  setTimeout(nudgeToAvoidOverlap, 20);
});


  // Timelapse wiring
  function updateSimUI(){
    simTimeEl.textContent = TL.format(TL.minuteOfDay);
    timeSlider.value = String(TL.minuteOfDay);
    renderFlights();
  }

  TL.onChange(() => updateSimUI());
  timeSlider.addEventListener('input', () => TL.setMinute(Number(timeSlider.value)));
  speedSel.addEventListener('change', () => TL.setSpeed(speedSel.value));

  btnPlay.addEventListener('click', () => {
    TL.start();
    btnPlay.disabled = true;
    btnPause.disabled = false;
  });
  btnPause.addEventListener('click', () => {
    TL.stop();
    btnPlay.disabled = false;
    btnPause.disabled = true;
  });

  // Initial UI
  Editor.onChange(() => { renderPositions(); renderFlights(); });
  renderPositions();
  updateSimUI();
  setConn('idle', 'Listo');

  // 🔒 Asegurar que el modal arranque siempre oculto
  try { Modal.close(); } catch(e) {}
  const bd = document.getElementById("modalBackdrop");
  if (bd) bd.hidden = true;

  // Auto refresh once (optional)
  // refreshData();

})();
