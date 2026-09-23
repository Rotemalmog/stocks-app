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

  var closed = getClosedPositions_();
  var realised = totalRealised_();

  return {
    positions: pf.rows,
    totals: pf.totals,
    closedPositions: closed,
    realisedTotal: realised,
    transactions: getTransactions_().slice().reverse(),
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
    recordTransaction({
      ticker: ticker, type: TX_BUY, shares: p.shares, price: p.avgCost,
      currency: p.costCurrency, fees: p.fees, date: p.buyDate,
      riskTag: p.riskTag, notes: p.notes, force: true
    });
    return getDashboardData();
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


/**
 * Record a buy or sell.
 *
 * This is how the portfolio changes now - positions are derived from the
 * ledger rather than edited in place, so "buy more" is just another BUY and
 * the average cost recomputes itself.
 */
function recordTransaction(p) {
  p = p || {};
  var ticker = normalizeTicker(p.ticker);
  if (!ticker) throw new Error('Ticker is required.');

  var type = String(p.type || '').toUpperCase() === TX_SELL ? TX_SELL : TX_BUY;
  var shares = Number(p.shares);
  var price = Number(p.price);
  var fees = Number(p.fees) || 0;

  if (!isFinite(shares) || shares <= 0) throw new Error('Shares must be a positive number.');
  if (!isFinite(price) || price < 0) throw new Error('Price must be zero or more.');
  if (!isFinite(fees) || fees < 0) throw new Error('Fees cannot be negative.');

  if (type === TX_BUY && !p.force) {
    var check = validateTicker(ticker);
    if (!check.valid) throw new Error(check.reason);
  }

  if (type === TX_SELL) {
    var held = getPositions_().filter(function (x) { return x.ticker === ticker; })[0];
    if (!held) throw new Error('You do not hold ' + ticker + ', so there is nothing to sell.');
    if (shares > held.shares + 1e-9) {
      throw new Error('You hold ' + held.shares + ' ' + ticker +
                      ', so ' + shares + ' cannot be sold.');
    }
  }

  addTransaction_({
    date: p.date || todayKey_(),
    ticker: ticker,
    type: type,
    shares: shares,
    price: price,
    currency: String(p.currency).toUpperCase() === 'ILS' ? 'ILS' : 'USD',
    fees: fees,
    notes: String(p.notes || '')
  });

  // Keep the holding's metadata row in step, without clobbering existing notes.
  if (type === TX_BUY) {
    var meta = getHoldingMeta_();
    if (!meta[ticker]) {
      var tag = String(p.riskTag || '').toLowerCase();
      appendRow_(SHEETS.POSITIONS, HEADERS.POSITIONS, {
        ticker: ticker,
        riskTag: RISK_TAGS[tag] ? tag : (SUGGESTED_RISK_TAG[ticker] || DEFAULT_RISK_TAG),
        notes: String(p.notes || '')
      });
    }
  }

  return getDashboardData();
}

/** Remove a holding and its whole trade history. Destructive on purpose. */
function deleteHoldingHistory(ticker) {
  var t = normalizeTicker(ticker);
  var removed = 0;
  while (deleteByTicker_(SHEETS.TRANSACTIONS, t)) { removed++; }
  deleteByTicker_(SHEETS.POSITIONS, t);
  if (!removed) throw new Error('No transactions found for ' + t + '.');
  return getDashboardData();
}

function removeHolding(list, ticker) {
  var t = normalizeTicker(ticker);
  // A position is now the sum of its trades, so removing it means removing
  // them - deleting only the metadata row would leave the holding intact.
  if (list === 'positions') return deleteHoldingHistory(t);
  if (!deleteByTicker_(SHEETS.WATCHLIST, t)) throw new Error(t + ' was not found.');
  return getDashboardData();
}

/** Move a watchlist entry into the portfolio by recording the opening buy. */
function promoteToPortfolio(ticker, shares, price, currency, riskTag) {
  var t = normalizeTicker(ticker);
  recordTransaction({
    ticker: t, type: TX_BUY, shares: shares, price: price,
    currency: currency, riskTag: riskTag, force: true
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
