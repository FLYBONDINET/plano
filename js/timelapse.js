// timelapse.js - simple simulated clock
(() => {
  const TL = {
    running: false,
    speed: 1,
    minuteOfDay: 720, // default 12:00
    timer: null,
    listeners: new Set(),
  };

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  TL.setMinute = (m) => {
    TL.minuteOfDay = clamp(Math.floor(m), 0, 1439);
    TL.emit();
  };

  TL.setSpeed = (s) => {
    TL.speed = Math.max(1, Number(s) || 1);
  };

  TL.start = () => {
    if (TL.running) return;
    TL.running = true;
    const step = () => {
      TL.setMinute((TL.minuteOfDay + TL.speed) % 1440);
    };
    TL.timer = setInterval(step, 1000);
  };

  TL.stop = () => {
    TL.running = false;
    if (TL.timer) clearInterval(TL.timer);
    TL.timer = null;
  };

  TL.onChange = (fn) => TL.listeners.add(fn);
  TL.emit = () => TL.listeners.forEach(fn => fn(TL.minuteOfDay));

  TL.format = (m) => {
    const hh = String(Math.floor(m/60)).padStart(2,'0');
    const mm = String(m%60).padStart(2,'0');
    return `${hh}:${mm}`;
  };

  TL.toMinutes = (timeStr) => {
    // expects HH:MM or H:MM
    if (!timeStr || timeStr === '-' ) return null;
    const s = String(timeStr).trim();
    const match = s.match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const h = Number(match[1]); const m = Number(match[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return Math.max(0, Math.min(1439, h*60+m));
  };

  window.SAEZ_TL = TL;
})();