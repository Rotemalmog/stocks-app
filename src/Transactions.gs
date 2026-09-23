/**
 * Transactions.gs — the buy/sell ledger, and positions derived from it.
 *
 * Previously a position was a single row carrying `shares` and `avgCost`,
 * which the user maintained by hand. Buying more of something meant
 * recomputing a weighted average manually — arithmetic that silently corrupts
 * a portfolio record over a five-year horizon, and which makes realised P&L
 * and holding period impossible to know.
 *
 * Now every buy and sell is a row, and the position is DERIVED. The `Positions`
 * tab keeps only the things that are properties of the holding rather than of
 * a trade: risk tag and notes.
 *
 * Cost basis uses the **weighted average** method: on a sale, the realised gain
 * is measured against the running average cost, and the remaining basis is
 * reduced proportionally. This is the simplest defensible convention and
 * matches how the app behaved before. It is NOT necessarily what a tax
 * authority requires — Israel generally expects FIFO for securities — so do
 * not use these realised figures for a tax return without checking.
 */

var TX_BUY = 'BUY';
var TX_SELL = 'SELL';
var MIGRATION_PROP = 'TX_MIGRATION_DONE';

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

function getTransactions_() {
  return readRows_(SHEETS.TRANSACTIONS).map(function (r) {
    var type = String(r.type || '').trim().toUpperCase();
    return {
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date || ''),
      ticker: String(r.ticker).trim().toUpperCase(),
      type: type === TX_SELL ? TX_SELL : TX_BUY,
      shares: Number(r.shares) || 0,
      price: Number(r.price) || 0,
      currency: (String(r.currency || 'USD').trim().toUpperCase() === 'ILS') ? 'ILS' : 'USD',
      fees: Number(r.fees) || 0,
      notes: String(r.notes || '')
    };
  }).filter(function (t) {
    return t.ticker && t.shares > 0;
  }).sort(function (a, b) {
    return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
  });
}

/** Per-holding metadata that is not a property of any single trade. */
function getHoldingMeta_() {
  var out = {};
  readRows_(SHEETS.POSITIONS).forEach(function (r) {
    var t = String(r.ticker).trim().toUpperCase();
    if (!t) return;
    var tag = String(r.riskTag || '').trim().toLowerCase();
    out[t] = {
      riskTag: RISK_TAGS[tag] ? tag : (SUGGESTED_RISK_TAG[t] || DEFAULT_RISK_TAG),
      notes: String(r.notes || '')
    };
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Derivation                                                           */
/* ------------------------------------------------------------------ */

/**
 * Fold the ledger into per-ticker state.
 *
 * This is the single implementation of the cost-basis arithmetic. Both open
 * positions and closed ones read from it — an earlier version had two copies
 * of this loop, which is exactly the kind of duplication that lets a fix land
 * in one place and not the other.
 *
 * @return {Object} ticker -> {shares, costBasis, realised, ...}
 */
function foldTransactions_(transactions) {
  var byTicker = {};

  (transactions || []).slice().sort(function (a, b) {
    return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
  }).forEach(function (t) {
    var p = byTicker[t.ticker];
    if (!p) {
      p = byTicker[t.ticker] = {
        ticker: t.ticker, shares: 0, costBasis: 0, costCurrency: t.currency,
        realised: 0, firstBuy: '', lastActivity: '', txCount: 0,
        mixedCurrency: false, oversold: false
      };
    }

    // Mixing currencies within one holding makes a single average cost
    // meaningless; flag it rather than silently producing a wrong number.
    if (t.currency !== p.costCurrency) p.mixedCurrency = true;

    p.txCount++;
    p.lastActivity = t.date;

    if (t.type === TX_BUY) {
      if (!p.firstBuy) p.firstBuy = t.date;
      p.shares += t.shares;
      p.costBasis += t.shares * t.price + t.fees;
      return;
    }

    // SELL. Never sell more than is held: a negative share count would
    // poison every downstream figure, so the excess is clamped and flagged.
    var avg = p.shares > 0 ? p.costBasis / p.shares : 0;
    var sold = Math.min(t.shares, p.shares);
    if (t.shares > p.shares + 1e-9) p.oversold = true;

    p.realised += sold * (t.price - avg) - t.fees;
    p.costBasis -= sold * avg;
    p.shares -= sold;
    if (p.shares <= 1e-9) { p.shares = 0; p.costBasis = 0; }
  });

  return byTicker;
}

/**
 * Current open positions, derived from the ledger.
 *
 * Returns the SAME shape as the old stored-position row, so Portfolio.gs and
 * Analytics.gs consume it unchanged — plus realised P&L and first-buy date,
 * which were previously unknowable.
 */
function derivePositions_(transactions, meta) {
  var folded = foldTransactions_(transactions || getTransactions_());
  var info = meta || getHoldingMeta_();

  return Object.keys(folded).map(function (t) {
    var p = folded[t];
    var m = info[t] || {};
    return {
      ticker: t,
      shares: p.shares,
      avgCost: p.shares > 0 ? p.costBasis / p.shares : 0,
      costCurrency: p.costCurrency,
      buyDate: p.firstBuy,
      riskTag: m.riskTag || SUGGESTED_RISK_TAG[t] || DEFAULT_RISK_TAG,
      notes: m.notes || '',
      realised: p.realised,
      txCount: p.txCount,
      lastActivity: p.lastActivity,
      mixedCurrency: p.mixedCurrency,
      oversold: p.oversold
    };
  }).filter(function (p) { return p.shares > 0; });
}

/** Holdings sold down to zero, kept for the realised-gains record. */
function getClosedPositions_(transactions) {
  var folded = foldTransactions_(transactions || getTransactions_());
  return Object.keys(folded)
    .filter(function (t) { return folded[t].shares <= 0; })
    .map(function (t) {
      var p = folded[t];
      return {
        ticker: t,
        realised: p.realised,
        closedOn: p.lastActivity,
        txCount: p.txCount
      };
    });
}

/** Total realised P&L across every holding, open and closed. */
function totalRealised_(transactions) {
  var folded = foldTransactions_(transactions || getTransactions_());
  return Object.keys(folded).reduce(function (a, t) { return a + folded[t].realised; }, 0);
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

function addTransaction_(tx) {
  appendRow_(SHEETS.TRANSACTIONS, HEADERS.TRANSACTIONS, {
    date: tx.date || todayKey_(),
    ticker: tx.ticker,
    type: tx.type,
    shares: tx.shares,
    price: tx.price,
    currency: tx.currency,
    fees: tx.fees || 0,
    notes: tx.notes || ''
  });
}

/* ------------------------------------------------------------------ */
/* Migration                                                            */
/* ------------------------------------------------------------------ */

/**
 * Convert legacy single-row positions into opening BUY transactions.
 *
 * Idempotent: records completion in Script Properties and checks for an
 * existing ledger, so re-running cannot double-count a holding.
 */
function migrateToTransactions() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(MIGRATION_PROP) === 'yes') {
    return 'Already migrated — nothing to do.';
  }

  var legacy = readRows_(SHEETS.POSITIONS).filter(function (r) {
    return String(r.ticker).trim() && Number(r.shares) > 0;
  });

  if (getTransactions_().length) {
    props.setProperty(MIGRATION_PROP, 'yes');
    return 'Ledger already has entries; marking migration complete without touching them.';
  }

  if (!legacy.length) {
    props.setProperty(MIGRATION_PROP, 'yes');
    return 'No legacy positions to migrate.';
  }

  legacy.forEach(function (r) {
    var d = r.buyDate instanceof Date
      ? r.buyDate.toISOString().slice(0, 10)
      : (String(r.buyDate || '').slice(0, 10) || todayKey_());
    addTransaction_({
      date: d,
      ticker: String(r.ticker).trim().toUpperCase(),
      type: TX_BUY,
      shares: Number(r.shares),
      price: Number(r.avgCost) || 0,
      currency: String(r.costCurrency || 'USD').toUpperCase() === 'ILS' ? 'ILS' : 'USD',
      fees: 0,
      notes: 'migrated from legacy position row'
    });
  });

  props.setProperty(MIGRATION_PROP, 'yes');
  var msg = 'Migrated ' + legacy.length + ' position(s) into opening BUY transactions. ' +
            'The shares/avgCost columns on Positions are now ignored — the ledger is ' +
            'the source of truth. Risk tag and notes there are still used.';
  Logger.log(msg);
  return msg;
}
