var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var { SCORING_CONFIG } = require('../src/shared/scoring-config.js');

// ── Pure functions (copied from src/search/search.js — must stay in sync) ──
// search.js is not a module, so we duplicate the pure logic here for testing.

function getListingTier(listing) {
  if ((listing.platform === 'booking' || listing.platform === 'agoda') && listing.reviewCount < 20) return 2;
  if (listing._anomaly) return 1;
  return 0;
}

function applyRatingFloor(listings, requestedFloor) {
  var floor = requestedFloor;
  var passed;
  while (floor > SCORING_CONFIG.RATING_FLOOR.MIN_FLOOR) {
    passed = listings.filter(function (l) {
      return l._normalizedRating != null && l._normalizedRating >= floor;
    });
    if (passed.length >= SCORING_CONFIG.RATING_FLOOR.MIN_RESULTS) {
      return { filtered: passed, effectiveFloor: floor, relaxed: floor < requestedFloor };
    }
    floor -= SCORING_CONFIG.RATING_FLOOR.STEP;
  }
  return { filtered: listings, effectiveFloor: 0, relaxed: requestedFloor > 0 };
}

function selectTopPicks(listings) {
  var tier0 = listings.filter(function (l) {
    return getListingTier(l) === 0 && l._normalizedRating != null && l._pricePerNight != null;
  });
  if (tier0.length < 3) return [];
  var picks = [];
  // Best Overall: highest _compositeScore (balanced across all signals)
  var bestOverall = tier0.slice().sort(function (a, b) {
    return (b._compositeScore || 0) - (a._compositeScore || 0);
  })[0];
  picks.push({ listing: bestOverall, label: 'Best Overall' });
  // Best Rated: highest _normalizedRating (pure quality, regardless of price)
  var bestRated = tier0.slice().sort(function (a, b) {
    return b._normalizedRating - a._normalizedRating;
  })[0];
  if (bestRated !== bestOverall) {
    picks.push({ listing: bestRated, label: 'Best Rated' });
  }
  // Best Value: lowest _pricePerNight among well-rated
  var wellRated = tier0.filter(function (l) {
    return l._normalizedRating >= SCORING_CONFIG.RATING_FLOOR.DEFAULT;
  });
  if (wellRated.length > 0) {
    var bestValue = wellRated.slice().sort(function (a, b) {
      return a._pricePerNight - b._pricePerNight;
    })[0];
    var isDuplicate = picks.some(function (p) { return p.listing === bestValue; });
    if (!isDuplicate) {
      picks.push({ listing: bestValue, label: 'Best Value' });
    }
  }
  return picks;
}

// ── Test data helpers ──

function makeListing(overrides) {
  return Object.assign({
    name: 'Hotel Test',
    platform: 'booking',
    reviewCount: 100,
    url: 'https://example.com',
    _normalizedRating: 8.5,
    _pricePerNight: 60,
    _compositeScore: 70,
    _anomaly: null,
  }, overrides);
}

function makeListings10() {
  return [
    makeListing({ name: 'A', _normalizedRating: 9.5 }),
    makeListing({ name: 'B', _normalizedRating: 9.0 }),
    makeListing({ name: 'C', _normalizedRating: 8.5 }),
    makeListing({ name: 'D', _normalizedRating: 8.0 }),
    makeListing({ name: 'E', _normalizedRating: 8.0 }),
    makeListing({ name: 'F', _normalizedRating: 7.5 }),
    makeListing({ name: 'G', _normalizedRating: 7.0 }),
    makeListing({ name: 'H', _normalizedRating: 7.0 }),
    makeListing({ name: 'I', _normalizedRating: 6.5 }),
    makeListing({ name: 'J', _normalizedRating: 6.0 }),
  ];
}

// ── applyRatingFloor ──────────────────────────────────────────────────

describe('applyRatingFloor', function () {
  it('FILT-01: returns only listings with _normalizedRating >= 8.0 by default', function () {
    var listings = makeListings10();
    var result = applyRatingFloor(listings, SCORING_CONFIG.RATING_FLOOR.DEFAULT);
    assert.strictEqual(result.filtered.length, 5); // A(9.5), B(9.0), C(8.5), D(8.0), E(8.0)
    result.filtered.forEach(function (l) {
      assert.ok(l._normalizedRating >= 8.0, l.name + ' rating ' + l._normalizedRating + ' should be >= 8.0');
    });
    assert.strictEqual(result.effectiveFloor, 8.0);
    assert.strictEqual(result.relaxed, false);
  });

  it('FILT-01: filters on _normalizedRating so Airbnb listings pass if normalized >= 8.0', function () {
    var listings = [
      makeListing({ name: 'Airbnb High', platform: 'airbnb', _normalizedRating: 8.5 }),
      makeListing({ name: 'Airbnb Low', platform: 'airbnb', _normalizedRating: 7.0 }),
      makeListing({ name: 'Booking OK', _normalizedRating: 8.0 }),
      makeListing({ name: 'Booking OK2', _normalizedRating: 8.5 }),
      makeListing({ name: 'Booking OK3', _normalizedRating: 9.0 }),
      makeListing({ name: 'Booking OK4', _normalizedRating: 8.2 }),
      makeListing({ name: 'Booking OK5', _normalizedRating: 8.1 }),
    ];
    var result = applyRatingFloor(listings, SCORING_CONFIG.RATING_FLOOR.DEFAULT);
    assert.strictEqual(result.filtered.length, 6); // all >= 8.0 (excludes Airbnb Low at 7.0)
    var names = result.filtered.map(function (l) { return l.name; });
    assert.ok(names.indexOf('Airbnb High') >= 0);
    assert.ok(names.indexOf('Airbnb Low') < 0);
  });

  it('FILT-02: auto-relaxes by 0.5 when fewer than 5 results pass at 8.0', function () {
    // Only 3 listings above 8.0, but 6 above 7.5
    var listings = [
      makeListing({ name: 'A', _normalizedRating: 9.0 }),
      makeListing({ name: 'B', _normalizedRating: 8.5 }),
      makeListing({ name: 'C', _normalizedRating: 8.0 }),
      makeListing({ name: 'D', _normalizedRating: 7.8 }),
      makeListing({ name: 'E', _normalizedRating: 7.5 }),
      makeListing({ name: 'F', _normalizedRating: 7.5 }),
      makeListing({ name: 'G', _normalizedRating: 6.0 }),
    ];
    var result = applyRatingFloor(listings, SCORING_CONFIG.RATING_FLOOR.DEFAULT);
    assert.strictEqual(result.effectiveFloor, 7.5);
    assert.strictEqual(result.relaxed, true);
    assert.strictEqual(result.filtered.length, 6); // A, B, C, D(7.8), E(7.5), F(7.5)
  });

  it('FILT-02: relaxes step-by-step (8.0 -> 7.5 -> 7.0) until MIN_RESULTS met', function () {
    // Only 2 above 8.0, only 3 above 7.5, but 5 above 7.0
    var listings = [
      makeListing({ name: 'A', _normalizedRating: 9.0 }),
      makeListing({ name: 'B', _normalizedRating: 8.0 }),
      makeListing({ name: 'C', _normalizedRating: 7.5 }),
      makeListing({ name: 'D', _normalizedRating: 7.0 }),
      makeListing({ name: 'E', _normalizedRating: 7.0 }),
      makeListing({ name: 'F', _normalizedRating: 6.0 }),
    ];
    var result = applyRatingFloor(listings, SCORING_CONFIG.RATING_FLOOR.DEFAULT);
    assert.strictEqual(result.effectiveFloor, 7.0);
    assert.strictEqual(result.relaxed, true);
    assert.strictEqual(result.filtered.length, 5);
  });

  it('FILT-02: when floor hits 0 (all relaxation exhausted), returns all listings with relaxed=true', function () {
    // Only 2 listings total — can never reach MIN_RESULTS=5
    var listings = [
      makeListing({ name: 'A', _normalizedRating: 9.0 }),
      makeListing({ name: 'B', _normalizedRating: 3.0 }),
    ];
    var result = applyRatingFloor(listings, SCORING_CONFIG.RATING_FLOOR.DEFAULT);
    assert.strictEqual(result.filtered.length, 2);
    assert.strictEqual(result.relaxed, true);
    assert.strictEqual(result.effectiveFloor, 0);
  });

  it('FILT-04: tier-2 low-review listings bypass rating floor (tested via getListingTier)', function () {
    // Tier-2 listings should be filtered out BEFORE passing to applyRatingFloor
    // This test confirms getListingTier identifies them correctly for bypass
    var lowReviewBooking = makeListing({ platform: 'booking', reviewCount: 10, _normalizedRating: 9.5 });
    var lowReviewAgoda = makeListing({ platform: 'agoda', reviewCount: 5, _normalizedRating: 9.0 });
    var normalBooking = makeListing({ platform: 'booking', reviewCount: 50, _normalizedRating: 7.0 });
    assert.strictEqual(getListingTier(lowReviewBooking), 2);
    assert.strictEqual(getListingTier(lowReviewAgoda), 2);
    assert.strictEqual(getListingTier(normalBooking), 0);
  });
});

// ── selectTopPicks ────────────────────────────────────────────────────

describe('selectTopPicks', function () {
  function makeTier0Pool() {
    return [
      makeListing({ name: 'TopRated', _compositeScore: 85, _pricePerNight: 200, reviewCount: 200, _normalizedRating: 9.5 }),
      makeListing({ name: 'Value', _compositeScore: 70, _pricePerNight: 30, reviewCount: 100, _normalizedRating: 8.5 }),
      makeListing({ name: 'Overall', _compositeScore: 95, _pricePerNight: 80, reviewCount: 500, _normalizedRating: 9.0 }),
      makeListing({ name: 'Average', _compositeScore: 60, _pricePerNight: 60, reviewCount: 150, _normalizedRating: 8.2 }),
      makeListing({ name: 'Budget', _compositeScore: 50, _pricePerNight: 40, reviewCount: 80, _normalizedRating: 7.5 }),
    ];
  }

  it('PICK-01: returns exactly 3 picks from 5 tier-0 listings', function () {
    var picks = selectTopPicks(makeTier0Pool());
    assert.strictEqual(picks.length, 3);
  });

  it('PICK-01: returns empty array when fewer than 3 tier-0 listings', function () {
    var listings = [
      makeListing({ name: 'A', _compositeScore: 90, reviewCount: 100 }),
      makeListing({ name: 'B', _compositeScore: 80, reviewCount: 100 }),
    ];
    var picks = selectTopPicks(listings);
    assert.deepStrictEqual(picks, []);
  });

  it('PICK-02: labels are Best Rated, Best Value, Best Overall', function () {
    var picks = selectTopPicks(makeTier0Pool());
    var labels = picks.map(function (p) { return p.label; });
    assert.ok(labels.indexOf('Best Rated') >= 0);
    assert.ok(labels.indexOf('Best Value') >= 0);
    assert.ok(labels.indexOf('Best Overall') >= 0);
  });

  it('PICK-02: Best Rated has highest _normalizedRating', function () {
    var picks = selectTopPicks(makeTier0Pool());
    var best = picks.filter(function (p) { return p.label === 'Best Rated'; })[0];
    assert.strictEqual(best.listing.name, 'TopRated'); // 9.5 rating
  });

  it('PICK-02: Best Overall has highest _compositeScore', function () {
    var picks = selectTopPicks(makeTier0Pool());
    var best = picks.filter(function (p) { return p.label === 'Best Overall'; })[0];
    assert.strictEqual(best.listing.name, 'Overall'); // compositeScore 95
  });

  it('PICK-02: Best Value has lowest _pricePerNight among >= 8.0 rated', function () {
    var picks = selectTopPicks(makeTier0Pool());
    var value = picks.filter(function (p) { return p.label === 'Best Value'; })[0];
    assert.strictEqual(value.listing.name, 'Value'); // $30, rated 8.5
  });

  it('PICK-03: excludes anomaly listings (tier-1)', function () {
    var listings = [
      makeListing({ name: 'Normal1', _compositeScore: 90, reviewCount: 200, _normalizedRating: 9.0 }),
      makeListing({ name: 'Normal2', _compositeScore: 80, reviewCount: 150, _normalizedRating: 8.5 }),
      makeListing({ name: 'Normal3', _compositeScore: 70, reviewCount: 100, _normalizedRating: 8.0 }),
      makeListing({ name: 'Anomaly', _compositeScore: 99, reviewCount: 999, _normalizedRating: 9.5, _anomaly: { severity: 'severe' } }),
    ];
    var picks = selectTopPicks(listings);
    var names = picks.map(function (p) { return p.listing.name; });
    assert.ok(names.indexOf('Anomaly') < 0);
  });

  it('PICK-03: excludes low-review tier-2 listings', function () {
    var listings = [
      makeListing({ name: 'Normal1', _compositeScore: 90, reviewCount: 200, _normalizedRating: 9.0 }),
      makeListing({ name: 'Normal2', _compositeScore: 80, reviewCount: 150, _normalizedRating: 8.5 }),
      makeListing({ name: 'Normal3', _compositeScore: 70, reviewCount: 100, _normalizedRating: 8.0 }),
      makeListing({ name: 'LowReview', platform: 'booking', _compositeScore: 99, reviewCount: 5, _normalizedRating: 9.5 }),
    ];
    var picks = selectTopPicks(listings);
    var names = picks.map(function (p) { return p.listing.name; });
    assert.ok(names.indexOf('LowReview') < 0);
  });

  it('PICK-03: excludes listings with null _normalizedRating or null _pricePerNight', function () {
    var listings = [
      makeListing({ name: 'Normal1', _compositeScore: 90, reviewCount: 200, _normalizedRating: 9.0 }),
      makeListing({ name: 'Normal2', _compositeScore: 80, reviewCount: 150, _normalizedRating: 8.5 }),
      makeListing({ name: 'Normal3', _compositeScore: 70, reviewCount: 100, _normalizedRating: 8.0 }),
      makeListing({ name: 'NoRating', _compositeScore: 99, reviewCount: 999, _normalizedRating: null }),
      makeListing({ name: 'NoPrice', _compositeScore: 98, reviewCount: 998, _normalizedRating: 9.5, _pricePerNight: null }),
    ];
    var picks = selectTopPicks(listings);
    var names = picks.map(function (p) { return p.listing.name; });
    assert.ok(names.indexOf('NoRating') < 0);
    assert.ok(names.indexOf('NoPrice') < 0);
  });

  it('Dedup: same listing cannot appear in multiple picks', function () {
    // Make one listing that is highest rated, cheapest, and highest composite
    var listings = [
      makeListing({ name: 'SuperStar', _compositeScore: 99, _pricePerNight: 10, reviewCount: 50, _normalizedRating: 9.5 }),
      makeListing({ name: 'Other1', _compositeScore: 60, _pricePerNight: 80, reviewCount: 300, _normalizedRating: 8.0 }),
      makeListing({ name: 'Other2', _compositeScore: 50, _pricePerNight: 90, reviewCount: 200, _normalizedRating: 8.5 }),
      makeListing({ name: 'Other3', _compositeScore: 40, _pricePerNight: 70, reviewCount: 100, _normalizedRating: 8.0 }),
    ];
    var picks = selectTopPicks(listings);
    var superStarPicks = picks.filter(function (p) { return p.listing.name === 'SuperStar'; });
    assert.strictEqual(superStarPicks.length, 1);
    assert.ok(picks.length < 3); // Can't fill 3 unique picks when dedup removes some
  });
});
