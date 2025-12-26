/**
 * Apps Script backend (simple) - guarda/lee estado JSON.
 * Deploy as Web App (Execute as: Me, Access: Anyone with link)
 *
 * Setup:
 * 1) Create Spreadsheet, sheet named "DATA"
 * 2) Put in A1: key, B1: value
 * 3) Use key "state" and store JSON in value column.
 */
const SHEET_ID = 'PUT_YOUR_SHEET_ID_HERE';
const SHEET_NAME = 'DATA';
const KEY = 'state';

function doGet(e){
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const data = sh.getDataRange().getValues();
  let val = null;
  for (let i=1;i<data.length;i++){
    if (data[i][0]===KEY){ val = data[i][1]; break; }
  }
  return ContentService.createTextOutput(val || '{}')
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e){
  const body = e.postData && e.postData.contents ? e.postData.contents : '{}';
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const data = sh.getDataRange().getValues();
  let row = -1;
  for (let i=1;i<data.length;i++){
    if (data[i][0]===KEY){ row = i+1; break; }
  }
  if (row===-1){
    sh.appendRow([KEY, body]);
  } else {
    sh.getRange(row,2).setValue(body);
  }
  return ContentService.createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}
