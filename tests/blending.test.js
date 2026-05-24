// RED phase — these tests define blendRating() contract for Phase 41.
// All tests MUST FAIL until blendRating() is implemented in src/shared/scoring.js.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { blendRating, airbnbToNormalizedRating, agodaToNormalizedRating } = require('../src/shared/scoring.js');

const hotels = require('./fixtures/blending-hotels.js');

function assertApprox(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message} (expected ~${expected}, got ${actual.toFixed(4)})`);
}

function findHotel(name) {
  var h = hotels.find(function (x) { return x.name === name; });
  if (!h) throw new Error('Fixture not found: ' + name);
  return h;
}

// ─── Golden cases ───────────────────────────────────────────────────

describe('blendRating — golden cases', function () {
  it('MIICO HOTEL: blended is meaningfully below 9.0 (downward pull from 3.6 Google)', function () {
    var h = findHotel('MIICO HOTEL');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.ok(result.blended < 9.0,
      'Expected blended < 9.0, got ' + result.blended);
  });

  it('MIICO HOTEL: changed flag is true', function () {
    var h = findHotel('MIICO HOTEL');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.strictEqual(result.changed, true);
  });

  it('MIICO HOTEL: blended is not an extreme overcorrection (> 5.0)', function () {
    var h = findHotel('MIICO HOTEL');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.ok(result.blended > 5.0,
      'Expected blended > 5.0 (not overcorrected), got ' + result.blended);
  });

  it('Grand Hyatt: blended is close to 8.6 (within 0.5 — ratings roughly agree)', function () {
    var h = findHotel('Grand Hyatt');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assertApprox(result.blended, 8.6, 0.5, 'Grand Hyatt blended');
  });
});

// ─── Edge cases: no blending ────────────────────────────────────────

describe('blendRating — edge cases: no blending', function () {
  it('No Google data (null crossRef): returns platform rating unchanged', function () {
    var h = findHotel('No Google Data');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.strictEqual(result.blended, h.platformRating);
    assert.strictEqual(result.changed, false);
  });

  it('No histogram but sufficient reviews: blends (pulls down)', function () {
    var h = findHotel('Google No Histogram');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.strictEqual(result.changed, true);
    assert.ok(result.blended < h.platformRating,
      'Expected blended < ' + h.platformRating + ', got ' + result.blended);
    assert.ok(result.blended >= 7.5 && result.blended <= 8.7,
      'Expected blended in [7.5, 8.7], got ' + result.blended);
  });

  it('No histogram but too few reviews: returns platform rating unchanged', function () {
    var h = findHotel('Google No Histogram Low Reviews');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.strictEqual(result.blended, h.platformRating);
    assert.strictEqual(result.changed, false);
  });

  it('MIICO with null histogram still blends', function () {
    var result = blendRating(9.0, 'agoda', { rating: 3.6, reviewCount: 39, histogram: null });
    assert.strictEqual(result.changed, true);
    assert.ok(result.blended < 9.0,
      'Expected blended < 9.0, got ' + result.blended);
  });

  it('Anomalous Google histogram: still blends (does not block)', function () {
    var h = findHotel('Anomalous Google');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.strictEqual(result.changed, true);
    assert.ok(result.blended >= h.expected.blendedRange[0] && result.blended <= h.expected.blendedRange[1],
      'Blended ' + result.blended + ' should be in range ' + h.expected.blendedRange);
  });

  it('Low Google reviews (< 50): returns platform rating unchanged', function () {
    var h = findHotel('Low Google Reviews');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.strictEqual(result.blended, h.platformRating);
    assert.strictEqual(result.changed, false);
  });
});

// ─── Agreement cases ────────────────────────────────────────────────

describe('blendRating — agreement cases', function () {
  it('Google agrees with platform: change is less than 0.3 points', function () {
    var h = findHotel('Google Agrees');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.ok(Math.abs(result.blended - h.platformRating) < 0.3,
      'Expected change < 0.3, got ' + Math.abs(result.blended - h.platformRating).toFixed(4));
  });

  it('Budget Gem (nearly identical ratings): change is minimal', function () {
    var h = findHotel('Budget Gem');
    var result = blendRating(h.platformRating, h.platform, h.google);
    assert.ok(Math.abs(result.blended - h.platformRating) < 0.3,
      'Expected minimal change for Budget Gem, got ' + Math.abs(result.blended - h.platformRating).toFixed(4));
  });
});

// ─── Credibility weighting ──────────────────────────────────────────

describe('blendRating — credibility weighting', function () {
  it('more Google reviews at same rating should pull harder than fewer reviews', function () {
    // MIICO has 39 Google reviews at 3.6 — compare with hypothetical 500 reviews at same rating
    var h = findHotel('MIICO HOTEL');
    var resultFew = blendRating(h.platformRating, h.platform, h.google);

    var manyReviewsCrossRef = {
      rating: h.google.rating,
      reviewCount: 500,
      histogram: [100, 65, 75, 100, 160],
    };
    var resultMany = blendRating(h.platformRating, h.platform, manyReviewsCrossRef);

    // With 500 reviews, the pull should be stronger (blended further from platform rating)
    var pullFew = Math.abs(h.platformRating - resultFew.blended);
    var pullMany = Math.abs(h.platformRating - resultMany.blended);
    assert.ok(pullMany > pullFew,
      'Expected 500 reviews to pull harder than 39 (pullMany=' + pullMany.toFixed(4) + ', pullFew=' + pullFew.toFixed(4) + ')');
  });
});

// ─── Asymmetric clamp ───────────────────────────────────────────────
// Google Maps cross-reference can only REDUCE a platform rating, never inflate it.
// Rationale: Booking/Agoda/Airbnb are verified-stay platforms (trustworthy floor).
// Google reviews are unverified — downward pull surfaces anomalies (informative),
// upward push would misrepresent verified-stay quality.

describe('blendRating — asymmetric clamp', function () {
  it('Booking + Google pulls UP is clamped to platform rating', function () {
    // Booking 7.0, Google 4.8 (normalized 9.6), 200 reviews — plenty to trigger blend
    var result = blendRating(7.0, 'booking', { rating: 4.8, reviewCount: 200, histogram: [10, 10, 20, 40, 120] });
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.blended, 7.0,
      'Google higher than platform must be clamped to platform rating (expected 7.0, got ' + result.blended + ')');
  });

  it('Agoda + Google pulls UP is clamped to normalized Agoda rating', function () {
    // Agoda 9.0, Google 4.9 (normalized 9.8), 300 reviews
    var result = blendRating(9.0, 'agoda', { rating: 4.9, reviewCount: 300, histogram: [5, 5, 15, 50, 225] });
    var normPlatform = agodaToNormalizedRating(9.0);
    assert.strictEqual(result.changed, true);
    assert.ok(result.blended <= Math.round(normPlatform * 10) / 10 + 0.001,
      'Expected blended <= normalized Agoda ' + normPlatform + ', got ' + result.blended);
    assert.ok(result.blended <= normPlatform + 0.05,
      'Sanity: blended within rounding tolerance of clamp, got ' + result.blended);
  });

  it('Airbnb + Google pulls UP is clamped to normalized Airbnb rating', function () {
    // Airbnb 4.9, Google 5.0 (normalized 10.0), 500 reviews
    var result = blendRating(4.9, 'airbnb', { rating: 5.0, reviewCount: 500, histogram: [0, 0, 5, 20, 475] });
    var normPlatform = airbnbToNormalizedRating(4.9);
    assert.strictEqual(result.changed, true);
    assert.ok(result.blended <= normPlatform + 0.05,
      'Expected blended <= normalized Airbnb ' + normPlatform + ' (+0.05 tol), got ' + result.blended);
  });

  it('Google pulls DOWN still works (no accidental symmetry)', function () {
    // Booking 9.5, Google 3.5 (normalized 7.0), 300 reviews
    var result = blendRating(9.5, 'booking', { rating: 3.5, reviewCount: 300, histogram: [80, 70, 60, 50, 40] });
    assert.strictEqual(result.changed, true);
    assert.ok(result.blended < 9.5,
      'Google lower than platform must pull down (expected < 9.5, got ' + result.blended + ')');
    assert.ok(result.blended > 7.0,
      'Blended must stay above raw Google (expected > 7.0, got ' + result.blended + ')');
  });

  it('Google EQUAL to platform is effectively a no-op', function () {
    // Booking 8.0, Google 4.0 (normalized 8.0), 300 reviews
    var result = blendRating(8.0, 'booking', { rating: 4.0, reviewCount: 300, histogram: [20, 30, 80, 100, 70] });
    assert.strictEqual(result.changed, true);
    assert.ok(Math.abs(result.blended - 8.0) < 0.1,
      'Expected blended ~= 8.0 when Google equals platform, got ' + result.blended);
  });
});
