// editor.js - positions editor + modal UI
(() => {
  const STORE_KEY = 'SAEZ_POSITIONS_V1';

  function loadPositions() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch { return []; }
  }
  function savePositions(list) {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  }

  // Each position: { id, name, hdg, lat, lng, createdAt }
  const Editor = {
    enabled: false,
    positions: loadPositions(),
    pending: null, // {lat,lng,tempLayer,lineLayer}
    listeners: new Set(),
  };

  Editor.onChange = (fn) => Editor.listeners.add(fn);
  Editor.emit = () => Editor.listeners.forEach(fn => fn(Editor.positions));

  Editor.setEnabled = (val) => {
    Editor.enabled = !!val;
    Editor.emit();
  };

  Editor.addPosition = (p) => {
    Editor.positions = [p, ...Editor.positions.filter(x => x.id !== p.id)];
    savePositions(Editor.positions);
    Editor.emit();
  };

  Editor.updatePosition = (id, patch) => {
    Editor.positions = Editor.positions.map(p => p.id === id ? { ...p, ...patch } : p);
    savePositions(Editor.positions);
    Editor.emit();
  };

  Editor.removePosition = (id) => {
    Editor.positions = Editor.positions.filter(p => p.id !== id);
    savePositions(Editor.positions);
    Editor.emit();
  };

  Editor.findByName = (name) => {
    const n = String(name || '').trim().toUpperCase();
    return Editor.positions.find(p => String(p.name).trim().toUpperCase() === n) || null;
  };

  // Simple modal framework
const Modal = {
  open({ title, bodyEl, footerEl }) {
    const bd = document.getElementById("modalBackdrop");
    const t = document.getElementById("modalTitle");
    const body = document.getElementById("modalBody");
    const footer = document.getElementById("modalFooter");

    if (t) t.textContent = title || "—";
    if (body) { body.innerHTML = ""; if (bodyEl) body.appendChild(bodyEl); }
    if (footer) { footer.innerHTML = ""; if (footerEl) footer.appendChild(footerEl); }

    // ✅ abrir
    bd.classList.add("is-open");
    bd.hidden = false; // por compatibilidad, pero ya no dependemos de esto
  },

  close() {
    const bd = document.getElementById("modalBackdrop");
    const body = document.getElementById("modalBody");
    const footer = document.getElementById("modalFooter");

    if (body) body.innerHTML = "";
    if (footer) footer.innerHTML = "";

    // ✅ cerrar
    bd.classList.remove("is-open");
    bd.hidden = true;
  }
};


  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => (t.hidden = true), 2800);
  }

  window.SAEZ_EDITOR = { Editor, Modal, toast };
})();