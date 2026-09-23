# Tests

```bash
node test/run.js
```

82 checks over the pure logic: ticker normalisation, cell coercion, valuation
and P&L, currency conversion, stale-quote handling, theme and Taiwan
classification, concentration and drawdown analytics, the thesis-review
trigger, metric banding, strategy scoring, coverage reporting and the
profitability gate.

`test/harness.js` loads the real `.gs` files into a Node `vm` context with
stubbed Apps Script services. Only pure logic is covered here — anything
touching `SpreadsheetApp` is exercised by the browser harness in `dev/`
instead.

## Keeping the suite honest

A suite that cannot fail is worthless. Both of these mutations are caught:

| Mutation | Expected failure |
|---|---|
| `var CAP = 50` → `999` in `profitabilityGate_` | 3 checks fail — gate no longer applies |
| `q.changepct / 100` → `q.changepct` in `Portfolio.gs` | 1 check fails — day change off by 100x |

Re-run that check after any significant change to the scoring model.
