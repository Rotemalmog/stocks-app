/**
 * Minimal test harness for the Apps Script backend.
 *
 * The .gs files are plain ES5 in a shared global scope, so they load cleanly
 * into a Node vm context with stubs for the Apps Script services. Only pure
 * logic is exercised here - anything touching SpreadsheetApp is out of scope
 * and covered by the browser harness in dev/ instead.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

/** Apps Script globals the source refers to. Stubbed, not emulated. */
function makeContext() {
  const logs = [];
  const ctx = {
    Logger: { log: (m) => logs.push(String(m)) },
    Utilities: {
      sleep: () => {},
      formatDate: (d) => d.toISOString().slice(0, 16).replace('T', ' ')
    },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
        setProperty: () => {}
      })
    },
    UrlFetchApp: { fetch: () => { throw new Error('network disabled in tests'); } },
    SpreadsheetApp: { flush: () => {} },
    CacheService: {
      getScriptCache: () => ({ get: () => null, put: () => {}, getAll: () => ({}), putAll: () => {} })
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} })
    },
    console,
    __logs: logs
  };
  vm.createContext(ctx);
  return ctx;
}

function load(files) {
  const ctx = makeContext();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try {
      vm.runInContext(code, ctx, { filename: f });
    } catch (e) {
      throw new Error(`Failed loading ${f}: ${e.message}`);
    }
  }
  return ctx;
}

/* ---------------- assertions ---------------- */

let passed = 0;
const failures = [];
let currentSuite = '';

function suite(name) { currentSuite = name; }

function check(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(`${currentSuite} :: ${label}${detail ? '\n      ' + detail : ''}`);
}

function eq(label, actual, expected) {
  check(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function near(label, actual, expected, tol) {
  const t = tol === undefined ? 1e-9 : tol;
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= t;
  check(label, ok, `expected ~${expected} (±${t}), got ${JSON.stringify(actual)}`);
}

function isTrue(label, v) { check(label, v === true, `got ${JSON.stringify(v)}`); }
function isNull(label, v) { check(label, v === null, `got ${JSON.stringify(v)}`); }

function report() {
  const total = passed + failures.length;
  if (failures.length) {
    console.log(`\n${failures.length} of ${total} checks FAILED:\n`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('');
    process.exit(1);
  }
  console.log(`\nAll ${total} checks passed.\n`);
}

module.exports = { load, suite, check, eq, near, isTrue, isNull, report };
