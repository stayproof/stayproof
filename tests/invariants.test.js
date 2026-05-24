const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  trustRating, computeAnomalyPenalty
} = require('../src/shared/scoring.js');

// ─── Invariants: Trust Rating Safety Net ────────────────────────────
//
// These tests lock the safety net: a hotel with severe cross-reference
// anomaly must ALWAYS produce a low trust score. This prevents formula
// changes from accidentally breaking the fake-review detection.

describe('invariants: severe anomaly produces trust < 5.0', () => {
  it('Booking 9.0, 300 reviews, Google 4.8 with 98% five-star histogram: trust < 5.0', () => {
    const result = trustRating(300, {
      rating: 4.8, reviewCount: 1000, histogram: [5, 5, 5, 5, 980]
    }, null, 9.0, 'booking');
    assert.ok(result.trust < 5.0,
      `severe anomaly trust must be < 5.0 (got ${result.trust})`);
    assert.ok(result.anomaly, 'anomaly should be detected');
  });
});

describe('invariants: no anomaly reflects high trust', () => {
  it('corroborating data: trust remains high', () => {
    // High review count with corroborating Google data
    const result = trustRating(600, {
      rating: 4.2, reviewCount: 500, histogram: [20, 30, 60, 150, 500]
    }, null, 8.6, 'booking');
    // Booking 8.6 → base ~8.5, no penalties, no anomaly
    assert.ok(result.trust >= 8.0,
      `corroborating data should produce trust >= 8.0 (got ${result.trust})`);
    assert.strictEqual(result.anomaly, false);
  });
});

// ─── Invariants: computeAnomalyPenalty Thresholds ───────────────────
//
// These tests lock the severity classification thresholds so formula
// changes don't accidentally shift the boundaries.

describe('invariants: computeAnomalyPenalty thresholds', () => {
  it('JSD < 0.01 with 200+ reviews is always "none"', () => {
    const result = computeAnomalyPenalty(0.005, 200);
    assert.strictEqual(result.severity, 'none',
      `JSD 0.005 with 200 reviews must be "none" (got "${result.severity}")`);
  });

  it('JSD > 0.06 with 200+ reviews is always "severe"', () => {
    const result = computeAnomalyPenalty(0.07, 200);
    assert.strictEqual(result.severity, 'severe',
      `JSD 0.07 with 200 reviews must be "severe" (got "${result.severity}")`);
  });

  it('below 50 reviews always returns "none" regardless of JSD', () => {
    const result = computeAnomalyPenalty(0.08, 40);
    assert.strictEqual(result.severity, 'none',
      `JSD 0.08 with only 40 reviews must be "none" (got "${result.severity}")`);
  });
});

// ─── Invariants: Clean Fake Detection (SHI HOUSE pattern) ───────────
//
// "Clean fakes" preserve the natural wedge shape but are impossibly
// concentrated at 5★. The four-star deficit detector catches these.

describe('invariants: clean fake pattern produces trust < 5.0', () => {
  it('SHI HOUSE pattern (94% five-star, 2.7% four-star, 371 reviews): trust < 5.0', () => {
    const result = trustRating(285, {
      rating: 4.9, reviewCount: 371, histogram: [5, 3, 3, 10, 350]
    }, null, 9.5, 'booking');
    assert.ok(result.trust < 5.0,
      `clean fake trust must be < 5.0 (got ${result.trust})`);
    assert.ok(result.anomaly, 'anomaly should be detected');
  });
});

describe('invariants: genuine luxury not flagged by four-star deficit', () => {
  it('Marina Bay Sands-like (75% five-star, 15% four-star, 62644 reviews): no anomaly', () => {
    // Real-world genuine luxury: Marina Bay Sands Singapore, 4.7★, 62644 reviews
    const result = trustRating(2000, {
      rating: 4.7, reviewCount: 62644, histogram: [1878, 1253, 3132, 9397, 46984]
    }, null, 9.5, 'booking');
    assert.strictEqual(result.anomaly, false,
      'genuine luxury hotel must not be flagged as anomaly');
  });
});
