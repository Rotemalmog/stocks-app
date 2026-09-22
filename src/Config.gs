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
