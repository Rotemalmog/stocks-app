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
LOGIC_FILES = ["Config.gs", "Quotes.gs", "Portfolio.gs", "Analytics.gs"]

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

    leftover = re.findall(r"<\?!?=.*?\?>", html)
    if leftover:
        raise SystemExit("Unreplaced Apps Script scriptlets: {}".format(leftover))

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print("wrote {} ({:,} bytes)".format(OUT, len(html)))


if __name__ == "__main__":
    main()
