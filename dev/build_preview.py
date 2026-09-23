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
LOGIC_FILES = ["Config.gs", "Quotes.gs", "Portfolio.gs", "Analytics.gs",
               "Strategy.gs", "Transactions.gs"]

MOCK = """
<script>
/* ---- mock server layer: fixtures + the real logic above ---- */
var MOCK_TRANSACTIONS = [
  // Generic demo fixtures - the repo is public, so these deliberately do not
  // mirror anyone's real holdings. They exercise every ledger path: a simple
  // buy, a buy-more that must average correctly, a partial sale with realised
  // gain, a fully closed position, and a broken ticker with an ILS basis.
  //
  // INTC is the hand-checkable case: 10 @ $100, price $122
  // => value 1220, P&L +220, +22.0%
  {date:'2026-01-15', ticker:'INTC', type:'BUY',  shares:10,  price:100, currency:'USD', fees:0, notes:'foundry turnaround'},
  {date:'2025-06-02', ticker:'MSFT', type:'BUY',  shares:2,   price:360, currency:'USD', fees:0, notes:''},
  {date:'2026-04-10', ticker:'MSFT', type:'BUY',  shares:2,   price:400, currency:'USD', fees:0, notes:'added on the dip'},
  {date:'2025-11-20', ticker:'NVDA', type:'BUY',  shares:12,  price:120, currency:'USD', fees:0, notes:''},
  {date:'2026-08-01', ticker:'NVDA', type:'SELL', shares:3,   price:190, currency:'USD', fees:5, notes:'trimmed to band'},
  {date:'2026-03-01', ticker:'IONQ', type:'BUY',  shares:150, price:9,   currency:'USD', fees:0, notes:''},
  {date:'2026-02-01', ticker:'ZZZZ', type:'BUY',  shares:5,   price:50,  currency:'ILS', fees:0, notes:'broken on purpose'},
  // Bought and fully sold - should appear under closed positions only.
  {date:'2025-09-01', ticker:'AMD',  type:'BUY',  shares:10,  price:150, currency:'USD', fees:0, notes:''},
  {date:'2026-05-15', ticker:'AMD',  type:'SELL', shares:10,  price:120, currency:'USD', fees:8, notes:'thesis broke'}
];

var MOCK_META = {
  INTC: {riskTag:'growth',      notes:'18A turnaround'},
  MSFT: {riskTag:'core',        notes:''},
  NVDA: {riskTag:'growth',      notes:''},
  IONQ: {riskTag:'speculative', notes:''},
  ZZZZ: {riskTag:'speculative', notes:'broken on purpose'},
  AMD:  {riskTag:'growth',      notes:''}
};

var MOCK_WATCHLIST = [
  {ticker:'TSM',  addedDate:'2026-09-01', thesis:'The chokepoint', targetEntry:200},
  {ticker:'AVGO', addedDate:'2026-09-10', thesis:'Custom silicon', targetEntry:null}
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

function mockPositions() {
  return derivePositions_(MOCK_TRANSACTIONS, MOCK_META);
}

function mockDashboard() {
  var t0 = Date.now();
  var quotes = JSON.parse(JSON.stringify(MOCK_QUOTES));
  var positions = mockPositions();
  var pf = computePortfolio_(positions, quotes, MOCK_USDILS, mockSettings.displayCurrency);
  var wl = computeWatchlist_(MOCK_WATCHLIST, quotes, MOCK_USDILS, mockSettings.displayCurrency);
  var analytics = computeAnalytics_(pf.rows, mockSettings);
  return {
    positions: pf.rows, totals: pf.totals, watchlist: wl, analytics: analytics,
    closedPositions: getClosedPositions_(MOCK_TRANSACTIONS),
    realisedTotal: totalRealised_(MOCK_TRANSACTIONS),
    transactions: MOCK_TRANSACTIONS.slice().reverse(),
    settings: mockSettings, usdIls: MOCK_USDILS, riskTags: RISK_TAGS,
    fetchedAt: '2026-09-23 10:00 (MOCK)', elapsedMs: Date.now() - t0
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
        if (!MOCK_QUOTES[t]) {
          MOCK_QUOTES[t] = {ticker:t, name:null, price:null, changepct:null, high52:null,
                            low52:null, pe:null, eps:null, marketcap:null, beta:null,
                            currency:null, stale:true};
        }
        if (p.list === 'positions') {
          if (mockPositions().some(function (x) { return x.ticker === t; })) {
            return fail({message: t + ' is already in your portfolio.'});
          }
          MOCK_TRANSACTIONS.push({date:'2026-09-23', ticker:t, type:'BUY',
            shares:Number(p.shares), price:Number(p.avgCost),
            currency:p.costCurrency || 'USD', fees:0, notes:p.notes || ''});
          MOCK_META[t] = {riskTag:p.riskTag || 'growth', notes:p.notes || ''};
        } else {
          if (MOCK_WATCHLIST.some(function (r) { return r.ticker === t; })) {
            return fail({message: t + ' is already in your watchlist.'});
          }
          MOCK_WATCHLIST.push({ticker:t, addedDate:'2026-09-23', thesis:p.thesis || '',
            targetEntry:p.targetEntry ? Number(p.targetEntry) : null});
        }
        ok(mockDashboard());
      }, 150);
    },
    recordTransaction: function (p) {
      setTimeout(function () {
        var t = normalizeTicker(p.ticker);
        var shares = Number(p.shares);
        var price = Number(p.price);
        if (!isFinite(shares) || shares <= 0) return fail({message:'Shares must be a positive number.'});
        if (!isFinite(price) || price < 0) return fail({message:'Price must be zero or more.'});

        if (String(p.type).toUpperCase() === 'SELL') {
          var held = mockPositions().filter(function (x) { return x.ticker === t; })[0];
          if (!held) return fail({message:'You do not hold ' + t + ', so there is nothing to sell.'});
          if (shares > held.shares + 1e-9) {
            return fail({message:'You hold ' + held.shares + ' ' + t + ', so ' + shares + ' cannot be sold.'});
          }
        }
        MOCK_TRANSACTIONS.push({
          date: p.date || '2026-09-23', ticker: t,
          type: String(p.type).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
          shares: shares, price: price, currency: p.currency || 'USD',
          fees: Number(p.fees) || 0, notes: p.notes || ''
        });
        ok(mockDashboard());
      }, 150);
    },
    removeHolding: function (list, ticker) {
      setTimeout(function () {
        if (list === 'positions') {
          var before = MOCK_TRANSACTIONS.length;
          for (var i = MOCK_TRANSACTIONS.length - 1; i >= 0; i--) {
            if (MOCK_TRANSACTIONS[i].ticker === ticker) MOCK_TRANSACTIONS.splice(i, 1);
          }
          delete MOCK_META[ticker];
          if (before === MOCK_TRANSACTIONS.length) return fail({message: ticker + ' was not found.'});
        } else {
          var j = MOCK_WATCHLIST.findIndex(function (r) { return r.ticker === ticker; });
          if (j === -1) return fail({message: ticker + ' was not found.'});
          MOCK_WATCHLIST.splice(j, 1);
        }
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
