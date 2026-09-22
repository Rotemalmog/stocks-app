/**
 * Sheet.gs — the Google Sheet acting as the database.
 *
 * Every write goes through here so the app survives a browser refresh and is
 * readable from any device. Nothing is stored browser-side (localStorage is
 * unreliable inside the Apps Script sandbox iframe).
 */

var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';

/**
 * One-time setup. Run this once from the Apps Script editor.
 * Creates the backing spreadsheet, all tabs, and seeds the watchlist.
 * Safe to re-run: existing tabs and data are left alone.
 * @return {string} the spreadsheet URL
 */
function setup() {
  var ss = getSpreadsheet_();
  ensureTab_(ss, SHEETS.POSITIONS, HEADERS.POSITIONS);
  ensureTab_(ss, SHEETS.WATCHLIST, HEADERS.WATCHLIST);
  ensureTab_(ss, SHEETS.HISTORY,   HEADERS.HISTORY);
  ensureTab_(ss, SHEETS.SETTINGS,  HEADERS.SETTINGS);

  var quotes = ensureTab_(ss, SHEETS.QUOTES, ['ticker'].concat(QUOTE_ATTRS));
  quotes.hideSheet();

  seedSettings_(ss);
  seedWatchlist_(ss);

  // Remove the default empty "Sheet1" a new spreadsheet ships with.
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  var url = ss.getUrl();
  Logger.log('Spreadsheet ready: ' + url);
  return url;
}

/** Resolve the backing spreadsheet, creating it on first run. */
function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_SPREADSHEET_ID);

  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('Stored SPREADSHEET_ID ' + id + ' could not be opened. ' +
                      'Clear the script property and re-run setup(). Cause: ' + e.message);
    }
  }

  // Container-bound? Use the host spreadsheet.
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { /* standalone */ }
  if (active) {
    props.setProperty(PROP_SPREADSHEET_ID, active.getId());
    return active;
  }

  var created = SpreadsheetApp.create('Stocks Portfolio DB');
  props.setProperty(PROP_SPREADSHEET_ID, created.getId());
  return created;
}

function ensureTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function seedSettings_(ss) {
  var sh = ss.getSheetByName(SHEETS.SETTINGS);
  if (sh.getLastRow() > 1) return;
  var rows = Object.keys(DEFAULT_SETTINGS).map(function (k) {
    return [k, DEFAULT_SETTINGS[k]];
  });
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
}

function seedWatchlist_(ss) {
  var sh = ss.getSheetByName(SHEETS.WATCHLIST);
  if (sh.getLastRow() > 1) return;
  var today = new Date();
  var rows = SEED_WATCHLIST.map(function (t) { return [t, today, '', '']; });
  sh.getRange(2, 1, rows.length, HEADERS.WATCHLIST.length).setValues(rows);
}

/* ------------------------------------------------------------------ */
/* Generic row access                                                   */
/* ------------------------------------------------------------------ */

/** Read a tab as an array of objects keyed by its header row. */
function readRows_(tabName) {
  var sh = getSpreadsheet_().getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return [];
  var width = sh.getLastColumn();
  var values = sh.getRange(1, 1, sh.getLastRow(), width).getValues();
  var headers = values[0];

  return values.slice(1)
    .filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) {
      var o = {};
      headers.forEach(function (h, i) { o[String(h)] = r[i]; });
      return o;
    });
}

function appendRow_(tabName, headers, obj) {
  var sh = getSpreadsheet_().getSheetByName(tabName);
  var row = headers.map(function (h) {
    return obj[h] === undefined || obj[h] === null ? '' : obj[h];
  });
  sh.appendRow(row);
}

/** Delete the first row whose ticker matches. Returns true if one was removed. */
function deleteByTicker_(tabName, ticker) {
  var sh = getSpreadsheet_().getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return false;
  var col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim().toUpperCase() === ticker) {
      sh.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Typed accessors                                                      */
/* ------------------------------------------------------------------ */

function getPositions_() {
  return readRows_(SHEETS.POSITIONS).map(function (r) {
    var tag = String(r.riskTag || '').trim().toLowerCase();
    return {
      ticker: String(r.ticker).trim().toUpperCase(),
      shares: Number(r.shares) || 0,
      avgCost: Number(r.avgCost) || 0,
      costCurrency: (String(r.costCurrency || 'USD').trim().toUpperCase() === 'ILS') ? 'ILS' : 'USD',
      buyDate: r.buyDate instanceof Date ? r.buyDate.toISOString().slice(0, 10) : String(r.buyDate || ''),
      riskTag: RISK_TAGS[tag] ? tag : DEFAULT_RISK_TAG,
      notes: String(r.notes || '')
    };
  });
}

function getWatchlist_() {
  return readRows_(SHEETS.WATCHLIST).map(function (r) {
    return {
      ticker: String(r.ticker).trim().toUpperCase(),
      addedDate: r.addedDate instanceof Date ? r.addedDate.toISOString().slice(0, 10) : String(r.addedDate || ''),
      thesis: String(r.thesis || ''),
      targetEntry: r.targetEntry === '' || r.targetEntry === null ? null : Number(r.targetEntry)
    };
  });
}

function getSettings_() {
  var out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = DEFAULT_SETTINGS[k]; });
  readRows_(SHEETS.SETTINGS).forEach(function (r) {
    var k = String(r.key).trim();
    if (!(k in out)) return;
    var v = r.value;
    out[k] = (typeof DEFAULT_SETTINGS[k] === 'number') ? Number(v) : String(v);
  });
  if (out.displayCurrency !== 'ILS') out.displayCurrency = 'USD';
  return out;
}

function setSetting_(key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error('Unknown setting: ' + key);
  var sh = getSpreadsheet_().getSheetByName(SHEETS.SETTINGS);
  var last = sh.getLastRow();
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sh.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sh.appendRow([key, value]);
}
