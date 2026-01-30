/**
 * SAEZ-ATCCTRL - Google Apps Script (Web App)
 * Lee datos de un Spreadsheet y devuelve JSON/JSONP.
 *
 * Deploy:
 * 1) Extensions → Apps Script (o script.google.com)
 * 2) Pegar este Code.gs
 * 3) Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone (or Anyone with link)
 * 4) Copiar URL del Web App y pegarla en la app (Refrescar).
 */

const SPREADSHEET_ID = '1PKBvMRZWZg-64OgQIvaqZHZO-b2wOQ50bG6yudOF3_Y';

// Nombres de hojas (ajustalos si difieren)
const SHEET_ARR = 'tams_arribos1';
const SHEET_DEP = 'tams_salidas1';

// Tokens en remarks que se deben omitir
const OMIT_TOKENS = ['CON', 'CAN', 'ALT'];

function doGet(e) {
  const action = (e.parameter.action || '').toLowerCase();
  const callback = (e.parameter.callback || '').trim();

  let payload;
  try {
    if (action === 'getdata') {
      payload = getData_();
    } else if (action === 'ping') {
      payload = { ok: true, ts: new Date().toISOString() };
    } else {
      payload = { ok: false, error: 'Acción inválida. Use action=getData' };
    }
  } catch (err) {
    payload = { ok: false, error: String(err) };
  }

  const out = ContentService.createTextOutput();
  if (callback) {
    // JSONP
    out.setContent(callback + '(' + JSON.stringify(payload) + ');');
    out.setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    out.setContent(JSON.stringify(payload));
    out.setMimeType(ContentService.MimeType.JSON);
  }
  return out;
}

function getData_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const arrSh = ss.getSheetByName(SHEET_ARR);
  const depSh = ss.getSheetByName(SHEET_DEP);
  if (!arrSh) throw new Error('No existe la hoja: ' + SHEET_ARR);
  if (!depSh) throw new Error('No existe la hoja: ' + SHEET_DEP);

  const arr = readArrivals_(arrSh);
  const dep = readDepartures_(depSh);

  return {
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    fetchedAt: new Date().toISOString(),
    arrivals: arr,
    departures: dep
  };
}

function readArrivals_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const range = sh.getRange(2, 1, lastRow - 1, Math.max(10, sh.getLastColumn()));
  const values = range.getValues();

  // Columns (1-based):
  // B=2 flight, D=4 reg, E=5 pos, F=6 arrAssigned, G=7 touchdown, I=9 origin, J=10 status
  const out = [];
  values.forEach(row => {
    if (rowIsOmitted_(row)) return;

    const flight = clean_(row[1]);
    const reg = clean_(row[3]);
    const pos = clean_(row[4]);

    const arrTime = clean_(row[5]);      // F
    const touchdownTime = clean_(row[6]); // G
    const origin = clean_(row[8]);       // I
    const status = clean_(row[9]);       // J

    // Regla: si F tiene '-' entonces no está asignada (arribo sin hora)
    // Mostrar avión en posición si hay hora (F o G). Preferir G si existe.
    const hasTime = (arrTime && arrTime !== '-') || (touchdownTime && touchdownTime !== '-');
    if (!reg || reg === '-') return;

    out.push({
      flight,
      reg,
      pos,
      arrTime: arrTime || '-',
      touchdownTime: touchdownTime || '-',
      origin: origin || '-',
      status: status || '-',
      hasTime: !!hasTime
    });
  });
  return out;
}

function readDepartures_(sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const range = sh.getRange(2, 1, lastRow - 1, Math.max(11, sh.getLastColumn()));
  const values = range.getValues();

  // Columns (1-based):
  // B=2 flight, C=3 depTime, D=4 reg, E=5 pos, F=6 updatedDepTime, G=7 takeoffTime, H=8 gate, I=9 dest, J=10 status
  const out = [];
  values.forEach(row => {
    if (rowIsOmitted_(row)) return;

    const flight = clean_(row[1]);
    const depTime = clean_(row[2]);           // C
    const reg = clean_(row[3]);               // D
    const pos = clean_(row[4]);               // E
    const updatedDepTime = clean_(row[5]);    // F (reemplaza C si existe)
    const takeoffTime = clean_(row[6]);       // G
    const gate = clean_(row[7]);              // H
    const dest = clean_(row[8]);              // I
    const status = clean_(row[9]);            // J

    if (!reg || reg === '-') return;

    out.push({
      flight,
      reg,
      pos,
      depTime: depTime || '-',
      updatedDepTime: updatedDepTime || '-',
      takeoffTime: takeoffTime || '-',
      gate: gate || '',
      dest: dest || '',
      status: status || '-'
    });
  });
  return out;
}

function rowIsOmitted_(row) {
  // Busca tokens en toda la fila (remarks suelen estar en columnas posteriores).
  const s = row.map(x => String(x || '').toUpperCase()).join(' | ');
  return OMIT_TOKENS.some(tok => s.includes(' ' + tok + ' ') || s.includes(tok + ' ') || s.includes(' ' + tok) || s.includes(tok + ';') || s.includes(tok + ','));
}

function clean_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  // Si viene como fecha/hora (Date), convertir a HH:MM
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  // Normalizar guiones tipo " - " o "-"
  if (s === '—') return '-';
  return s;
}
