/**
 * History.gs — daily price snapshots.
 *
 * Historical GOOGLEFINANCE is unavailable to Apps Script, so the app cannot
 * backfill. Instead a daily trigger appends a row per ticker, and history
 * accumulates from the day setup() is run. Over a 5-year horizon that is fine,
 * but it does mean charts start empty rather than showing five years on day one.
 */

/** Append today's prices. Idempotent — re-running on the same day is a no-op. */
function snapshotDaily() {
  var positions = getPositions_();
  var watchlist = getWatchlist_();
  var tickers = positions.map(function (p) { return p.ticker; })
    .concat(watchlist.map(function (w) { return w.ticker; }));

  if (!tickers.length) {
    Logger.log('snapshotDaily: nothing to snapshot.');
    return 0;
  }

  var res = fetchQuotes_(tickers);
  var settings = getSettings_();
  var pf = computePortfolio_(positions, res.quotes, res.usdIls, 'USD');
  var totalUSD = pf.totals.marketValue;

  var today = todayKey_();
  var sh = getSpreadsheet_().getSheetByName(SHEETS.HISTORY);

  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      existing[dateKey_(r[0]) + '|' + String(r[1]).trim().toUpperCase()] = true;
    });
  }

  var rows = [];
  Object.keys(res.quotes).forEach(function (t) {
    var q = res.quotes[t];
    if (!isFiniteNumber_(q.price)) return;
    if (existing[today + '|' + t]) return;
    rows.push([today, t, q.price, totalUSD]);
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.HISTORY.length).setValues(rows);
  }

  Logger.log('snapshotDaily: wrote ' + rows.length + ' row(s) for ' + today +
             ' (skipped ' + (Object.keys(res.quotes).length - rows.length) + ').');
  return rows.length;
}

/** Most recent known price per ticker, used as the stale-data fallback. */
function getLastKnownPrices_(tickers) {
  var out = {};
  var sh = getSpreadsheet_().getSheetByName(SHEETS.HISTORY);
  if (!sh || sh.getLastRow() < 2) return out;

  var want = {};
  tickers.forEach(function (t) { want[t] = true; });

  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  // Walk backwards: the sheet is append-only, so the last match is the newest.
  for (var i = values.length - 1; i >= 0; i--) {
    var t = String(values[i][1]).trim().toUpperCase();
    if (!want[t] || out[t]) continue;
    var price = Number(values[i][2]);
    if (!isFinite(price)) continue;
    out[t] = { price: price, date: dateKey_(values[i][0]) };
  }
  return out;
}

/** Portfolio total value over time, for a future history chart. */
function getPortfolioHistory_() {
  var sh = getSpreadsheet_().getSheetByName(SHEETS.HISTORY);
  if (!sh || sh.getLastRow() < 2) return [];

  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  var byDate = {};
  values.forEach(function (r) {
    var d = dateKey_(r[0]);
    var total = Number(r[3]);
    if (isFinite(total)) byDate[d] = total;
  });
  return Object.keys(byDate).sort().map(function (d) {
    return { date: d, totalUSD: byDate[d] };
  });
}

/** Install the daily snapshot trigger. Run once; safe to re-run. */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'snapshotDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('snapshotDaily').timeBased().atHour(23).everyDays(1).create();
  Logger.log('Daily snapshot trigger installed for ~23:00 ' +
             Session.getScriptTimeZone() + '.');
}

function todayKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function dateKey_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).trim().slice(0, 10);
}
