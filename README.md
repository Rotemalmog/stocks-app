# Stocks Portfolio Tracker

A private portfolio tracker built as a **Google Apps Script web app** with a
**Google Sheet as the database**. Real HTML UI, live prices, no API key, no
server, no build step, no hosting cost.

Phase 1 scope: **prices and analytics only.** Stock recommendations are Phase 2.

---

## Why this architecture

A plain static HTML page cannot call `GOOGLEFINANCE` — it is a spreadsheet
formula, not an API — so it would need a paid or keyed data provider. An Apps
Script web app serves real HTML/CSS/JS *and* has a Sheet behind it, so the Sheet
runs the `GOOGLEFINANCE` formulas and the front-end renders the results.

```
Browser (HTML/CSS/JS + Chart.js)
   ↕ google.script.run   (async RPC, one batched call per refresh)
Apps Script backend (.gs)
   ↕ SpreadsheetApp
Google Sheet  ──  _Quotes tab runs GOOGLEFINANCE()
```

## What it does

- **Live prices** for your positions and watchlist via `GOOGLEFINANCE`
- **`+ Add stock`** — writes straight to the Sheet, so it survives a refresh and
  is readable from any device. Accepts friendly names (`spacex` → `SPCX`,
  `dwave` → `QBTS`)
- **Positions table** — value, unrealised P&L in currency and percent, day
  change, portfolio weight
- **Two pie charts** — allocation by position, and by theme. The second is where
  concentration actually becomes visible
- **Watchlist**, kept visually separate from holdings
- **Risk panel** — concentration (largest, top-3, Herfindahl, effective holdings),
  a per-position bad-case drawdown model, Taiwan/China supply-chain exposure, and
  position size against its band
- **USD / ILS toggle** via `CURRENCY:USDILS`. Cost basis stays in the currency you
  entered it in and is converted only for display
- **Daily price snapshot** so history accumulates from day one

## Setup

1. **Create the Apps Script project** at <https://script.google.com> → New project.
2. **Push the code.** Either install [`clasp`](https://github.com/google/clasp):
   ```bash
   npm install -g @google/clasp
   clasp login
   cp .clasp.json.example .clasp.json   # paste your scriptId
   clasp push
   ```
   …or paste each file in `src/` into the editor by hand (`.gs` as script files,
   `styles.html` / `index.html` / `app.js.html` as HTML files named `styles`,
   `index` and `app.js`).
3. **Run `setup()`** once from the editor. It creates the spreadsheet and all
   tabs and stores the spreadsheet id in Script Properties.
   `getSpreadsheetUrl()` prints the link. The watchlist starts empty by design
   (see *Public repo* below) — add your tickers with the **+** button.
4. **Run `probeCoverage()`** — see below. Do this before trusting any ticker.
5. **Run `installDailyTrigger()`** to start accumulating price history.
6. **Deploy** → New deployment → Web app → *Execute as: Me*, *Who has access:
   Only myself*. Open the `/exec` URL. Works on a phone.

## Run `probeCoverage()` first

`GOOGLEFINANCE` coverage is unreliable for recent listings, so confirm your
symbols resolve before trusting any number.

With no argument, `probeCoverage()` probes whatever is actually in your
`Positions` and `Watchlist` tabs and reports the USD/ILS rate. Pass an array to
check specific symbols before adding them:

```js
probeCoverage(['SPCX'])   // a June 2026 listing - worth checking explicitly
```

`ZZZZ` is always appended and is *expected* to fail — it exercises the
stale-data path rather than indicating a problem.

Anything `GOOGLEFINANCE` cannot serve can still be added (the UI offers
"add it anyway"); it shows a `stale` pill and falls back to the last known price
from `History`.

## Known limitations

- **No historical backfill.** Google blocked historical `GOOGLEFINANCE` from Apps
  Script and the Sheets API in 2016 — those cells return `#N/A` to a script.
  `probeHistoricalBlocked()` demonstrates this. History therefore starts
  accumulating the day you run `installDailyTrigger()`. Over a 5-year horizon
  that is fine, but charts start empty rather than showing five years on day one.
- **Prices are delayed up to ~20 minutes.** Irrelevant at this horizon, and the
  reason no paid data feed is needed.
- **No fundamentals beyond P/E, EPS, market cap and beta.** `GOOGLEFINANCE`
  carries no dividends, revenue growth, free cash flow, ROIC or analyst targets.
  Phase 2 adds Finnhub (free tier, CORS-enabled) via `UrlFetchApp` for those,
  with the key in Script Properties — never in a cell, never in git.
- **Apps Script quotas:** 6 min per execution, 90 min/day on a consumer account.
  A ~60-ticker refresh fits comfortably; the Phase 2 screen will need to paginate.

## Local preview

The front-end can be developed without deploying. `dev/build_preview.py` inlines
the Apps Script includes and swaps in a mock RPC layer, but loads the **real**
`Config.gs`, `Quotes.gs`, `Portfolio.gs` and `Analytics.gs` — so the valuation,
weighting and risk maths under test are the same code that runs in production.
Only Sheet I/O is faked.

```bash
python dev/build_preview.py
python -m http.server 8000 --directory dev
# open http://localhost:8000/preview.html
```

The fixtures deliberately include a broken ticker (`ZZZZ`) and an ILS-denominated
cost basis to exercise the stale-data and FX paths.

## Design notes

Colours come from the `dataviz` skill's documented reference palette, used
unmodified and in slot order, so its published validation applies. The palette
validator itself is a Node script and Node is not installed on the machine this
was built on, so it was not re-run — re-running is required when you substitute
your own ramps, which has not been done here.

Pie charts are capped at 6 slices plus "Other" (part-to-whole reads at a glance
only up to ~6 segments), every slice is value-labelled in the legend so identity
never rests on colour alone, slices carry a 2px surface gap, and the positions
table serves as the table view. Dark mode is a selected set of steps for the dark
surface, not an automatic flip.

## Public repo

This repository is public, so it deliberately contains **no personal financial
data**. Positions, cost basis and watchlist all live in your private Google
Sheet, never in git. `SEED_WATCHLIST` is empty and `probeCoverage()` reads from
the Sheet rather than hardcoding symbols, so the code does not disclose what its
owner follows. The demo fixtures in `dev/` are generic and invented.

The ticker maps in `Config.gs` (themes, Taiwan exposure, aliases, suggested risk
tags) are general reference data covering ~60 symbols and say nothing about any
particular holding.

## Not financial advice

This tool reports metrics and flags risks. It does not predict prices. The
drawdown percentages are deliberately pessimistic modelling assumptions, not
forecasts — a speculative unprofitable name is modelled at an 85% loss because
that is roughly what the quantum and pre-revenue tech complex actually did in
2022. Nothing here accounts for your age, income, tax position or other assets.
