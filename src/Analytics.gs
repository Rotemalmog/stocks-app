/**
 * Analytics.gs — concentration, exposure and drawdown survivability.
 *
 * This answers "is my portfolio survivable?", which is a separate question
 * from "is this a good business?". Keeping them apart is deliberate: merging
 * them is how concentration gets rationalised.
 */

function computeAnalytics_(rows, settings) {
  var weights = rows.map(function (r) { return r.weight; }).sort(function (a, b) { return b - a; });

  var hhi = weights.reduce(function (a, w) { return a + w * w; }, 0);
  var top1 = weights[0] || 0;
  var top3 = weights.slice(0, 3).reduce(function (a, w) { return a + w; }, 0);

  return {
    concentration: {
      topWeight: top1,
      top3Weight: top3,
      hhi: hhi,
      // 1/HHI: how many equally-sized positions this portfolio behaves like.
      effectiveHoldings: hhi > 0 ? 1 / hhi : 0,
      positionCount: rows.length
    },
    themes: bucket_(rows, function (r) { return r.theme; }),
    taiwan: bucket_(rows, function (r) { return r.taiwan; }).map(function (b) {
      b.label = TAIWAN_LABELS[b.key] || b.key;
      return b;
    }),
    drawdown: drawdownModel_(rows, settings),
    bands: bandCheck_(rows),
    warnings: buildWarnings_(rows, settings, top1, top3)
  };
}

function bucket_(rows, keyFn) {
  var map = {};
  rows.forEach(function (r) {
    var k = keyFn(r);
    if (!map[k]) map[k] = { key: k, weight: 0, tickers: [] };
    map[k].weight += r.weight;
    map[k].tickers.push(r.ticker);
  });
  return Object.keys(map)
    .map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.weight - a.weight; });
}

/**
 * Model a bad-case drawdown by weighting each position's plausible single-name
 * loss. A 3% speculative position losing 85% costs 2.55% of the portfolio; the
 * same name at 20% costs 17%. Position size, not stock choice, is what keeps
 * the total inside the tolerance.
 */
function drawdownModel_(rows, settings) {
  var contributions = rows.map(function (r) {
    var dd = RISK_TAGS[r.riskTag].drawdown;
    return {
      ticker: r.ticker,
      riskTag: r.riskTag,
      weight: r.weight,
      assumedDrawdown: dd,
      contribution: r.weight * dd
    };
  }).sort(function (a, b) { return b.contribution - a.contribution; });

  var modelled = contributions.reduce(function (a, c) { return a + c.contribution; }, 0);

  return {
    modelledDrawdown: modelled,
    tolerance: settings.drawdownTolerance,
    withinTolerance: modelled <= settings.drawdownTolerance,
    contributions: contributions
  };
}

/** Compare each position's weight against the band for its risk tag. */
function bandCheck_(rows) {
  return rows.map(function (r) {
    var band = RISK_TAGS[r.riskTag];
    var status = 'ok';
    if (r.weight > band.bandMax) status = 'over';
    else if (r.weight < band.bandMin) status = 'under';
    return {
      ticker: r.ticker,
      riskTag: r.riskTag,
      weight: r.weight,
      bandMin: band.bandMin,
      bandMax: band.bandMax,
      status: status,
      // The rebalancing rule: trim anything more than 5 points over its band.
      trimSuggested: r.weight > band.bandMax + 0.05
    };
  });
}

function buildWarnings_(rows, settings, top1, top3) {
  var w = [];

  if (!rows.length) return w;

  if (top1 > settings.maxSinglePositionPct) {
    w.push({
      level: 'warn',
      text: 'Largest position is ' + pct_(top1) + ' of the portfolio, above the ' +
            pct_(settings.maxSinglePositionPct) + ' limit in Settings.'
    });
  }

  if (top3 > settings.maxTop3Pct) {
    w.push({
      level: 'warn',
      text: 'Top 3 positions are ' + pct_(top3) + ' of the portfolio, above the ' +
            pct_(settings.maxTop3Pct) + ' limit in Settings.'
    });
  }

  var dd = drawdownModel_(rows, settings);
  if (!dd.withinTolerance) {
    w.push({
      level: 'danger',
      text: 'Modelled bad-case drawdown is ' + pct_(dd.modelledDrawdown) +
            ', beyond your ' + pct_(dd.tolerance) + ' tolerance. ' +
            'Largest contributor: ' + dd.contributions[0].ticker +
            ' (' + pct_(dd.contributions[0].contribution) + ' of it).'
    });
  }

  bandCheck_(rows).forEach(function (b) {
    if (b.trimSuggested) {
      w.push({
        level: 'warn',
        text: b.ticker + ' is ' + pct_(b.weight) + ', more than 5 points above the ' +
              pct_(b.bandMax) + ' ceiling for a ' + b.riskTag + ' position. Rebalancing rule says trim.'
      });
    }
  });

  var themes = bucket_(rows, function (r) { return r.theme; });
  if (themes.length && themes[0].weight > 0.5) {
    w.push({
      level: 'warn',
      text: pct_(themes[0].weight) + ' of the portfolio sits in a single theme (' +
            themes[0].key + '). These names largely move together, so the ' +
            'diversification is smaller than the position count suggests.'
    });
  }

  var tw = bucket_(rows, function (r) { return r.taiwan; });
  var high = tw.filter(function (b) { return b.key === 'high' || b.key === 'direct'; })
               .reduce(function (a, b) { return a + b.weight; }, 0);
  if (high > 0.3) {
    w.push({
      level: 'info',
      text: pct_(high) + ' of the portfolio depends on Taiwanese leading-edge ' +
            'manufacturing with no viable alternative foundry.'
    });
  }

  var unknown = tw.filter(function (b) { return b.key === 'unknown'; })
                  .reduce(function (a, b) { return a + b.weight; }, 0);
  if (unknown > 0.001) {
    w.push({
      level: 'info',
      text: pct_(unknown) + ' of the portfolio is unclassified for supply-chain ' +
            'exposure — treat it as unknown, not as safe.'
    });
  }

  // Research convention: revisit the thesis when a position is ~20% below
  // cost. The point is not to sell - it is to force the question "has
  // something actually changed?" while it is still a small decision.
  rows.forEach(function (r) {
    if (r.pnlPct === null || r.pnlPct > THESIS_REVIEW_DRAWDOWN) return;
    w.push({
      level: 'warn',
      text: r.ticker + ' is ' + pct_(r.pnlPct) + ' below your cost basis. ' +
            'Re-read why you bought it: has the thesis broken, or only the price?'
    });
  });

  var stale = rows.filter(function (r) { return r.stale; });
  if (stale.length) {
    w.push({
      level: 'danger',
      text: 'No live price for: ' + stale.map(function (r) { return r.ticker; }).join(', ') +
            '. GOOGLEFINANCE returned #N/A. Figures shown use the last known price where available.'
    });
  }

  return w;
}

function pct_(v) {
  if (v === null || v === undefined || isNaN(v)) return 'n/a';
  return (v * 100).toFixed(1) + '%';
}
