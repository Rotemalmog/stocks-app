/**
 * Code.gs — web app entry point and the RPC surface the front-end calls.
 *
 * google.script.run costs roughly 1-3 seconds per round trip, so the UI makes
 * ONE call (getDashboardData) to render everything. Never one call per ticker.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Portfolio')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Used by index.html to inline styles.html and app.js.html. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ------------------------------------------------------------------ */
/* RPC                                                                  */
/* ------------------------------------------------------------------ */

/** Everything the UI needs, in a single round trip. */
function getDashboardData() {
  var started = new Date().getTime();

  var settings = getSettings_();
  var positions = getPositions_();
  var watchlist = getWatchlist_();

  var tickers = positions.map(function (p) { return p.ticker; })
    .concat(watchlist.map(function (w) { return w.ticker; }));

  var res = tickers.length ? fetchQuotes_(tickers) : { quotes: {}, usdIls: null };
  applyStaleFallback_(res.quotes);

  var pf = computePortfolio_(positions, res.quotes, res.usdIls, settings.displayCurrency);
  var wl = computeWatchlist_(watchlist, res.quotes, res.usdIls, settings.displayCurrency);
  var analytics = computeAnalytics_(pf.rows, settings);

  if (settings.displayCurrency === 'ILS' && !isFiniteNumber_(res.usdIls)) {
    analytics.warnings.unshift({
      level: 'danger',
      text: 'USD/ILS rate unavailable, so shekel values cannot be computed. ' +
            'Switch back to USD or retry.'
    });
  }

  return {
    positions: pf.rows,
    totals: pf.totals,
    watchlist: wl,
    analytics: analytics,
    settings: settings,
    usdIls: res.usdIls,
    riskTags: RISK_TAGS,
    fetchedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    elapsedMs: new Date().getTime() - started
  };
}

/**
 * Check a ticker before adding it. Coverage is unreliable for recent listings,
 * so the UI offers to add anyway rather than blocking.
 */
function validateTicker(input) {
  var ticker = normalizeTicker(input);
  if (!ticker) return { ticker: '', valid: false, reason: 'Enter a ticker or company name.' };
  if (!/^[A-Z0-9.\-:]{1,12}$/.test(ticker)) {
    return { ticker: ticker, valid: false, reason: 'That does not look like a ticker symbol.' };
  }

  var res = fetchQuotes_([ticker]);
  var q = res.quotes[ticker];
  if (!q || q.stale) {
    return {
      ticker: ticker, valid: false,
      reason: 'GOOGLEFINANCE has no price for ' + ticker + '. It may be a very recent ' +
              'listing or an unsupported exchange.'
    };
  }
  return {
    ticker: ticker,
    valid: true,
    name: q.name || ticker,
    price: q.price,
    suggestedRiskTag: SUGGESTED_RISK_TAG[ticker] || DEFAULT_RISK_TAG
  };
}

/**
 * Add to the portfolio or the watchlist.
 * @param {Object} p {list, ticker, shares, avgCost, costCurrency, riskTag,
 *                    notes, thesis, targetEntry, force}
 */
function addHolding(p) {
  p = p || {};
  var ticker = normalizeTicker(p.ticker);
  if (!ticker) throw new Error('Ticker is required.');

  var list = (p.list === 'positions') ? 'positions' : 'watchlist';

  if (!p.force) {
    var check = validateTicker(ticker);
    if (!check.valid) throw new Error(check.reason);
  }

  var existing = (list === 'positions')
    ? getPositions_().map(function (r) { return r.ticker; })
    : getWatchlist_().map(function (r) { return r.ticker; });
  if (existing.indexOf(ticker) !== -1) {
    throw new Error(ticker + ' is already in your ' +
      (list === 'positions' ? 'portfolio' : 'watchlist') + '.');
  }

  if (list === 'positions') {
    var shares = Number(p.shares);
    var avgCost = Number(p.avgCost);
    if (!isFinite(shares) || shares <= 0) throw new Error('Shares must be a positive number.');
    if (!isFinite(avgCost) || avgCost < 0) throw new Error('Average cost must be zero or more.');
    var tag = String(p.riskTag || '').toLowerCase();

    appendRow_(SHEETS.POSITIONS, HEADERS.POSITIONS, {
      ticker: ticker,
      shares: shares,
      avgCost: avgCost,
      costCurrency: String(p.costCurrency).toUpperCase() === 'ILS' ? 'ILS' : 'USD',
      buyDate: p.buyDate || todayKey_(),
      riskTag: RISK_TAGS[tag] ? tag : (SUGGESTED_RISK_TAG[ticker] || DEFAULT_RISK_TAG),
      notes: String(p.notes || '')
    });
  } else {
    appendRow_(SHEETS.WATCHLIST, HEADERS.WATCHLIST, {
      ticker: ticker,
      addedDate: todayKey_(),
      thesis: String(p.thesis || ''),
      targetEntry: isFinite(Number(p.targetEntry)) && p.targetEntry !== '' ? Number(p.targetEntry) : ''
    });
  }

  return getDashboardData();
}

function removeHolding(list, ticker) {
  var t = normalizeTicker(ticker);
  var tab = (list === 'positions') ? SHEETS.POSITIONS : SHEETS.WATCHLIST;
  if (!deleteByTicker_(tab, t)) throw new Error(t + ' was not found.');
  return getDashboardData();
}

/** Move a watchlist entry into the portfolio. */
function promoteToPortfolio(ticker, shares, avgCost, costCurrency, riskTag) {
  var t = normalizeTicker(ticker);
  var res = addHolding({
    list: 'positions', ticker: t, shares: shares, avgCost: avgCost,
    costCurrency: costCurrency, riskTag: riskTag, force: true
  });
  deleteByTicker_(SHEETS.WATCHLIST, t);
  return getDashboardData();
}

function updateSetting(key, value) {
  setSetting_(key, value);
  return getDashboardData();
}

/** Convenience for the editor: the URL of the backing spreadsheet. */
function getSpreadsheetUrl() {
  var url = getSpreadsheet_().getUrl();
  Logger.log(url);
  return url;
}
