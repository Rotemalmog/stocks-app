/**
 * Config.gs — static configuration for the portfolio tracker.
 *
 * Everything here is data, not logic: sheet names, ticker aliases, the
 * theme/geopolitical classification maps, and the risk model constants.
 */

var SHEETS = {
  POSITIONS: 'Positions',
  WATCHLIST: 'Watchlist',
  QUOTES: '_Quotes',
  HISTORY: 'History',
  SETTINGS: 'Settings'
};

var HEADERS = {
  POSITIONS: ['ticker', 'shares', 'avgCost', 'costCurrency', 'buyDate', 'riskTag', 'notes'],
  WATCHLIST: ['ticker', 'addedDate', 'thesis', 'targetEntry'],
  HISTORY:   ['date', 'ticker', 'price', 'portfolioTotalUSD'],
  SETTINGS:  ['key', 'value']
};

/** Attributes pulled from GOOGLEFINANCE, in column order. */
var QUOTE_ATTRS = [
  'name', 'price', 'changepct', 'high52', 'low52',
  'pe', 'eps', 'marketcap', 'beta', 'currency'
];

/** Friendly names -> tickers. Lowercased keys. */
var TICKER_ALIASES = {
  'spacex': 'SPCX',
  'space x': 'SPCX',
  'space-x': 'SPCX',
  'dwave': 'QBTS',
  'd-wave': 'QBTS',
  'd wave': 'QBTS',
  'google': 'GOOGL',
  'alphabet': 'GOOGL',
  'intel': 'INTC',
  'tesla': 'TSLA',
  'nvidia': 'NVDA',
  'apple': 'AAPL',
  'microsoft': 'MSFT',
  'amazon': 'AMZN',
  'meta': 'META',
  'facebook': 'META',
  'tsmc': 'TSM',
  'taiwan semiconductor': 'TSM',
  'broadcom': 'AVGO',
  'qualcomm': 'QCOM',
  'micron': 'MU',
  'palantir': 'PLTR',
  'ionq': 'IONQ',
  'rigetti': 'RGTI',
  'rocket lab': 'RKLB'
};

/** Theme buckets. Drives the second pie chart. */
var THEMES = {
  'Semiconductors': ['INTC','TSM','NVDA','AMD','AVGO','QCOM','MU','AMAT','LRCX','KLAC','ASML','ADI','TXN','NXPI','MRVL','ARM','GFS','ON','SWKS'],
  'Mega-cap tech':  ['GOOGL','GOOG','MSFT','AAPL','AMZN','META'],
  'Space':          ['SPCX','RKLB','ASTS','LUNR','RDW'],
  'Quantum':        ['QBTS','IONQ','RGTI','QUBT'],
  'EV / Auto':      ['TSLA','RIVN','LCID'],
  'Software':       ['PLTR','CRM','NOW','SNOW','DDOG','CRWD','PANW','ORCL','ADBE','MDB','NET'],
  'Fintech':        ['V','MA','PYPL','XYZ','COIN'],
  'Health-tech':    ['ISRG','DXCM','VEEV','TMO']
};

/**
 * Taiwan / China supply-chain exposure.
 *
 * Levels:
 *   direct  - the Taiwanese manufacturer itself
 *   high    - no viable alternative to TSMC leading-edge / CoWoS packaging
 *   medium  - meaningful but partly diversified fab or revenue exposure
 *   hedge   - benefits from a Taiwan disruption (non-Taiwan leading-edge capacity)
 *   low     - little direct semiconductor supply-chain dependency
 *
 * Anything unlisted defaults to 'unknown' and is reported as such rather than
 * silently assumed safe.
 */
var TAIWAN_EXPOSURE = {
  'TSM':   'direct',
  'NVDA':  'high',
  'AMD':   'high',
  'AAPL':  'high',
  'QCOM':  'high',
  'AVGO':  'high',
  'MRVL':  'high',
  'ARM':   'high',
  'ASML':  'high',
  'MU':    'medium',
  'AMAT':  'medium',
  'LRCX':  'medium',
  'KLAC':  'medium',
  'TSLA':  'medium',
  'INTC':  'hedge',
  'GFS':   'hedge',
  'GOOGL': 'low',
  'GOOG':  'low',
  'MSFT':  'low',
  'AMZN':  'low',
  'META':  'low',
  'SPCX':  'low',
  'QBTS':  'low',
  'IONQ':  'low',
  'RGTI':  'low',
  'PLTR':  'low'
};

var TAIWAN_LABELS = {
  'direct':  'Direct (Taiwan-based)',
  'high':    'High dependency',
  'medium':  'Medium dependency',
  'hedge':   'Structural hedge',
  'low':     'Low dependency',
  'unknown': 'Unclassified'
};

/**
 * Risk tags and the drawdown each is modelled at.
 *
 * These are deliberately pessimistic single-name drawdowns, not forecasts.
 * A speculative unprofitable name is modelled at 85% because that is roughly
 * what the quantum and pre-revenue tech complex actually did in 2022 - using
 * the portfolio-level 50% tolerance for a single speculative position would
 * badly understate the risk.
 */
var RISK_TAGS = {
  'core':        { drawdown: 0.50, bandMin: 0.15, bandMax: 0.25, label: 'Core conviction' },
  'growth':      { drawdown: 0.65, bandMin: 0.05, bandMax: 0.15, label: 'Growth' },
  'speculative': { drawdown: 0.85, bandMin: 0.02, bandMax: 0.05, label: 'Speculative' }
};

var DEFAULT_RISK_TAG = 'growth';

/** Suggested tag shown in the add dialog. The user can always override. */
var SUGGESTED_RISK_TAG = {
  'GOOGL': 'core', 'GOOG': 'core', 'MSFT': 'core', 'AAPL': 'core', 'AMZN': 'core',
  'TSM': 'core', 'AVGO': 'core', 'V': 'core', 'MA': 'core',
  'INTC': 'growth', 'TSLA': 'growth', 'SPCX': 'growth', 'NVDA': 'growth', 'AMD': 'growth',
  'QBTS': 'speculative', 'IONQ': 'speculative', 'RGTI': 'speculative',
  'ASTS': 'speculative', 'LUNR': 'speculative', 'QUBT': 'speculative'
};

var DEFAULT_SETTINGS = {
  displayCurrency: 'USD',
  drawdownTolerance: 0.50,
  maxSinglePositionPct: 0.25,
  maxTop3Pct: 0.60
};

/**
 * Tickers to seed a brand-new Watchlist with. Deliberately empty: this repo is
 * public, and a hardcoded list would advertise what its owner follows.
 * Add your own via the + button after deploying.
 */
var SEED_WATCHLIST = [];

/* ------------------------------------------------------------------ */
/* Strategy model — see the /stocks skill for the reasoning behind it   */
/* ------------------------------------------------------------------ */

/**
 * Pillar weights for a 3-5 year hold.
 *
 * MOMENTUM IS DELIBERATELY ABSENT. The momentum premium is real
 * (Jegadeesh & Titman 1993, ~3-5% annualised) but it operates over a
 * 3-12 MONTH horizon and mean-reverts over multi-year periods. Scoring a
 * 3-5 year hold on momentum would systematically favour whatever just ran
 * up, which is the opposite of what this app is for.
 */
var STRATEGY_WEIGHTS = {
  quality:    0.30,   // does the business earn good returns on capital?
  strength:   0.25,   // can it survive two bad years without dilution?
  growth:     0.20,   // is the growth durable rather than one good quarter?
  valuation:  0.15,   // am I paying a sane price for it?
  resilience: 0.10    // Taiwan / China supply-chain dependency
};

/**
 * Metric scoring bands: [excellent, good, fair, poor] thresholds -> 100/75/50/25.
 * `higherBetter: false` inverts the comparison.
 * Thresholds follow the GARP/QARP convention: sustained ROIC above ~15% is the
 * usual marker of a genuine competitive advantage rather than one lucky year.
 */
var METRIC_BANDS = {
  roic:            { field: 'roiTTM',                        bands: [15, 10, 5],      higherBetter: true,  label: 'ROIC %' },
  grossMargin:     { field: 'grossMarginTTM',                bands: [50, 40, 25],     higherBetter: true,  label: 'Gross margin %' },
  operatingMargin: { field: 'operatingMarginTTM',            bands: [25, 15, 7],      higherBetter: true,  label: 'Operating margin %' },

  debtToEquity:    { field: 'totalDebt/totalEquityQuarterly',bands: [0.3, 0.6, 1.2],  higherBetter: false, label: 'Debt / equity' },
  currentRatio:    { field: 'currentRatioQuarterly',         bands: [2, 1.5, 1],      higherBetter: true,  label: 'Current ratio' },
  netMargin:       { field: 'netProfitMarginTTM',            bands: [20, 10, 3],      higherBetter: true,  label: 'Net margin %' },

  revGrowth3Y:     { field: 'revenueGrowth3Y',               bands: [15, 10, 4],      higherBetter: true,  label: 'Revenue CAGR 3y %' },
  revGrowth5Y:     { field: 'revenueGrowth5Y',               bands: [12, 8, 3],       higherBetter: true,  label: 'Revenue CAGR 5y %' },
  epsGrowth3Y:     { field: 'epsGrowth3Y',                   bands: [15, 10, 3],      higherBetter: true,  label: 'EPS CAGR 3y %' },

  pe:              { field: 'peTTM',                         bands: [18, 28, 45],     higherBetter: false, label: 'P/E' },
  pfcf:            { field: 'pfcfShareTTM',                  bands: [18, 28, 45],     higherBetter: false, label: 'P/FCF' },
  ps:              { field: 'psTTM',                         bands: [3, 7, 14],       higherBetter: false, label: 'P/S' }
};

/** Which metrics roll up into which pillar. */
var PILLAR_METRICS = {
  quality:   ['roic', 'grossMargin', 'operatingMargin'],
  strength:  ['debtToEquity', 'currentRatio', 'netMargin'],
  growth:    ['revGrowth3Y', 'revGrowth5Y', 'epsGrowth3Y'],
  valuation: ['pe', 'pfcf', 'ps']
};

/** Supply-chain resilience score by Taiwan exposure class. */
var RESILIENCE_SCORE = {
  'hedge':   100,
  'low':     80,
  'medium':  50,
  'high':    25,
  'direct':  15,
  'unknown': 50   // neutral, never treated as safe
};

/**
 * A score built from very few metrics is not comparable to a complete one.
 * Below this fraction of available metrics the UI labels the score as
 * low-confidence rather than presenting it as equivalent.
 */
var MIN_COVERAGE = 0.6;

/** Re-examine the thesis when a position falls this far below cost. */
var THESIS_REVIEW_DRAWDOWN = -0.20;

var FINNHUB_PROP = 'FINNHUB_API_KEY';
var FINNHUB_BASE = 'https://finnhub.io/api/v1';
