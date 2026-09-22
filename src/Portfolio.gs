/**
 * Portfolio.gs — position valuation, P&L and weights.
 *
 * All arithmetic is done in USD internally; conversion to the display
 * currency happens once, at the end. Cost basis entered in ILS is never
 * overwritten — it is converted on read only.
 */

/**
 * @param {Array} positions from getPositions_()
 * @param {Object} quotes keyed by ticker
 * @param {number|null} usdIls
 * @param {string} displayCurrency 'USD' | 'ILS'
 */
function computePortfolio_(positions, quotes, usdIls, displayCurrency) {
  var toDisplay = displayRate_(usdIls, displayCurrency);

  var rows = positions.map(function (p) {
    var q = quotes[p.ticker] || { stale: true };
    var price = isFiniteNumber_(q.price) ? q.price : null;

    var marketValueUSD = price === null ? null : p.shares * price;
    var costBasisUSD = p.costCurrency === 'ILS'
      ? (usdIls ? (p.shares * p.avgCost) / usdIls : null)
      : p.shares * p.avgCost;

    var pnlUSD = (marketValueUSD === null || costBasisUSD === null)
      ? null : marketValueUSD - costBasisUSD;
    var pnlPct = (pnlUSD === null || !costBasisUSD) ? null : pnlUSD / costBasisUSD;

    return {
      ticker: p.ticker,
      name: q.name || p.ticker,
      shares: p.shares,
      avgCost: p.avgCost,
      costCurrency: p.costCurrency,
      buyDate: p.buyDate,
      riskTag: p.riskTag,
      riskLabel: RISK_TAGS[p.riskTag].label,
      notes: p.notes,
      price: price,
      changePct: isFiniteNumber_(q.changepct) ? q.changepct / 100 : null,
      pe: isFiniteNumber_(q.pe) ? q.pe : null,
      eps: isFiniteNumber_(q.eps) ? q.eps : null,
      marketCap: isFiniteNumber_(q.marketcap) ? q.marketcap : null,
      beta: isFiniteNumber_(q.beta) ? q.beta : null,
      high52: isFiniteNumber_(q.high52) ? q.high52 : null,
      low52: isFiniteNumber_(q.low52) ? q.low52 : null,
      theme: themeOf_(p.ticker),
      taiwan: TAIWAN_EXPOSURE[p.ticker] || 'unknown',
      stale: q.stale === true,
      fallbackDate: q.fallbackDate || null,
      marketValueUSD: marketValueUSD,
      costBasisUSD: costBasisUSD,
      pnlUSD: pnlUSD,
      pnlPct: pnlPct,
      marketValue: scale_(marketValueUSD, toDisplay),
      costBasis: scale_(costBasisUSD, toDisplay),
      pnl: scale_(pnlUSD, toDisplay)
    };
  });

  var totalMV = sum_(rows, 'marketValueUSD');
  var totalCost = sum_(rows, 'costBasisUSD');

  rows.forEach(function (r) {
    r.weight = (totalMV > 0 && r.marketValueUSD !== null) ? r.marketValueUSD / totalMV : 0;
  });

  rows.sort(function (a, b) { return b.weight - a.weight; });

  var dayChangeUSD = rows.reduce(function (acc, r) {
    if (r.marketValueUSD === null || r.changePct === null) return acc;
    var prev = r.marketValueUSD / (1 + r.changePct);
    return acc + (r.marketValueUSD - prev);
  }, 0);

  return {
    rows: rows,
    totals: {
      marketValue: scale_(totalMV, toDisplay),
      costBasis: scale_(totalCost, toDisplay),
      pnl: scale_(totalMV - totalCost, toDisplay),
      pnlPct: totalCost > 0 ? (totalMV - totalCost) / totalCost : null,
      dayChange: scale_(dayChangeUSD, toDisplay),
      dayChangePct: totalMV > 0 ? dayChangeUSD / (totalMV - dayChangeUSD) : null,
      currency: displayCurrency,
      positionCount: rows.length
    }
  };
}

/** Watchlist rows enriched with live quote data. */
function computeWatchlist_(watchlist, quotes, usdIls, displayCurrency) {
  var toDisplay = displayRate_(usdIls, displayCurrency);

  return watchlist.map(function (w) {
    var q = quotes[w.ticker] || { stale: true };
    var price = isFiniteNumber_(q.price) ? q.price : null;
    var hi = isFiniteNumber_(q.high52) ? q.high52 : null;
    var lo = isFiniteNumber_(q.low52) ? q.low52 : null;

    // Where the price sits in its 52-week band, 0 = at the low, 1 = at the high.
    var range52 = (price !== null && hi !== null && lo !== null && hi > lo)
      ? (price - lo) / (hi - lo) : null;

    return {
      ticker: w.ticker,
      name: q.name || w.ticker,
      addedDate: w.addedDate,
      thesis: w.thesis,
      targetEntry: w.targetEntry,
      price: price,
      priceDisplay: scale_(price, toDisplay),
      changePct: isFiniteNumber_(q.changepct) ? q.changepct / 100 : null,
      pe: isFiniteNumber_(q.pe) ? q.pe : null,
      marketCap: isFiniteNumber_(q.marketcap) ? q.marketcap : null,
      high52: hi,
      low52: lo,
      range52: range52,
      toTarget: (price !== null && isFiniteNumber_(w.targetEntry) && w.targetEntry > 0)
        ? (price - w.targetEntry) / w.targetEntry : null,
      theme: themeOf_(w.ticker),
      taiwan: TAIWAN_EXPOSURE[w.ticker] || 'unknown',
      stale: q.stale === true
    };
  });
}

function themeOf_(ticker) {
  var found = 'Other';
  Object.keys(THEMES).some(function (theme) {
    if (THEMES[theme].indexOf(ticker) !== -1) { found = theme; return true; }
    return false;
  });
  return found;
}

function displayRate_(usdIls, displayCurrency) {
  if (displayCurrency !== 'ILS') return 1;
  return isFiniteNumber_(usdIls) ? usdIls : null;
}

function scale_(v, rate) {
  if (v === null || v === undefined || rate === null) return null;
  return v * rate;
}

function sum_(rows, key) {
  return rows.reduce(function (a, r) { return a + (r[key] || 0); }, 0);
}
