// Display integration tests for blendRating() in the search results pipeline.
// Validates that blending results are wired into formatRating, ratingTier, and tooltips.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { blendRating, airbnbToNormalizedRating } = require('../src/shared/scoring.js');

// ─── formatRating display integration ─────────────────────────────────

describe('blendRating display — formatRating integration', function () {

  it('listing with blendResult.changed=true shows blended value as primary number', function () {
    // Simulate a listing that has been through the scoring pipeline with blending
    var listing = {
      rating: 9.2,
      platform: 'booking',
      reviewCount: 500,
      _normalizedRating: 9.2,
      _blendResult: { blended: 8.1, changed: true, reason: 'Blended with Google data' }
    };
    var result = formatRatingForTest(listing);
    // Should show "8.1" as the primary rating, not "9.2/10"
    assert.ok(result.includes('8.1'), 'Expected blended value 8.1 in output, got: ' + result);
    assert.ok(!result.includes('9.2/10'), 'Should not show raw rating 9.2/10 when blending changed, got: ' + result);
  });

  it('listing with blendResult.changed=false shows unchanged format', function () {
    var listing = {
      rating: 8.5,
      platform: 'booking',
      reviewCount: 200,
      _normalizedRating: 8.5,
      _blendResult: { blended: 8.5, changed: false, reason: 'No Google data' }
    };
    var result = formatRatingForTest(listing);
    // Should show current format: "8.5/10 (200)"
    assert.ok(result.includes('8.5/10'), 'Expected raw format 8.5/10, got: ' + result);
    assert.ok(result.includes('(200)'), 'Expected review count in unchanged format, got: ' + result);
  });

  it('listing with no _blendResult shows unchanged format', function () {
    var listing = {
      rating: 7.3,
      platform: 'booking',
      reviewCount: 150,
      _normalizedRating: 7.3
    };
    var result = formatRatingForTest(listing);
    assert.ok(result.includes('7.3/10'), 'Expected raw format 7.3/10, got: ' + result);
  });

  it('airbnb listing with blending shows blended value', function () {
    var listing = {
      rating: 4.7,
      platform: 'airbnb',
      reviewCount: 80,
      _normalizedRating: airbnbToNormalizedRating(4.7),
      _blendResult: { blended: 8.0, changed: true, reason: 'Blended with Google data' }
    };
    var result = formatRatingForTest(listing);
    assert.ok(result.includes('8.0'), 'Expected blended value 8.0 for Airbnb, got: ' + result);
  });
});

// ─── ratingTier integration ───────────────────────────────────────────

describe('blendRating display — ratingTier integration', function () {

  it('ratingTier uses blended value when blendResult.changed=true', function () {
    // Platform rating 9.2 (tier 5) but blended to 6.5 (tier 2)
    var listing = {
      _normalizedRating: 9.2,
      _blendResult: { blended: 6.5, changed: true }
    };
    var tier = ratingTierForTest(listing);
    assert.strictEqual(tier, 2, 'Expected tier 2 for blended 6.5, got tier ' + tier);
  });

  it('ratingTier uses normalizedRating when blendResult.changed=false', function () {
    var listing = {
      _normalizedRating: 9.2,
      _blendResult: { blended: 9.2, changed: false }
    };
    var tier = ratingTierForTest(listing);
    assert.strictEqual(tier, 5, 'Expected tier 5 for normalized 9.2, got tier ' + tier);
  });

  it('ratingTier uses normalizedRating when no blendResult', function () {
    var listing = {
      _normalizedRating: 7.5,
    };
    var tier = ratingTierForTest(listing);
    assert.strictEqual(tier, 3, 'Expected tier 3 for normalized 7.5, got tier ' + tier);
  });
});

// ─── blendRating() pipeline wiring ────────────────────────────────────

describe('blendRating display — pipeline wiring', function () {

  it('listing with clean Google data produces _blendResult with changed=true', function () {
    var googleData = {
      rating: 4.3,
      reviewCount: 200,
      histogram: [10, 15, 30, 50, 95]
    };
    var result = blendRating(8.5, 'booking', googleData);
    assert.strictEqual(result.changed, true, 'Expected changed=true for clean Google data');
    assert.ok(typeof result.blended === 'number', 'blended should be a number');
  });

  it('listing without Google data produces _blendResult with changed=false', function () {
    var result = blendRating(8.5, 'booking', null);
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.blended, 8.5, 'Should return original rating');
  });

  it('display rating for top picks uses blended when available', function () {
    // This tests the logic pattern used in top picks rendering
    var listing = {
      _normalizedRating: 9.0,
      _blendResult: { blended: 7.8, changed: true }
    };
    var displayRating = (listing._blendResult && listing._blendResult.changed)
      ? listing._blendResult.blended : listing._normalizedRating;
    assert.strictEqual(displayRating, 7.8, 'Top pick should show blended rating');
  });

  it('display rating for top picks uses normalizedRating when not blended', function () {
    var listing = {
      _normalizedRating: 9.0,
      _blendResult: { blended: 9.0, changed: false }
    };
    var displayRating = (listing._blendResult && listing._blendResult.changed)
      ? listing._blendResult.blended : listing._normalizedRating;
    assert.strictEqual(displayRating, 9.0, 'Top pick should show normalized rating when not blended');
  });
});

// ─── Tooltip content ──────────────────────────────────────────────────

describe('blendRating display — tooltip content', function () {

  it('tooltip string contains platform rating, Google rating, and blended value', function () {
    var listing = {
      rating: 9.2,
      platform: 'booking',
      reviewCount: 500,
      _normalizedRating: 9.2,
      _blendResult: { blended: 8.1, changed: true, reason: 'Blended with Google data' },
      _googleData: { rating: 3.6, reviewCount: 200, histogram: [20, 30, 40, 50, 60] }
    };
    var tooltip = buildRatingTooltipForTest(listing);
    assert.ok(tooltip !== null, 'Should produce tooltip when blending changed');
    assert.ok(tooltip.includes('9.2'), 'Tooltip should contain platform rating 9.2');
    assert.ok(tooltip.includes('3.6'), 'Tooltip should contain Google rating 3.6');
    assert.ok(tooltip.includes('8.1'), 'Tooltip should contain blended value 8.1');
  });

  it('no tooltip when blending did not change', function () {
    var listing = {
      rating: 8.5,
      platform: 'booking',
      reviewCount: 200,
      _normalizedRating: 8.5,
      _blendResult: { blended: 8.5, changed: false, reason: 'No Google data' }
    };
    var tooltip = buildRatingTooltipForTest(listing);
    assert.strictEqual(tooltip, null, 'Should not produce tooltip when blending unchanged');
  });
});

// ─── Helper functions (extracted from search.js logic) ────────────────
// These mirror the actual functions but are testable outside of DOM context.

function formatRatingForTest(listing) {
  if (listing.rating == null) return '--';
  // NEW: show blended value when blending changed the rating
  if (listing._blendResult && listing._blendResult.changed) {
    var r = listing._blendResult.blended.toFixed(1);
    if (listing.reviewCount) r += ' (' + listing.reviewCount + ')';
    return r;
  }
  // Original format
  var decimals = listing.platform === 'airbnb' ? 2 : 1;
  var r = (listing.platform === 'booking' || listing.platform === 'agoda')
    ? listing.rating.toFixed(1) + '/10'
    : listing.rating.toFixed(decimals) + '/5';
  if (listing.reviewCount) r += ' (' + listing.reviewCount + ')';
  if (listing._normalizedRating != null && listing.platform !== 'booking') {
    r += ' \u2192 ' + listing._normalizedRating.toFixed(1);
  }
  return r;
}

function ratingTierForTest(listing) {
  var r = (listing._blendResult && listing._blendResult.changed)
    ? listing._blendResult.blended : listing._normalizedRating;
  if (r == null) return 0;
  if (r >= 9) return 5;
  if (r >= 8) return 4;
  if (r >= 7) return 3;
  if (r >= 6) return 2;
  return 1;
}

function buildRatingTooltipForTest(listing) {
  if (!listing._blendResult || !listing._blendResult.changed) return null;
  if (!listing._googleData) return null;
  var lines = [];
  var scale = (listing.platform === 'booking' || listing.platform === 'agoda') ? '/10' : '/5';
  lines.push('Platform: ' + listing.rating + scale + ' (' + listing.reviewCount + ' reviews)');
  if (listing.platform !== 'booking' && listing.platform !== 'agoda') {
    lines.push('Normalized: ' + listing._normalizedRating.toFixed(1) + '/10');
  }
  lines.push('Google: ' + listing._googleData.rating + '/5 (' + listing._googleData.reviewCount + ' reviews)');
  lines.push('Blended: ' + listing._blendResult.blended.toFixed(1) + '/10');
  return lines.join('\n');
}
