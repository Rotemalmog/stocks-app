/**
 * Quotes.gs — the GOOGLEFINANCE bridge.
 *
 * GOOGLEFINANCE is a spreadsheet formula, not an API, so the only way to read
 * it from script is: write formulas into cells, flush, read the computed
 * values back. flush() is the expensive call, so the entire ticker x attribute
 * grid is written and flushed EXACTLY ONCE per refresh.
 *
 * Note: historical GOOGLEFINANCE (the date-argument form) has been blocked
 * from Apps Script and the Sheets API since 2016 and returns #N/A. That is why
 * History.gs accumulates its own daily snapshots instead.
 */

var FX_PSEUDO_TICKER = 'CURRENCY:USDILS';

/** Resolve a friendly name or messy input to a ticker symbol. */
function normalizeTicker(input) {
  var raw = String(input || '').trim();
  if (!raw) return '';
  var alias = TICKER_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  return raw.toUpperCase().replace(/\s+/g, '');
}

/**
 * Fetch live quotes for a list of tickers.
 * @param {string[]} tickers
 * @return {{quotes: Object, usdIls: (number|null)}} quotes keyed by ticker;
 *   each has the QUOTE_ATTRS fields plus `stale` (true when GOOGLEFINANCE
 *   returned nothing usable for it).
 */
function fetchQuotes_(tickers) {
  var unique = [];
  var seen = {};
  (tickers || []).forEach(function (t) {
    var n = normalizeTicker(t);
    if (n && !seen[n]) { seen[n] = true; unique.push(n); }
  });

  var rows = unique.concat([FX_PSEUDO_TICKER]);
  var sh = getSpreadsheet_().getSheetByName(SHEETS.QUOTES);
  if (!sh) throw new Error('Missing ' + SHEETS.QUOTES + ' tab. Run setup() first.');

  // Clear previous run so a shrinking ticker list leaves no stale rows behind.
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  }

  var tickerCol = rows.map(function (t) { return [t]; });
  var formulas = rows.map(function (_, i) {
    var row = i + 2;
    return QUOTE_ATTRS.map(function (attr) {
      return '=IFERROR(GOOGLEFINANCE($A' + row + ',"' + attr + '"),"")';
    });
  });

  sh.getRange(2, 1, rows.length, 1).setValues(tickerCol);
  sh.getRange(2, 2, rows.length, QUOTE_ATTRS.length).setFormulas(formulas);
  SpreadsheetApp.flush();
  var values = sh.getRange(2, 2, rows.length, QUOTE_ATTRS.length).getValues();

  var quotes = {};
  var usdIls = null;

  rows.forEach(function (ticker, i) {
    var rec = { ticker: ticker };
    QUOTE_ATTRS.forEach(function (attr, j) {
      rec[attr] = cleanCell_(values[i][j]);
    });
    rec.stale = !isFiniteNumber_(rec.price);

    if (ticker === FX_PSEUDO_TICKER) {
      usdIls = isFiniteNumber_(rec.price) ? rec.price : null;
    } else {
      quotes[ticker] = rec;
    }
  });

  return { quotes: quotes, usdIls: usdIls };
}

/**
 * Fill in last-known prices from History for anything GOOGLEFINANCE could not
 * serve, so one bad ticker never blanks the dashboard.
 */
function applyStaleFallback_(quotes) {
  var missing = Object.keys(quotes).filter(function (t) { return quotes[t].stale; });
  if (!missing.length) return quotes;

  var last = getLastKnownPrices_(missing);
  missing.forEach(function (t) {
    if (isFiniteNumber_(last[t] && last[t].price)) {
      quotes[t].price = last[t].price;
      quotes[t].fallbackDate = last[t].date;
    }
  });
  return quotes;
}

function cleanCell_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'string') {
    var s = v.trim();
    if (s === '' || s.charAt(0) === '#') return null;
    var n = Number(s);
    return isNaN(n) ? s : n;
  }
  return v;
}

function isFiniteNumber_(v) {
  return typeof v === 'number' && isFinite(v) && !isNaN(v);
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                          */
/* ------------------------------------------------------------------ */

/**
 * Step 0 coverage probe. Run from the editor before trusting any ticker.
 * Confirms which symbols GOOGLEFINANCE actually serves — SPCX in particular,
 * which listed in June 2026 and may not be covered yet.
 */
function probeCoverage() {
  var probe = ['INTC', 'GOOGL', 'TSLA', 'SPCX', 'QBTS', 'ZZZZ'];
  var res = fetchQuotes_(probe);
  var lines = ['--- GOOGLEFINANCE coverage probe ---'];

  probe.forEach(function (t) {
    var q = res.quotes[t];
    lines.push(
      t + ': ' +
      (q && !q.stale
        ? 'OK  price=' + q.price + '  pe=' + (q.pe === null ? 'n/a' : q.pe) + '  name=' + (q.name || 'n/a')
        : 'NOT COVERED (#N/A)')
    );
  });
  lines.push('USD/ILS: ' + (res.usdIls === null ? 'NOT COVERED' : res.usdIls));
  lines.push('ZZZZ is expected to fail — it verifies the stale-data path.');

  var out = lines.join('\n');
  Logger.log(out);
  return out;
}

/**
 * Confirms that historical GOOGLEFINANCE really is blocked from Apps Script.
 * Expected result: #N/A. Documents why History.gs exists.
 */
function probeHistoricalBlocked() {
  var sh = getSpreadsheet_().getSheetByName(SHEETS.QUOTES);
  var cell = sh.getRange(1, QUOTE_ATTRS.length + 3);
  cell.setFormula('=GOOGLEFINANCE("INTC","price",DATE(2025,1,1))');
  SpreadsheetApp.flush();
  var v = cell.getValue();
  cell.clearContent();
  var out = 'Historical read returned: ' + JSON.stringify(v) +
            (String(v).charAt(0) === '#' ? '  (blocked, as expected)' : '  (unexpectedly available!)');
  Logger.log(out);
  return out;
}
