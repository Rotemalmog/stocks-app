/**
 * Strategy.gs — the 3-5 year stock scoring engine.
 *
 * The model is a multi-factor screen in the quality / financial-strength /
 * durable-growth / reasonable-valuation tradition (GARP-QARP), with a
 * supply-chain overlay. Rationale, sources and caveats live in the /stocks
 * skill; this file is the implementation.
 *
 * Two principles are load-bearing:
 *
 * 1. NO MOMENTUM. The momentum premium operates over 3-12 months and
 *    mean-reverts over multi-year horizons, so it is the wrong signal here.
 *
 * 2. COVERAGE IS REPORTED, NEVER HIDDEN. A score computed from 3 of 12
 *    metrics is not the same as one from 12 of 12. Missing data lowers the
 *    reported confidence; it never silently scores zero, which would make an
 *    under-covered company look bad rather than unknown.
 *
 * GOOGLEFINANCE carries no ROIC, margins, debt or growth history, so the
 * fundamentals come from Finnhub's free tier. Without an API key the app
 * still works — it just reports the fundamentals as unavailable.
 */

/* ------------------------------------------------------------------ */
/* Finnhub                                                              */
/* ------------------------------------------------------------------ */

function getFinnhubKey_() {
  return PropertiesService.getScriptProperties().getProperty(FINNHUB_PROP) || '';
}

/**
 * Store the Finnhub API key. Run once from the editor:
 *   setFinnhubKey('your_key_here')
 * Script Properties, never a cell and never git.
 */
function setFinnhubKey(key) {
  var k = String(key || '').trim();
  if (!k) throw new Error('Pass your Finnhub API key, e.g. setFinnhubKey("abc123")');
  PropertiesService.getScriptProperties().setProperty(FINNHUB_PROP, k);
  Logger.log('Finnhub key stored. Run testFinnhub() to verify it works.');
  return 'stored';
}

/** Verify the key and show what the API actually returns for one symbol. */
function testFinnhub() {
  if (!getFinnhubKey_()) return 'No key stored. Run setFinnhubKey("your_key") first.';
  var m = fetchMetrics_('INTC');
  if (!m.ok) return 'FAILED: ' + m.error;

  var found = [];
  var missing = [];
  Object.keys(METRIC_BANDS).forEach(function (name) {
    var v = m.metrics[METRIC_BANDS[name].field];
    if (isFiniteNumber_(v)) found.push(name + '=' + v);
    else missing.push(name);
  });

  var out = 'Finnhub OK for INTC.\nAvailable: ' + (found.join(', ') || 'none') +
            '\nMissing: ' + (missing.join(', ') || 'none');
  Logger.log(out);
  return out;
}

/**
 * Fetch Finnhub basic financials for one symbol.
 * @return {{ok: boolean, metrics: Object, error: string}}
 */
function fetchMetrics_(ticker) {
  var key = getFinnhubKey_();
  if (!key) return { ok: false, metrics: {}, error: 'no_api_key' };

  var url = FINNHUB_BASE + '/stock/metric?symbol=' + encodeURIComponent(ticker) +
            '&metric=all&token=' + encodeURIComponent(key);
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = res.getResponseCode();
    if (code === 429) return { ok: false, metrics: {}, error: 'rate_limited' };
    if (code !== 200) return { ok: false, metrics: {}, error: 'http_' + code };

    var body = JSON.parse(res.getContentText());
    var metrics = (body && body.metric) ? body.metric : null;
    if (!metrics) return { ok: false, metrics: {}, error: 'no_data' };
    return { ok: true, metrics: metrics, error: '' };
  } catch (e) {
    return { ok: false, metrics: {}, error: String(e.message || e) };
  }
}

/**
 * Fetch fundamentals for several tickers.
 * Free tier allows 60 calls/minute; a short pause keeps us clear of it, and
 * the whole batch stays well inside the 6-minute execution limit for the
 * portfolio-sized lists this app deals with.
 */
function fetchAllMetrics_(tickers) {
  var out = {};
  tickers.forEach(function (t, i) {
    if (i > 0) Utilities.sleep(1100);
    out[t] = fetchMetrics_(t);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                              */
/* ------------------------------------------------------------------ */

/**
 * Score one metric against its bands.
 * @return {number|null} 0-100, or null when the value is unavailable
 */
function scoreMetric_(value, spec) {
  if (!isFiniteNumber_(value)) return null;
  var b = spec.bands;

  if (spec.higherBetter) {
    if (value >= b[0]) return 100;
    if (value >= b[1]) return 75;
    if (value >= b[2]) return 50;
    return 25;
  }
  // Lower is better. A non-positive P/E or P/FCF means no earnings or no free
  // cash flow - that is a real negative for a 5-year hold, not a bargain, so
  // it scores at the floor rather than off the top of the scale.
  if (value <= 0) return 0;
  if (value <= b[0]) return 100;
  if (value <= b[1]) return 75;
  if (value <= b[2]) return 50;
  return 25;
}

/**
 * Score a single stock.
 * @return {Object} total, pillars, coverage, details, flags
 */
function scoreStock_(ticker, metrics) {
  var details = [];
  var pillars = {};
  var availableCount = 0;
  var totalCount = 0;

  Object.keys(PILLAR_METRICS).forEach(function (pillar) {
    var names = PILLAR_METRICS[pillar];
    var scores = [];

    names.forEach(function (name) {
      var spec = METRIC_BANDS[name];
      var raw = metrics ? metrics[spec.field] : null;
      var sc = scoreMetric_(raw, spec);
      totalCount++;
      if (sc !== null) { availableCount++; scores.push(sc); }
      details.push({
        pillar: pillar,
        name: name,
        label: spec.label,
        raw: isFiniteNumber_(raw) ? raw : null,
        score: sc
      });
    });

    pillars[pillar] = scores.length
      ? scores.reduce(function (a, s) { return a + s; }, 0) / scores.length
      : null;
  });

  // Resilience comes from the local Taiwan map, so it is always available.
  var exposure = TAIWAN_EXPOSURE[ticker] || 'unknown';
  pillars.resilience = RESILIENCE_SCORE[exposure];
  details.push({
    pillar: 'resilience',
    name: 'taiwan',
    label: 'Supply-chain exposure',
    raw: TAIWAN_LABELS[exposure] || exposure,
    score: pillars.resilience
  });

  // Re-weight across only the pillars we could actually score, so a missing
  // pillar does not silently drag the total toward zero.
  var weightUsed = 0;
  var weighted = 0;
  Object.keys(STRATEGY_WEIGHTS).forEach(function (p) {
    if (pillars[p] === null || pillars[p] === undefined) return;
    weighted += pillars[p] * STRATEGY_WEIGHTS[p];
    weightUsed += STRATEGY_WEIGHTS[p];
  });

  var coverage = totalCount ? availableCount / totalCount : 0;
  var total = weightUsed > 0 ? weighted / weightUsed : null;
  var gate = profitabilityGate_(metrics, total);

  return {
    ticker: ticker,
    total: gate.total,
    gated: gate.applied,
    gateReason: gate.reason,
    pillars: pillars,
    coverage: coverage,
    lowConfidence: coverage < MIN_COVERAGE,
    metricsAvailable: availableCount,
    metricsTotal: totalCount,
    details: details,
    flags: buildStockFlags_(ticker, metrics, pillars)
  };
}

/**
 * Cap the score of a company that does not yet make money.
 *
 * Without this, a cash-burning pre-revenue company games two pillars at once:
 * financial strength looks excellent (no debt, huge current ratio - because it
 * just raised money, not because the business generates cash) and growth looks
 * spectacular (large percentages off a tiny base). Unprofitability then only
 * penalises the valuation pillar, and such a company can out-rank a profitable
 * one. At a 3-5 year horizon that inverts the question the screen exists to
 * ask, so profitability acts as a gate rather than one input among twelve.
 *
 * The cap is not a verdict on the company - speculative names can be excellent
 * investments. It says the multi-factor score is not the right tool for judging
 * them, because every factor it measures assumes an operating business.
 */
function profitabilityGate_(metrics, total) {
  if (total === null || !metrics) return { total: total, applied: false, reason: '' };

  var net = metrics[METRIC_BANDS.netMargin.field];
  var op = metrics[METRIC_BANDS.operatingMargin.field];
  var bothNegative = isFiniteNumber_(net) && net < 0 && isFiniteNumber_(op) && op < 0;
  if (!bothNegative) return { total: total, applied: false, reason: '' };

  var CAP = 50;
  if (total <= CAP) return { total: total, applied: false, reason: '' };

  return {
    total: CAP,
    applied: true,
    reason: 'Score capped at ' + CAP + ' (uncapped ' + Math.round(total) + '): both ' +
            'operating and net margin are negative. A pre-profit company scores well ' +
            'on debt and growth ratios for reasons that do not mean what they mean ' +
            'for an operating business.'
  };
}

/** Plain-language observations that a number alone does not convey. */
function buildStockFlags_(ticker, metrics, pillars) {
  var flags = [];
  if (!metrics) return flags;

  var net = metrics[METRIC_BANDS.netMargin.field];
  var op = metrics[METRIC_BANDS.operatingMargin.field];
  if (isFiniteNumber_(net) && net < 0 && isFiniteNumber_(op) && op < 0) {
    flags.push({
      level: 'warn',
      text: 'Not profitable at either the operating or net line, so the score is ' +
            'capped. Judge this one on runway, funding and milestones, not on a ' +
            'quality screen built for operating businesses.'
    });
  }

  var pe = metrics[METRIC_BANDS.pe.field];
  if (isFiniteNumber_(pe) && pe < 0) {
    flags.push({
      level: 'warn',
      text: 'Negative P/E — the company is not profitable. At a 5-year horizon ' +
            'this shifts the question from valuation to survivability.'
    });
  }

  var de = metrics[METRIC_BANDS.debtToEquity.field];
  if (isFiniteNumber_(de) && de > 2) {
    flags.push({
      level: 'warn',
      text: 'Debt/equity above 2 — leverage this high narrows the margin for ' +
            'error if demand softens.'
    });
  }

  var r3 = metrics[METRIC_BANDS.revGrowth3Y.field];
  var r5 = metrics[METRIC_BANDS.revGrowth5Y.field];
  if (isFiniteNumber_(r3) && isFiniteNumber_(r5) && r5 > 0 && r3 < r5 * 0.5) {
    flags.push({
      level: 'info',
      text: 'Three-year revenue growth is well below the five-year rate — ' +
            'growth is decelerating, so check whether the original thesis still holds.'
    });
  }

  if (pillars.quality !== null && pillars.valuation !== null &&
      pillars.quality >= 75 && pillars.valuation <= 40) {
    flags.push({
      level: 'info',
      text: 'Strong business, demanding price. The usual GARP question: is the ' +
            'quality worth the multiple, or is this a good company at a bad entry?'
    });
  }

  return flags;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                          */
/* ------------------------------------------------------------------ */

/**
 * Score every holding and watchlist name.
 * Called from the UI; safe to run with no API key (returns needsKey).
 */
function getStrategyData() {
  var started = new Date().getTime();
  var positions = getPositions_();
  var watchlist = getWatchlist_();

  var tickers = [];
  var seen = {};
  positions.concat(watchlist).forEach(function (r) {
    if (!seen[r.ticker]) { seen[r.ticker] = true; tickers.push(r.ticker); }
  });

  if (!tickers.length) {
    return { needsKey: !getFinnhubKey_(), empty: true, rows: [], weights: STRATEGY_WEIGHTS };
  }

  if (!getFinnhubKey_()) {
    return {
      needsKey: true,
      empty: false,
      rows: [],
      weights: STRATEGY_WEIGHTS,
      tickerCount: tickers.length
    };
  }

  var fetched = fetchAllMetrics_(tickers);
  var held = {};
  positions.forEach(function (p) { held[p.ticker] = true; });

  var rows = tickers.map(function (t) {
    var f = fetched[t];
    var scored = scoreStock_(t, f.ok ? f.metrics : null);
    scored.held = !!held[t];
    scored.fetchError = f.ok ? '' : f.error;
    return scored;
  });

  rows.sort(function (a, b) {
    if (a.total === null) return 1;
    if (b.total === null) return -1;
    return b.total - a.total;
  });

  return {
    needsKey: false,
    empty: false,
    rows: rows,
    weights: STRATEGY_WEIGHTS,
    minCoverage: MIN_COVERAGE,
    fetchedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    elapsedMs: new Date().getTime() - started
  };
}
