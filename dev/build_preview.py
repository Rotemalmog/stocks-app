"""
Build a locally-servable preview of the Apps Script web app.

Apps Script templating (<?!= include(...) ?>) and google.script.run only exist
on Google's servers, so this inlines the includes and swaps in a mock RPC layer.

Crucially it loads the REAL Config.gs / Quotes.gs / Portfolio.gs / Analytics.gs,
so the valuation, weighting and risk maths under test are the same code that
runs in production. Only the Sheet I/O is faked.

    python dev/build_preview.py && python -m http.server 8000 --directory dev
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "dev" / "preview.html"

# Server-side files that are pure logic (no SpreadsheetApp calls on load).
LOGIC_FILES = ["Config.gs", "Quotes.gs", "Portfolio.gs", "Analytics.gs", "Strategy.gs"]

MOCK = """
<script>
/* ---- mock server layer: fixtures + the real logic above ---- */
var MOCK_POSITIONS = [
  // Generic demo fixtures - this repo is public, so they deliberately do not
  // mirror anyone's real holdings. They exist to exercise every code path:
  // profitable mega-cap, high-Taiwan semi, unprofitable speculative, and a
  // broken ticker with an ILS cost basis.
  //
  // INTC is the hand-checkable case: 10 @ $100 cost, $122 price
  // => value 1220, P&L +220, +22.0%
  {ticker:'INTC', shares:10,  avgCost:100, costCurrency:'USD', buyDate:'2026-01-15', riskTag:'growth',      notes:'foundry turnaround'},
  {ticker:'MSFT', shares:4,   avgCost:380, costCurrency:'USD', buyDate:'2025-06-02', riskTag:'core',        notes:''},
  {ticker:'NVDA', shares:9,   avgCost:120, costCurrency:'USD', buyDate:'2025-11-20', riskTag:'growth',      notes:''},
  {ticker:'IONQ', shares:150, avgCost:9,   costCurrency:'USD', buyDate:'2026-03-01', riskTag:'speculative', notes:''},
  // Junk ticker on purpose: exercises the stale-data fallback and ILS cost basis.
  {ticker:'ZZZZ', shares:5,   avgCost:50,  costCurrency:'ILS', buyDate:'2026-02-01', riskTag:'speculative', notes:'broken on purpose'}
];

var MOCK_WATCHLIST = [
  {ticker:'TSM',  addedDate:'2026-09-01', thesis:'The chokepoint',    targetEntry:200},
  {ticker:'AMD',  addedDate:'2026-09-01', thesis:'',                  targetEntry:140},
  {ticker:'AVGO', addedDate:'2026-09-10', thesis:'Custom silicon',    targetEntry:null}
];

var MOCK_QUOTES = {
  INTC: {ticker:'INTC', name:'Intel Corporation',     price:122.00, changepct:1.8,  high52:135.0, low52:18.9,  pe:41.2,   eps:2.96,  marketcap:5.3e11, beta:1.4, currency:'USD', stale:false},
  MSFT: {ticker:'MSFT', name:'Microsoft Corporation', price:512.30, changepct:0.3,  high52:560.0, low52:380.0, pe:36.0,   eps:14.2,  marketcap:3.8e12, beta:0.9, currency:'USD', stale:false},
  NVDA: {ticker:'NVDA', name:'NVIDIA Corporation',    price:178.40, changepct:0.9,  high52:212.0, low52:86.0,  pe:52.3,   eps:3.41,  marketcap:4.4e12, beta:1.7, currency:'USD', stale:false},
  IONQ: {ticker:'IONQ', name:'IonQ Inc',              price:14.20,  changepct:3.2,  high52:22.4,  low52:6.1,   pe:-31.40, eps:-0.45, marketcap:4.1e9,  beta:2.6, currency:'USD', stale:false},
  ZZZZ: {ticker:'ZZZZ', name:null, price:null, changepct:null, high52:null, low52:null, pe:null, eps:null, marketcap:null, beta:null, currency:null, stale:true},
  TSM:  {ticker:'TSM',  name:'Taiwan Semiconductor',  price:243.10, changepct:-0.6, high52:260.0, low52:140.0, pe:31.8,   eps:7.64,  marketcap:1.26e12,beta:1.2, currency:'USD', stale:false},
  AMD:  {ticker:'AMD',  name:'Advanced Micro Devices',price:165.90, changepct:-1.1, high52:198.0, low52:94.0,  pe:78.5,   eps:2.11,  marketcap:2.7e11, beta:1.9, currency:'USD', stale:false},
  AVGO: {ticker:'AVGO', name:'Broadcom Inc',          price:389.40, changepct:1.4,  high52:420.0, low52:210.0, pe:44.2,   eps:8.81,  marketcap:1.8e12, beta:1.1, currency:'USD', stale:false}
};

var MOCK_USDILS = 3.72;
var mockSettings = {displayCurrency:'USD', drawdownTolerance:0.50, maxSinglePositionPct:0.25, maxTop3Pct:0.60};

function mockDashboard() {
  var t0 = Date.now();
  var quotes = JSON.parse(JSON.stringify(MOCK_QUOTES));
  var pf = computePortfolio_(MOCK_POSITIONS, quotes, MOCK_USDILS, mockSettings.displayCurrency);
  var wl = computeWatchlist_(MOCK_WATCHLIST, quotes, MOCK_USDILS, mockSettings.displayCurrency);
  var analytics = computeAnalytics_(pf.rows, mockSettings);
  return {
    positions: pf.rows, totals: pf.totals, watchlist: wl, analytics: analytics,
    settings: mockSettings, usdIls: MOCK_USDILS, riskTags: RISK_TAGS,
    fetchedAt: '2026-09-22 12:30 (MOCK)', elapsedMs: Date.now() - t0
  };
}

window.google = { script: { run: (function () {
  var ok = null, fail = null;
  var api = {
    withSuccessHandler: function (f) { ok = f; return api; },
    withFailureHandler: function (f) { fail = f; return api; },
    getDashboardData: function () { setTimeout(function () { ok(mockDashboard()); }, 120); },
    updateSetting: function (k, v) {
      mockSettings[k] = v;
      setTimeout(function () { ok(mockDashboard()); }, 120);
    },
    addHolding: function (p) {
      setTimeout(function () {
        var t = normalizeTicker(p.ticker);
        if (!t) return fail({message:'Ticker is required.'});
        if (!MOCK_QUOTES[t] && !p.force) {
          return fail({message:'GOOGLEFINANCE has no price for ' + t + '. It may be a very recent listing.'});
        }
        var list = p.list === 'positions' ? MOCK_POSITIONS : MOCK_WATCHLIST;
        if (list.some(function (r) { return r.ticker === t; })) {
          return fail({message: t + ' is already in your ' + (p.list === 'positions' ? 'portfolio' : 'watchlist') + '.'});
        }
        if (!MOCK_QUOTES[t]) {
          MOCK_QUOTES[t] = {ticker:t, name:null, price:null, changepct:null, high52:null,
                            low52:null, pe:null, eps:null, marketcap:null, beta:null,
                            currency:null, stale:true};
        }
        if (p.list === 'positions') {
          MOCK_POSITIONS.push({ticker:t, shares:Number(p.shares), avgCost:Number(p.avgCost),
            costCurrency:p.costCurrency, buyDate:'2026-09-22',
            riskTag:p.riskTag || 'growth', notes:p.notes || ''});
        } else {
          MOCK_WATCHLIST.push({ticker:t, addedDate:'2026-09-22', thesis:p.thesis || '',
            targetEntry:p.targetEntry ? Number(p.targetEntry) : null});
        }
        ok(mockDashboard());
      }, 150);
    },
    getStrategyData: function () {
      setTimeout(function () {
        // Fabricated Finnhub-shaped metrics, run through the REAL scoreStock_.
        var fake = {
          INTC: {'roiTTM':8.1,'grossMarginTTM':38.2,'operatingMarginTTM':9.4,
                 'totalDebt/totalEquityQuarterly':0.52,'currentRatioQuarterly':1.6,
                 'netProfitMarginTTM':6.2,'revenueGrowth3Y':4.1,'revenueGrowth5Y':1.8,
                 'epsGrowth3Y':-12.0,'peTTM':41.2,'pfcfShareTTM':38.0,'psTTM':3.1},
          MSFT: {'roiTTM':28.4,'grossMarginTTM':69.1,'operatingMarginTTM':44.2,
                 'totalDebt/totalEquityQuarterly':0.28,'currentRatioQuarterly':1.3,
                 'netProfitMarginTTM':35.6,'revenueGrowth3Y':14.2,'revenueGrowth5Y':15.1,
                 'epsGrowth3Y':16.4,'peTTM':36.0,'pfcfShareTTM':41.0,'psTTM':13.2},
          NVDA: {'roiTTM':62.0,'grossMarginTTM':74.5,'operatingMarginTTM':61.2,
                 'totalDebt/totalEquityQuarterly':0.12,'currentRatioQuarterly':4.1,
                 'netProfitMarginTTM':55.8,'revenueGrowth3Y':68.0,'revenueGrowth5Y':52.0,
                 'epsGrowth3Y':78.0,'peTTM':52.3,'pfcfShareTTM':58.0,'psTTM':28.4},
          IONQ: {'roiTTM':-41.2,'grossMarginTTM':42.0,'operatingMarginTTM':-180.0,
                 'totalDebt/totalEquityQuarterly':0.05,'currentRatioQuarterly':6.2,
                 'netProfitMarginTTM':-210.0,'revenueGrowth3Y':84.0,'revenueGrowth5Y':null,
                 'epsGrowth3Y':null,'peTTM':-31.4,'pfcfShareTTM':-22.0,'psTTM':64.0},
          TSM:  {'roiTTM':22.1,'grossMarginTTM':53.2,'operatingMarginTTM':42.6,
                 'totalDebt/totalEquityQuarterly':0.24,'currentRatioQuarterly':2.4,
                 'netProfitMarginTTM':38.9,'revenueGrowth3Y':18.2,'revenueGrowth5Y':16.4,
                 'epsGrowth3Y':21.0,'peTTM':31.8,'pfcfShareTTM':29.0,'psTTM':11.2},
          AMD:  {'roiTTM':4.2,'grossMarginTTM':49.1},   // deliberately sparse -> low coverage
          AVGO: {'roiTTM':18.4,'grossMarginTTM':63.2,'operatingMarginTTM':38.1,
                 'totalDebt/totalEquityQuarterly':1.42,'currentRatioQuarterly':1.1,
                 'netProfitMarginTTM':24.1,'revenueGrowth3Y':22.0,'revenueGrowth5Y':17.5,
                 'epsGrowth3Y':19.0,'peTTM':44.2,'pfcfShareTTM':33.0,'psTTM':18.9},
          ZZZZ: null
        };
        var held = {};
        MOCK_POSITIONS.forEach(function (p) { held[p.ticker] = true; });
        var tickers = Object.keys(fake);
        var rows = tickers.map(function (t) {
          var r = scoreStock_(t, fake[t]);
          r.held = !!held[t];
          r.fetchError = fake[t] ? '' : 'no_data';
          return r;
        }).sort(function (a, b) {
          if (a.total === null) return 1;
          if (b.total === null) return -1;
          return b.total - a.total;
        });
        ok({needsKey:false, empty:false, rows:rows, weights:STRATEGY_WEIGHTS,
            minCoverage:MIN_COVERAGE, fetchedAt:'2026-09-23 10:00 (MOCK)', elapsedMs:820});
      }, 200);
    },
    removeHolding: function (list, ticker) {
      setTimeout(function () {
        var arr = list === 'positions' ? MOCK_POSITIONS : MOCK_WATCHLIST;
        var i = arr.findIndex(function (r) { return r.ticker === ticker; });
        if (i === -1) return fail({message: ticker + ' was not found.'});
        arr.splice(i, 1);
        ok(mockDashboard());
      }, 120);
    }
  };
  return api;
})() } };
</script>
"""


BANNER = """
<div style="max-width:1120px;margin:12px auto 0;padding:10px 14px;border-radius:8px;
            border:1px solid #eb6834;border-left-width:3px;background:rgba(235,104,52,0.08);
            font:13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:inherit">
  <strong>Local preview - mock data.</strong>
  Prices are invented and the fixture set is limited to
  INTC, MSFT, NVDA, IONQ, TSM, AMD, AVGO (plus ZZZZ, deliberately broken).
  Any other ticker will report &ldquo;no price&rdquo; <em>here only</em> - that is the mock,
  not GOOGLEFINANCE. The deployed app looks up real symbols.
</div>
"""


def main() -> None:
    html = (SRC / "index.html").read_text(encoding="utf-8")

    html = html.replace("<?!= include('styles'); ?>",
                        (SRC / "styles.html").read_text(encoding="utf-8"))

    logic = "\n".join(
        "<script>\n/* ==== {} ==== */\n{}\n</script>".format(
            f, (SRC / f).read_text(encoding="utf-8"))
        for f in LOGIC_FILES
    )

    app_js = (SRC / "app.js.html").read_text(encoding="utf-8")
    html = html.replace("<?!= include('app.js'); ?>", logic + MOCK + app_js)

    marker = '<div class="wrap">'
    assert html.count(marker) == 1, "wrap div not found"
    html = html.replace(marker, BANNER + marker)

    leftover = re.findall(r"<\?!?=.*?\?>", html)
    if leftover:
        raise SystemExit("Unreplaced Apps Script scriptlets: {}".format(leftover))

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print("wrote {} ({:,} bytes)".format(OUT, len(html)))


if __name__ == "__main__":
    main()
