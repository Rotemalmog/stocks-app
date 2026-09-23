/**
 * Test suite for the pure logic: valuation, weights, risk analytics and the
 * strategy scorer. Run with:  node test/run.js
 */
const { load, suite, eq, near, isTrue, isNull, check, report } = require('./harness');

const ctx = load(['Config.gs', 'Quotes.gs', 'Portfolio.gs', 'Analytics.gs', 'Strategy.gs', 'Transactions.gs']);

const {
  normalizeTicker, cleanCell_, isFiniteNumber_,
  computePortfolio_, computeWatchlist_, themeOf_,
  computeAnalytics_, scoreMetric_, scoreStock_, profitabilityGate_,
  METRIC_BANDS, DEFAULT_SETTINGS, RISK_TAGS,
  derivePositions_, getClosedPositions_, foldTransactions_, totalRealised_
} = ctx;

/** Build a transaction without repeating the boilerplate. */
function tx(date, ticker, type, shares, price, fees, currency) {
  return {
    date: date, ticker: ticker, type: type, shares: shares, price: price,
    fees: fees || 0, currency: currency || 'USD', notes: ''
  };
}

const settings = Object.assign({}, DEFAULT_SETTINGS);

/* ------------------------------------------------------------------ */
suite('ticker normalisation');

eq('friendly name resolves', normalizeTicker('spacex'), 'SPCX');
eq('hyphenated alias resolves', normalizeTicker('d-wave'), 'QBTS');
eq('case insensitive', normalizeTicker('  SpAcEx '), 'SPCX');
eq('plain ticker uppercased', normalizeTicker('intc'), 'INTC');
eq('internal spaces stripped', normalizeTicker('b r k'), 'BRK');
eq('empty input', normalizeTicker(''), '');
eq('null input', normalizeTicker(null), '');

/* ------------------------------------------------------------------ */
suite('cell cleaning');

isNull('empty string is null', cleanCell_(''));
isNull('error text is null', cleanCell_('#N/A'));
eq('numeric string coerced', cleanCell_('12.5'), 12.5);
eq('number passes through', cleanCell_(42), 42);
eq('plain text preserved', cleanCell_('Intel Corporation'), 'Intel Corporation');
eq('zero is kept, not treated as empty', cleanCell_(0), 0);

/* ------------------------------------------------------------------ */
suite('portfolio valuation');

const quotes = {
  INTC: { name: 'Intel', price: 122, changepct: 2, pe: 41, marketcap: 5e11, high52: 135, low52: 19, stale: false },
  MSFT: { name: 'Microsoft', price: 500, changepct: 0, pe: 36, marketcap: 3.8e12, high52: 560, low52: 380, stale: false },
  DEAD: { stale: true }
};

const positions = [
  { ticker: 'INTC', shares: 10, avgCost: 100, costCurrency: 'USD', riskTag: 'growth', notes: '', buyDate: '' },
  { ticker: 'MSFT', shares: 2,  avgCost: 400, costCurrency: 'USD', riskTag: 'core',   notes: '', buyDate: '' }
];

const pf = computePortfolio_(positions, quotes, 3.72, 'USD');
const intc = pf.rows.find(r => r.ticker === 'INTC');

eq('market value', intc.marketValue, 1220);
eq('cost basis', intc.costBasisUSD, 1000);
eq('unrealised P&L', intc.pnl, 220);
near('P&L percent', intc.pnlPct, 0.22);
near('day change percent normalised from GOOGLEFINANCE percent', intc.changePct, 0.02);
eq('totals market value', pf.totals.marketValue, 1220 + 1000);
eq('totals cost basis', pf.totals.costBasis, 1000 + 800);
near('weights sum to 1', pf.rows.reduce((a, r) => a + r.weight, 0), 1);
isTrue('rows sorted by weight descending', pf.rows[0].weight >= pf.rows[1].weight);

/* ------------------------------------------------------------------ */
suite('currency handling');

const ils = computePortfolio_(
  [{ ticker: 'INTC', shares: 10, avgCost: 372, costCurrency: 'ILS', riskTag: 'core', notes: '', buyDate: '' }],
  quotes, 3.72, 'USD');
near('ILS cost basis converts to USD at the rate', ils.rows[0].costBasisUSD, 1000);
eq('entered avg cost is never mutated', ils.rows[0].avgCost, 372);
eq('entered currency preserved', ils.rows[0].costCurrency, 'ILS');

const shown = computePortfolio_(positions, quotes, 3.72, 'ILS');
near('display currency scales totals', shown.totals.marketValue, 2220 * 3.72, 1e-6);
eq('USD cost basis untouched by display currency', shown.rows.find(r => r.ticker === 'INTC').avgCost, 100);

const noRate = computePortfolio_(positions, quotes, null, 'ILS');
isNull('missing FX rate yields null rather than a wrong number', noRate.totals.marketValue);

/* ------------------------------------------------------------------ */
suite('stale quotes');

const withDead = computePortfolio_(
  positions.concat([{ ticker: 'DEAD', shares: 5, avgCost: 50, costCurrency: 'USD', riskTag: 'speculative', notes: '', buyDate: '' }]),
  quotes, 3.72, 'USD');
const dead = withDead.rows.find(r => r.ticker === 'DEAD');

isTrue('stale flag set', dead.stale);
isNull('no price means no market value, not zero', dead.marketValue);
isNull('no price means no P&L', dead.pnl);
eq('stale position gets zero weight', dead.weight, 0);
near('other weights still sum to 1', withDead.rows.reduce((a, r) => a + r.weight, 0), 1);
eq('totals ignore the unpriced position', withDead.totals.marketValue, 2220);

/* ------------------------------------------------------------------ */
suite('themes and exposure');

eq('semiconductor theme', themeOf_('INTC'), 'Semiconductors');
eq('mega-cap theme', themeOf_('GOOGL'), 'Mega-cap tech');
eq('quantum theme', themeOf_('QBTS'), 'Quantum');
eq('unknown ticker falls back to Other', themeOf_('ZZZZ'), 'Other');

/* ------------------------------------------------------------------ */
suite('risk analytics');

const an = computeAnalytics_(pf.rows, settings);

near('herfindahl of a two-position book', an.concentration.hhi,
     Math.pow(1220 / 2220, 2) + Math.pow(1000 / 2220, 2));
near('effective holdings is 1/HHI', an.concentration.effectiveHoldings, 1 / an.concentration.hhi);
near('top weight', an.concentration.topWeight, 1220 / 2220);
eq('position count', an.concentration.positionCount, 2);
near('theme weights sum to 1', an.themes.reduce((a, b) => a + b.weight, 0), 1);
near('taiwan buckets sum to 1', an.taiwan.reduce((a, b) => a + b.weight, 0), 1);

const intcTaiwan = an.taiwan.find(b => b.tickers.includes('INTC'));
eq('Intel classed as a structural hedge', intcTaiwan.key, 'hedge');

/* ------------------------------------------------------------------ */
suite('drawdown model');

const dd = an.drawdown;
const expectedDd =
  (1220 / 2220) * RISK_TAGS.growth.drawdown +
  (1000 / 2220) * RISK_TAGS.core.drawdown;
near('modelled drawdown is weight x assumed loss', dd.modelledDrawdown, expectedDd);
eq('tolerance read from settings', dd.tolerance, settings.drawdownTolerance);
isTrue('contributions sorted descending', dd.contributions[0].contribution >= dd.contributions[1].contribution);
eq('speculative modelled harsher than core', RISK_TAGS.speculative.drawdown > RISK_TAGS.core.drawdown, true);

/* ------------------------------------------------------------------ */
suite('thesis review trigger');

const losing = computePortfolio_(
  [{ ticker: 'INTC', shares: 10, avgCost: 200, costCurrency: 'USD', riskTag: 'core', notes: '', buyDate: '' }],
  quotes, 3.72, 'USD');
near('position is 39% underwater', losing.rows[0].pnlPct, (1220 - 2000) / 2000);
const losingWarnings = computeAnalytics_(losing.rows, settings).warnings;
isTrue('thesis review warning fires below -20%',
  losingWarnings.some(w => /below your cost basis/.test(w.text)));

const winningWarnings = computeAnalytics_(pf.rows, settings).warnings;
check('no thesis warning when in profit',
  !winningWarnings.some(w => /below your cost basis/.test(w.text)));

/* ------------------------------------------------------------------ */
suite('metric scoring');

eq('higher-is-better top band', scoreMetric_(20, METRIC_BANDS.roic), 100);
eq('higher-is-better mid band', scoreMetric_(12, METRIC_BANDS.roic), 75);
eq('higher-is-better bottom', scoreMetric_(1, METRIC_BANDS.roic), 25);
eq('lower-is-better top band', scoreMetric_(15, METRIC_BANDS.pe), 100);
eq('lower-is-better worst band', scoreMetric_(80, METRIC_BANDS.pe), 25);
eq('negative P/E scores zero, not "cheap"', scoreMetric_(-30, METRIC_BANDS.pe), 0);
isNull('missing metric scores null, never zero', scoreMetric_(null, METRIC_BANDS.roic));
isNull('non-numeric metric scores null', scoreMetric_('n/a', METRIC_BANDS.roic));

/* ------------------------------------------------------------------ */
suite('strategy scoring');

const strong = {
  roiTTM: 28, grossMarginTTM: 69, operatingMarginTTM: 44,
  'totalDebt/totalEquityQuarterly': 0.28, currentRatioQuarterly: 1.8, netProfitMarginTTM: 35,
  revenueGrowth3Y: 14, revenueGrowth5Y: 15, epsGrowth3Y: 16,
  peTTM: 22, pfcfShareTTM: 24, psTTM: 6
};
const s1 = scoreStock_('MSFT', strong);
eq('full coverage reported', s1.metricsAvailable, s1.metricsTotal);
eq('full coverage is not low confidence', s1.lowConfidence, false);
isTrue('strong business scores well', s1.total >= 70);
eq('resilience always available from the local map', typeof s1.pillars.resilience, 'number');

const sparse = scoreStock_('AMD', { roiTTM: 4.2, grossMarginTTM: 49.1 });
isTrue('sparse data flagged low confidence', sparse.lowConfidence);
isTrue('coverage below threshold', sparse.coverage < 0.6);
isTrue('a score is still produced', typeof sparse.total === 'number');
isNull('unscoreable pillar is null, not zero', sparse.pillars.growth);

const none = scoreStock_('ZZZZ', null);
eq('no metrics means zero coverage', none.coverage, 0);
isTrue('resilience alone still yields a score', typeof none.total === 'number');

/* ------------------------------------------------------------------ */
suite('profitability gate');

const burner = {
  roiTTM: -41, grossMarginTTM: 42, operatingMarginTTM: -180,
  'totalDebt/totalEquityQuarterly': 0.05, currentRatioQuarterly: 6.2, netProfitMarginTTM: -210,
  revenueGrowth3Y: 84, revenueGrowth5Y: 60, epsGrowth3Y: 40,
  peTTM: -31, pfcfShareTTM: -22, psTTM: 64
};
const gated = scoreStock_('IONQ', burner);
isTrue('unprofitable company is gated', gated.gated);
eq('capped at 50', gated.total, 50);
isTrue('reason explains the cap', /capped at 50/.test(gated.gateReason));
isTrue('gate raises a warning flag', gated.flags.some(f => /[Nn]ot profitable/.test(f.text)));

const profitable = scoreStock_('MSFT', strong);
eq('profitable company is not gated', profitable.gated, false);
isTrue('a profitable company outranks the gated one', profitable.total > gated.total);

const alreadyLow = profitabilityGate_(
  { netProfitMarginTTM: -5, operatingMarginTTM: -5 }, 30);
eq('gate does not raise a score that is already below the cap', alreadyLow.total, 30);
eq('and does not claim to have applied', alreadyLow.applied, false);

const onlyNetNegative = profitabilityGate_(
  { netProfitMarginTTM: -2, operatingMarginTTM: 8 }, 70);
eq('a one-off net loss with positive operations is not gated', onlyNetNegative.total, 70);

/* ------------------------------------------------------------------ */
suite('watchlist');

const wl = computeWatchlist_(
  [{ ticker: 'INTC', addedDate: '', thesis: '', targetEntry: 100 }],
  quotes, 3.72, 'USD');
near('52-week range position', wl[0].range52, (122 - 19) / (135 - 19));
near('distance above target entry', wl[0].toTarget, 0.22);

const noTarget = computeWatchlist_(
  [{ ticker: 'INTC', addedDate: '', thesis: '', targetEntry: null }],
  quotes, 3.72, 'USD');
isNull('no target means no distance', noTarget[0].toTarget);


/* ------------------------------------------------------------------ */
suite('transaction ledger — position derivation');

const oneBuy = derivePositions_([tx('2026-01-10', 'INTC', 'BUY', 10, 100)], {});
eq('single buy shares', oneBuy[0].shares, 10);
eq('single buy average cost', oneBuy[0].avgCost, 100);
eq('first buy date recorded', oneBuy[0].buyDate, '2026-01-10');
eq('no realised gain yet', oneBuy[0].realised, 0);

// The whole point of the ledger: buying more must average correctly.
const twoBuys = derivePositions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-03-01', 'INTC', 'BUY', 5, 130)
], {});
eq('accumulated shares', twoBuys[0].shares, 15);
near('weighted average cost', twoBuys[0].avgCost, (10 * 100 + 5 * 130) / 15);
eq('first buy date is the earliest, not the latest', twoBuys[0].buyDate, '2026-01-10');
eq('transaction count', twoBuys[0].txCount, 2);

const withFees = derivePositions_([tx('2026-01-10', 'INTC', 'BUY', 10, 100, 9.9)], {});
near('fees are capitalised into cost basis', withFees[0].avgCost, (10 * 100 + 9.9) / 10);

/* ------------------------------------------------------------------ */
suite('transaction ledger — sells and realised P&L');

const partial = derivePositions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-06-01', 'INTC', 'SELL', 4, 150)
], {});
eq('shares reduced by the sale', partial[0].shares, 6);
near('average cost unchanged by a sale', partial[0].avgCost, 100);
near('realised gain measured against average cost', partial[0].realised, 4 * (150 - 100));

const sellWithFees = derivePositions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-06-01', 'INTC', 'SELL', 4, 150, 7.5)
], {});
near('sale fees reduce realised gain', sellWithFees[0].realised, 4 * 50 - 7.5);

const atALoss = derivePositions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-06-01', 'INTC', 'SELL', 10, 60)
], {});
eq('a fully closed holding is not an open position', atALoss.length, 0);

const closed = getClosedPositions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-06-01', 'INTC', 'SELL', 10, 60)
]);
eq('closed holding is retained for the record', closed.length, 1);
near('realised loss is negative', closed[0].realised, -400);
eq('close date recorded', closed[0].closedOn, '2026-06-01');

// Average-cost convention: buy, buy higher, then sell.
const avgThenSell = derivePositions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-03-01', 'INTC', 'BUY', 10, 200),
  tx('2026-06-01', 'INTC', 'SELL', 5, 250)
], {});
near('average cost after two buys', avgThenSell[0].avgCost, 150);
near('realised uses the average, not the first lot', avgThenSell[0].realised, 5 * (250 - 150));
eq('remaining shares', avgThenSell[0].shares, 15);
near('remaining basis stays at the average', avgThenSell[0].avgCost, 150);

/* ------------------------------------------------------------------ */
suite('transaction ledger — edge cases');

const oversold = derivePositions_([
  tx('2026-01-10', 'INTC', 'BUY', 5, 100),
  tx('2026-06-01', 'INTC', 'SELL', 10, 150)
], {});
eq('selling more than held closes the position rather than going negative', oversold.length, 0);
const oversoldClosed = getClosedPositions_([
  tx('2026-01-10', 'INTC', 'BUY', 5, 100),
  tx('2026-06-01', 'INTC', 'SELL', 10, 150)
]);
near('only the shares actually held are realised', oversoldClosed[0].realised, 5 * 50);

// Assert against the fold directly. Testing only via derivePositions_ missed
// removing the Math.min clamp entirely: the trailing `shares <= 0 -> 0` guard
// masked a negative share count, so the position still filtered out and every
// check passed. Mutation testing caught that the tests had no teeth here.
const oversoldFold = foldTransactions_([
  tx('2026-01-10', 'INTC', 'BUY', 5, 100),
  tx('2026-06-01', 'INTC', 'SELL', 10, 150)
]).INTC;
isTrue('oversell is flagged', oversoldFold.oversold);
eq('shares never go negative', oversoldFold.shares, 0);
near('realised counts only the 5 shares actually held', oversoldFold.realised, 5 * 50);

const normalFold = foldTransactions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-06-01', 'INTC', 'SELL', 4, 150)
]).INTC;
eq('a normal sale is not flagged as an oversell', normalFold.oversold, false);
eq('remaining shares after a partial sale', normalFold.shares, 6);
near('remaining basis tracks the average', normalFold.costBasis, 600);

near('total realised across holdings', totalRealised_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-06-01', 'INTC', 'SELL', 4, 150),
  tx('2026-02-01', 'MSFT', 'BUY', 5, 400),
  tx('2026-07-01', 'MSFT', 'SELL', 5, 300)
]), 4 * 50 + 5 * -100);

const mixed = derivePositions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100, 0, 'USD'),
  tx('2026-03-01', 'INTC', 'BUY', 5, 400, 0, 'ILS')
], {});
isTrue('mixing currencies in one holding is flagged', mixed[0].mixedCurrency);

const multi = derivePositions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-01-11', 'MSFT', 'BUY', 2, 400)
], {});
eq('separate tickers stay separate', multi.length, 2);

eq('empty ledger yields no positions', derivePositions_([], {}).length, 0);

// Out-of-order rows must not corrupt the average.
const ordered = derivePositions_([
  tx('2026-03-01', 'INTC', 'BUY', 5, 130),
  tx('2026-01-10', 'INTC', 'BUY', 10, 100)
], {});
near('order of input rows does not change the average', ordered[0].avgCost, (10 * 100 + 5 * 130) / 15);

/* ------------------------------------------------------------------ */
suite('derived positions feed the existing pipeline unchanged');

const derived = derivePositions_([
  tx('2026-01-10', 'INTC', 'BUY', 10, 100),
  tx('2026-02-01', 'MSFT', 'BUY', 2, 400)
], { INTC: { riskTag: 'growth', notes: '' }, MSFT: { riskTag: 'core', notes: '' } });

const dpf = computePortfolio_(derived, quotes, 3.72, 'USD');
eq('valuation works on derived positions', dpf.rows.find(r => r.ticker === 'INTC').marketValue, 1220);
near('weights still sum to 1', dpf.rows.reduce((a, r) => a + r.weight, 0), 1);
// computePortfolio_ builds fresh row objects; ledger-only fields must survive
// that mapping or the UI silently loses them.
const sold = computePortfolio_(
  derivePositions_([
    tx('2026-01-10', 'INTC', 'BUY', 10, 100),
    tx('2026-06-01', 'INTC', 'SELL', 4, 150)
  ], {}), quotes, 3.72, 'USD');
near('realised P&L survives into the portfolio row', sold.rows[0].realised, 200);
eq('transaction count survives', sold.rows[0].txCount, 2);
eq('mixedCurrency flag survives', sold.rows[0].mixedCurrency, false);

const dan = computeAnalytics_(dpf.rows, settings);
eq('analytics still classify Intel as a hedge',
   dan.taiwan.find(b => b.tickers.includes('INTC')).key, 'hedge');
eq('risk tags carried through from metadata',
   derived.find(p => p.ticker === 'MSFT').riskTag, 'core');


report();
