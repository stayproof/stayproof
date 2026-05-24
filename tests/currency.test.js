const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  CURRENCY_MAP,
  TIMEZONE_CURRENCY_MAP,
  CURRENCY_SYMBOLS,
  CURRENCY_NAMES,
  getCurrencySymbol,
  getCurrencyName,
} = require('../src/shared/currency.js');

// Parity invariant: every currency code that detection can return must have a
// matching CURRENCY_SYMBOLS and CURRENCY_NAMES entry. The dropdown, Top Picks,
// map popups and price labels all read from these maps — drift would silently
// degrade the UI.

describe('currency map parity', () => {
  it('every CURRENCY_MAP value has a matching CURRENCY_SYMBOLS entry', () => {
    var missing = [];
    Object.values(CURRENCY_MAP).forEach((code) => {
      if (!CURRENCY_SYMBOLS[code]) missing.push(code);
    });
    assert.deepEqual(missing, [], 'CURRENCY_SYMBOLS missing entries: ' + missing.join(', '));
  });

  it('every CURRENCY_MAP value has a matching CURRENCY_NAMES entry', () => {
    var missing = [];
    Object.values(CURRENCY_MAP).forEach((code) => {
      if (!CURRENCY_NAMES[code]) missing.push(code);
    });
    assert.deepEqual(missing, [], 'CURRENCY_NAMES missing entries: ' + missing.join(', '));
  });

  it('every TIMEZONE_CURRENCY_MAP value has a matching CURRENCY_SYMBOLS entry', () => {
    var missing = [];
    Object.values(TIMEZONE_CURRENCY_MAP).forEach((code) => {
      if (!CURRENCY_SYMBOLS[code]) missing.push(code);
    });
    // Timezone map can hit codes the region map doesn't (e.g. RUB) — flag drift.
    assert.deepEqual(missing, [], 'CURRENCY_SYMBOLS missing entries (from timezone map): ' + missing.join(', '));
  });

  it('every TIMEZONE_CURRENCY_MAP value has a matching CURRENCY_NAMES entry', () => {
    var missing = [];
    Object.values(TIMEZONE_CURRENCY_MAP).forEach((code) => {
      if (!CURRENCY_NAMES[code]) missing.push(code);
    });
    assert.deepEqual(missing, [], 'CURRENCY_NAMES missing entries (from timezone map): ' + missing.join(', '));
  });

  it('CURRENCY_SYMBOLS and CURRENCY_NAMES have the same key set', () => {
    var symKeys = Object.keys(CURRENCY_SYMBOLS).sort();
    var nameKeys = Object.keys(CURRENCY_NAMES).sort();
    assert.deepEqual(symKeys, nameKeys, 'symbol/name maps drifted apart');
  });
});

describe('getCurrencySymbol', () => {
  it('returns curated symbol for IDR (the bug that motivated the curated map)', () => {
    // Intl.NumberFormat in en-* locales returns 'IDR' for IDR; the curated map
    // returns 'Rp'. The whole point of CURRENCY_SYMBOLS is to win this lookup.
    assert.equal(getCurrencySymbol('IDR'), 'Rp');
  });

  it('returns curated symbol for known codes', () => {
    assert.equal(getCurrencySymbol('USD'), '$');
    assert.equal(getCurrencySymbol('GBP'), '£');
    assert.equal(getCurrencySymbol('PHP'), '₱');
    assert.equal(getCurrencySymbol('SGD'), 'S$');
  });

  it('falls back to the code itself for unknown currencies', () => {
    // Pick a code that's neither in CURRENCY_SYMBOLS nor recognized by Intl
    // for a usable symbol. 'XXX' is the ISO 4217 "no currency" code.
    var result = getCurrencySymbol('XXX');
    // Either Intl returns 'XXX' itself, or our final fallback returns 'XXX'.
    assert.equal(result, 'XXX');
  });

  it('returns "$" for empty / null input', () => {
    assert.equal(getCurrencySymbol(''), '$');
    assert.equal(getCurrencySymbol(null), '$');
    assert.equal(getCurrencySymbol(undefined), '$');
  });
});

describe('getCurrencyName', () => {
  it('returns the human-readable name', () => {
    assert.equal(getCurrencyName('IDR'), 'Indonesian Rupiah');
    assert.equal(getCurrencyName('GBP'), 'British Pound');
    assert.equal(getCurrencyName('PHP'), 'Philippine Peso');
  });

  it('falls back to the code for unknown currencies', () => {
    assert.equal(getCurrencyName('XXX'), 'XXX');
  });

  it('returns empty string for empty input', () => {
    assert.equal(getCurrencyName(''), '');
    assert.equal(getCurrencyName(null), '');
  });
});
