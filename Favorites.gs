const SHEET_NAME = 'Favorites';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';

  if (action === 'list') {
    return jsonOutput_({
      ok: true,
      favorites: readFavorites_()
    });
  }

  return jsonOutput_({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = payload.action || '';

    if (action === 'save') {
      const favorite = payload.favorite || {};
      return jsonOutput_({ ok: true, favorite: upsertFavorite_(favorite) });
    }

    if (action === 'remove') {
      const symbol = String(payload.symbol || '').trim().toUpperCase();
      removeFavorite_(symbol);
      return jsonOutput_({ ok: true, symbol: symbol });
    }

    return jsonOutput_({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return jsonOutput_({ ok: false, error: String(error.message || error) });
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 7).setValues([[
      'Symbol',
      'Company',
      'ISIN',
      'Added At',
      'Reasons',
      'Notes',
      'Active'
    ]]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function readFavorites_() {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();

  if (values.length <= 1) return [];

  return values.slice(1)
    .filter(row => String(row[0] || '').trim())
    .map(row => ({
      symbol: String(row[0] || '').trim().toUpperCase(),
      company: String(row[1] || '').trim(),
      isin: String(row[2] || '').trim(),
      addedAt: row[3] instanceof Date ? row[3].toISOString() : String(row[3] || ''),
      reasons: parseReasons_(row[4]),
      notes: String(row[5] || '').trim(),
      active: String(row[6] || 'TRUE').toUpperCase() !== 'FALSE'
    }))
    .filter(item => item.active);
}

function upsertFavorite_(favorite) {
  const sheet = getSheet_();
  const symbol = String(favorite.symbol || '').trim().toUpperCase();
  if (!symbol) throw new Error('Symbol is required');

  const company = String(favorite.company || '').trim();
  const isin = String(favorite.isin || '').trim();
  const reasons = Array.isArray(favorite.reasons)
    ? favorite.reasons.map(String).map(s => s.trim()).filter(Boolean)
    : [];
  const notes = String(favorite.notes || '').trim();
  const rows = sheet.getDataRange().getValues();
  let rowNumber = -1;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toUpperCase() === symbol) {
      rowNumber = i + 1;
      break;
    }
  }

  const addedAt = rowNumber > 0 && rows[rowNumber - 1][3]
    ? rows[rowNumber - 1][3]
    : new Date();

  const row = [symbol, company, isin, addedAt, reasons.join(' | '), notes, true];

  if (rowNumber > 0) {
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return {
    symbol,
    company,
    isin,
    addedAt: addedAt instanceof Date ? addedAt.toISOString() : String(addedAt),
    reasons,
    notes,
    active: true
  };
}

function removeFavorite_(symbol) {
  if (!symbol) return;

  const sheet = getSheet_();
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toUpperCase() === symbol) {
      sheet.getRange(i + 1, 7).setValue(false);
      return;
    }
  }
}

function parseReasons_(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split('|')
    .map(s => s.trim())
    .filter(Boolean);
}

function jsonOutput_(object) {
  return ContentService
    .createTextOutput(JSON.stringify(object))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupFavoritesSheet() {
  const sheet = getSheet_();
  sheet.autoResizeColumns(1, 7);
  sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
}
