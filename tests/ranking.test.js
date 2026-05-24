var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var { trustRating, airbnbToNormalizedRating, agodaToNormalizedRating, blendRating, SCORING_CONFIG } = (function () {
  var s = require('../src/shared/scoring.js');
  var c = require('../src/shared/scoring-config.js');
  return Object.assign({}, s, c);
})();

// ── Non-linear rating curve: (r/10)^2 * 10 ──
// Convex curve that separates excellent ratings (9+) more from mediocre (8.0)
function ratingCurve(r) {
  return Math.pow(r / 10, 2) * 10;
}

// ── Minimal scoring pipeline (mirrors search.js scoreAndRankListings) ──
// Only the pure math — no DOM, no Chrome APIs.

function scoreListings(listings, searchNights) {
  searchNights = searchNights || 1;

  // Normalize ratings + compute trust
  for (var i = 0; i < listings.length; i++) {
    var l = listings[i];
    if (l.rating != null) {
      if (l.platform === 'booking') {
        l._normalizedRating = l.rating;
      } else if (l.platform === 'agoda') {
        l._normalizedRating = agodaToNormalizedRating(l.rating);
      } else if (l.platform === 'airbnb') {
        l._normalizedRating = airbnbToNormalizedRating(l.rating);
      } else {
        l._normalizedRating = l.rating * 2;
      }
    } else {
      l._normalizedRating = null;
    }

    var crossRef = l._googleData || null;
    var badges = l.platform === 'airbnb' ? (l.badges || null) : null;
    var result = trustRating(l.reviewCount, crossRef, badges, l.rating, l.platform);
    l._trustScore = result.trust;
    l._anomaly = result.anomaly;

    var blend = blendRating(l.rating, l.platform, crossRef);
    l._blendResult = blend;

    // Price per night (still needed for UI display and user sort)
    if (l.price != null) {
      l._pricePerNight = (l.platform === 'agoda') ? l.price : Math.round(l.price / searchNights);
    }
  }

  // Dataset mean for Bayesian smoothing
  var ratingSum = 0, ratingCount = 0;
  for (var mi = 0; mi < listings.length; mi++) {
    var miRating = (listings[mi]._blendResult && listings[mi]._blendResult.changed)
      ? listings[mi]._blendResult.blended : listings[mi]._normalizedRating;
    if (miRating != null) { ratingSum += miRating; ratingCount++; }
  }
  var datasetMean = ratingCount > 0 ? ratingSum / ratingCount : 7.5;

  // Composite score: non-linear Bayesian rating (no price component)
  for (var ci = 0; ci < listings.length; ci++) {
    // Rating for ranking: blended (platform+Google) when available, else normalized
    var rawRating = (listings[ci]._blendResult && listings[ci]._blendResult.changed)
      ? listings[ci]._blendResult.blended
      : (listings[ci]._normalizedRating != null ? listings[ci]._normalizedRating : 0);
    var v = listings[ci].reviewCount || 0;
    var cap = (listings[ci].platform === 'airbnb') ? 30 : 200;
    var confidence = Math.min(1, v / cap);
    var bayesianRating = confidence * rawRating + (1 - confidence) * datasetMean;
    listings[ci]._bayesianRating = bayesianRating;
    // Anomalous listings: skip Bayesian boost, use raw rating
    var effectiveRating = listings[ci]._anomaly ? rawRating : bayesianRating;
    listings[ci]._compositeScore = ratingCurve(effectiveRating);
  }

  return listings;
}

function getListingTier(listing) {
  if (listing._anomaly) return 1;
  return 0;
}

function selectTopPicks(listings) {
  var tier0 = listings.filter(function (l) {
    return getListingTier(l) === 0 && l._normalizedRating != null && l._pricePerNight != null;
  });
  if (tier0.length < 3) return [];
  var picks = [];
  var bestOverall = tier0.slice().sort(function (a, b) {
    return (b._compositeScore || 0) - (a._compositeScore || 0);
  })[0];
  picks.push({ listing: bestOverall, label: 'Best Overall' });
  // Best Rated: highest Bayesian-adjusted rating (accounts for review confidence)
  var bestRated = tier0.slice().sort(function (a, b) {
    return (b._bayesianRating || 0) - (a._bayesianRating || 0);
  })[0];
  if (bestRated !== bestOverall) {
    picks.push({ listing: bestRated, label: 'Best Rated' });
  }
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

// ── Helper: load fixture and score ──
function loadAndScore(fixturePath) {
  var fixture = require(fixturePath);
  var listings = JSON.parse(JSON.stringify(fixture.listings)); // deep copy
  scoreListings(listings, fixture.searchNights);
  // Sort: anomalies demoted, then composite descending (mirrors search.js)
  listings.sort(function (a, b) {
    var aTier = getListingTier(a);
    var bTier = getListingTier(b);
    if (aTier !== bTier) return aTier - bTier;
    return (b._compositeScore || 0) - (a._compositeScore || 0);
  });
  return { fixture: fixture, listings: listings };
}

// ── Helper: find pick by label ──
function findPick(picks, label) {
  for (var i = 0; i < picks.length; i++) {
    if (picks[i].label === label) return picks[i].listing;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// RATING CURVE TESTS — verify non-linear convex curve properties
// ══════════════════════════════════════════════════════════════════════

describe('ratingCurve non-linear properties', function () {
  it('ratingCurve(10) maps to 10.0', function () {
    assert.strictEqual(ratingCurve(10), 10);
  });

  it('ratingCurve(8.0) maps to 6.4', function () {
    var result = ratingCurve(8.0);
    assert.ok(Math.abs(result - 6.4) < 0.001, 'expected 6.4, got ' + result);
  });

  it('gap between 9.0 and 9.5 is larger than gap between 8.0 and 8.5 (convex curve)', function () {
    var gap95_90 = ratingCurve(9.5) - ratingCurve(9.0);
    var gap85_80 = ratingCurve(8.5) - ratingCurve(8.0);
    assert.ok(gap95_90 > gap85_80,
      'gap(9.0->9.5)=' + gap95_90.toFixed(3) + ' should exceed gap(8.0->8.5)=' + gap85_80.toFixed(3));
  });

  it('two listings with same rating but different prices get identical composite', function () {
    var listings = scoreListings([
      { name: 'Cheap', platform: 'booking', rating: 8.5, reviewCount: 300, price: 50 },
      { name: 'Expensive', platform: 'booking', rating: 8.5, reviewCount: 300, price: 200 },
    ], 1);
    var cheap = listings.find(function (l) { return l.name === 'Cheap'; });
    var expensive = listings.find(function (l) { return l.name === 'Expensive'; });
    assert.strictEqual(cheap._compositeScore, expensive._compositeScore,
      'price should not affect composite score');
  });

  it('low-review perfect score pulled toward mean by Bayesian smoothing', function () {
    // Realistic dataset: mean around 8.0, so 5-review 10/10 gets pulled heavily toward 8.0
    var listings = scoreListings([
      { name: 'NewStar', platform: 'booking', rating: 10.0, reviewCount: 5, price: 80 },
      { name: 'Established', platform: 'booking', rating: 8.5, reviewCount: 200, price: 80 },
      { name: 'Average A', platform: 'booking', rating: 7.5, reviewCount: 300, price: 60 },
      { name: 'Average B', platform: 'booking', rating: 7.8, reviewCount: 250, price: 65 },
      { name: 'Average C', platform: 'booking', rating: 8.0, reviewCount: 400, price: 70 },
      { name: 'Budget', platform: 'booking', rating: 7.0, reviewCount: 200, price: 40 },
    ], 1);
    var newStar = listings.find(function (l) { return l.name === 'NewStar'; });
    var established = listings.find(function (l) { return l.name === 'Established'; });
    assert.ok(established._compositeScore > newStar._compositeScore,
      'Established (' + established._compositeScore.toFixed(2) +
      ') should beat 5-review 10/10 (' + newStar._compositeScore.toFixed(2) + ')');
  });
});

// ══════════════════════════════════════════════════════════════════════
// BEHAVIORAL ASSERTIONS — these are the invariants that must always hold
// regardless of scoring algorithm changes.
// ══════════════════════════════════════════════════════════════════════

describe('ranking invariants', function () {

  it('a 5-review perfect score should not beat an established hotel for Best Rated', function () {
    var listings = scoreListings([
      { name: 'Hyped New Place', platform: 'airbnb', rating: 5.0, reviewCount: 5, price: 33 },
      { name: 'Established Hotel', platform: 'airbnb', rating: 4.8, reviewCount: 200, price: 55 },
      { name: 'Solid Mid-Range', platform: 'booking', rating: 8.5, reviewCount: 800, price: 70 },
      { name: 'Budget Option', platform: 'booking', rating: 8.0, reviewCount: 300, price: 40 },
    ], 1);

    var picks = selectTopPicks(listings);
    var bestRated = findPick(picks, 'Best Rated');
    if (bestRated) {
      assert.notEqual(bestRated.name, 'Hyped New Place',
        'a listing with only 5 reviews should not be Best Rated');
    }
  });

  it('review count should smooth confidence — not create hard cutoffs', function () {
    var listings = scoreListings([
      { name: 'Nine Reviews', platform: 'airbnb', rating: 5.0, reviewCount: 9, price: 50 },
      { name: 'Eleven Reviews', platform: 'airbnb', rating: 5.0, reviewCount: 11, price: 50 },
    ], 1);

    // Same rating, similar review count — scores should be close, not cliff-edge different
    var scoreDiff = Math.abs(listings[0]._compositeScore - listings[1]._compositeScore);
    assert.ok(scoreDiff < 0.5,
      '9 vs 11 reviews should not create a cliff (diff=' + scoreDiff.toFixed(2) + ')');
  });

  it('200 reviews at 4.8 should rank above 5 reviews at 5.0 in composite (with realistic dataset)', function () {
    // With review-count penalties removed, Bayesian smoothing handles this —
    // but requires a realistic dataset (not just 2 listings) to pull newcomers toward a lower mean.
    var listings = scoreListings([
      { name: 'Proven', platform: 'airbnb', rating: 4.8, reviewCount: 200, price: 60 },
      { name: 'Untested', platform: 'airbnb', rating: 5.0, reviewCount: 5, price: 60 },
      { name: 'Budget A', platform: 'booking', rating: 7.5, reviewCount: 300, price: 40 },
      { name: 'Budget B', platform: 'booking', rating: 7.0, reviewCount: 150, price: 35 },
      { name: 'Mid Range', platform: 'booking', rating: 8.0, reviewCount: 400, price: 55 },
    ], 1);

    var proven = listings.find(function (l) { return l.name === 'Proven'; });
    var untested = listings.find(function (l) { return l.name === 'Untested'; });
    assert.ok(proven._compositeScore > untested._compositeScore,
      'Proven (' + proven._compositeScore.toFixed(2) +
      ') should beat Untested (' + untested._compositeScore.toFixed(2) + ')');
  });

  it('Bayesian smoothing pulls low-review listings toward the mean', function () {
    // Need a realistic dataset so the mean is below the perfect-score listings
    var listings = scoreListings([
      { name: 'Few Reviews', platform: 'airbnb', rating: 5.0, reviewCount: 5, price: 50 },
      { name: 'Many Reviews', platform: 'airbnb', rating: 5.0, reviewCount: 500, price: 50 },
      { name: 'Average A', platform: 'booking', rating: 7.5, reviewCount: 300, price: 40 },
      { name: 'Average B', platform: 'booking', rating: 8.0, reviewCount: 200, price: 45 },
    ], 1);

    var few = listings.find(function (l) { return l.name === 'Few Reviews'; });
    var many = listings.find(function (l) { return l.name === 'Many Reviews'; });
    // 5 reviews → heavily smoothed toward mean (< 9.8), 500 → barely touched
    assert.ok(many._bayesianRating > few._bayesianRating,
      '500-review listing should have higher Bayesian rating than 5-review');
  });

  it('no review-count penalties: trust equals normalized rating for both platforms', function () {
    var airbnb = scoreListings([
      { name: 'Airbnb Place', platform: 'airbnb', rating: 4.5, reviewCount: 8, price: 50 },
    ], 1);
    var booking = scoreListings([
      { name: 'Booking Place', platform: 'booking', rating: 9.0, reviewCount: 8, price: 50 },
    ], 1);

    // Both have 8 reviews. With penalties removed, trust should equal normalized rating.
    // Airbnb 4.5 normalizes to 8.0, Booking 9.0 stays 9.0.
    var airbnbPenalty = airbnb[0]._normalizedRating - airbnb[0]._trustScore;
    var bookingPenalty = booking[0]._normalizedRating - booking[0]._trustScore;
    assert.strictEqual(airbnbPenalty, 0, 'Airbnb should have no review penalty');
    assert.strictEqual(bookingPenalty, 0, 'Booking should have no review penalty');
  });
});

// ══════════════════════════════════════════════════════════════════════
// FIXTURE-BASED TESTS — load real search dumps, assert sanity
// ══════════════════════════════════════════════════════════════════════
// To add a new fixture:
//   1. Run a search in the extension
//   2. Open devtools console, call: dumpListings()
//   3. Paste the JSON into tests/fixtures/<destination>-<date>.js as:
//      module.exports = <pasted JSON>;
//   4. Add assertions below

describe('johor bahru 2026-03-16 (real dump, 133 listings)', function () {
  var data = loadAndScore('./fixtures/johor-bahru-2026-03-16.js');

  it('Best Rated should have meaningful review count', function () {
    var picks = selectTopPicks(data.listings);
    var bestRated = findPick(picks, 'Best Rated');
    if (bestRated) {
      assert.ok(bestRated.reviewCount >= 20,
        bestRated.name + ' has only ' + bestRated.reviewCount + ' reviews');
    }
  });

  it('6-review Airbnb should not be Best Rated over established listings', function () {
    var picks = selectTopPicks(data.listings);
    var bestRated = findPick(picks, 'Best Rated');
    if (bestRated) {
      assert.notEqual(bestRated.name, 'Homey Cozy 2Queen Studio @ Palazio @ Mt. Austin',
        '6-review listing should not be Best Rated');
    }
  });

  it('1-review 10/10 Booking listings should not appear in top 10', function () {
    // Pangsapuri Medini (10/10, 1 review), Trellis Suites (10/10, 1 review)
    var top10 = data.listings.slice(0, 10);
    for (var i = 0; i < top10.length; i++) {
      assert.ok(top10[i].reviewCount >= 5,
        '#' + (i + 1) + ' ' + top10[i].name +
        ' has only ' + top10[i].reviewCount + ' reviews');
    }
  });

  it('Hotel Granada (9.7, 15k reviews) should rank above low-review 9+ listings', function () {
    var granada = data.listings.find(function (l) { return l.name === 'Hotel Granada Johor Bahru'; });
    var lowReview9 = data.listings.find(function (l) {
      return l.rating >= 9 && l.reviewCount < 20 && l.platform !== 'airbnb';
    });
    if (granada && lowReview9) {
      assert.ok(granada._compositeScore > lowReview9._compositeScore,
        'Granada (' + granada._compositeScore.toFixed(2) +
        ') should beat ' + lowReview9.name + ' (' + lowReview9._compositeScore.toFixed(2) + ')');
    }
  });

  it('Best Overall should have 100+ reviews', function () {
    var picks = selectTopPicks(data.listings);
    var best = findPick(picks, 'Best Overall');
    if (best) {
      assert.ok(best.reviewCount >= 100,
        'Best Overall ' + best.name + ' has only ' + best.reviewCount + ' reviews');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// SORT ORDER SANITY — display value = sort value, no hidden score jumps
// ══════════════════════════════════════════════════════════════════════

describe('sort order matches displayed rating', function () {
  var data = loadAndScore('./fixtures/johor-bahru-2026-03-16.js');

  // What the user would see: the Bayesian rating is the displayed number
  function displayedRating(l) {
    return l._bayesianRating != null ? l._bayesianRating : l._normalizedRating;
  }

  it('non-anomaly listings are sorted by Bayesian rating descending', function () {
    var normal = data.listings.filter(function (l) { return !l._anomaly; });
    for (var i = 1; i < normal.length; i++) {
      var prev = displayedRating(normal[i - 1]);
      var curr = displayedRating(normal[i]);
      assert.ok(prev >= curr - 0.001,
        '#' + i + ' ' + normal[i - 1].name + ' (' + prev.toFixed(2) +
        ') should rank above #' + (i + 1) + ' ' + normal[i].name + ' (' + curr.toFixed(2) + ')');
    }
  });

  it('Agoda 8.5 normalizedRating equals agodaToNormalizedRating(8.5), not raw 8.5', function () {
    var listings = scoreListings([
      { name: 'Agoda Hotel', platform: 'agoda', rating: 8.5, reviewCount: 300, price: 80 },
    ], 1);
    var agoda = listings.find(function (l) { return l.name === 'Agoda Hotel'; });
    var expected = agodaToNormalizedRating(8.5);
    assert.strictEqual(agoda._normalizedRating, expected,
      'Agoda _normalizedRating should be ' + expected + ' (deflated), got ' + agoda._normalizedRating);
  });

  it('Agoda listing ranks below equivalent Booking when Agoda raw is slightly higher but normalized is lower', function () {
    // Agoda 8.5 raw -> ~8.3 normalized; Booking 8.5 stays 8.5
    // After normalization, Booking 8.5 should rank above Agoda 8.5
    var listings = scoreListings([
      { name: 'Agoda Place', platform: 'agoda', rating: 8.5, reviewCount: 300, price: 80 },
      { name: 'Booking Place', platform: 'booking', rating: 8.5, reviewCount: 300, price: 80 },
    ], 1);
    var agoda = listings.find(function (l) { return l.name === 'Agoda Place'; });
    var booking = listings.find(function (l) { return l.name === 'Booking Place'; });
    assert.ok(booking._compositeScore > agoda._compositeScore,
      'Booking 8.5 (' + booking._compositeScore.toFixed(2) +
      ') should rank above Agoda 8.5 deflated (' + agoda._compositeScore.toFixed(2) + ')');
  });

  it('anomaly listings always appear after non-anomaly listings', function () {
    var seenAnomaly = false;
    for (var i = 0; i < data.listings.length; i++) {
      if (data.listings[i]._anomaly) {
        seenAnomaly = true;
      } else if (seenAnomaly) {
        assert.fail('#' + (i + 1) + ' ' + data.listings[i].name +
          ' is non-anomaly but appears after an anomaly listing');
      }
    }
  });

  it('5-review 9.8 listing ranks below 200-review 9.5 listing', function () {
    // Bayesian smoothing should pull low-review listings toward the mean
    var fewReviews = data.listings.find(function (l) {
      return l._normalizedRating >= 9.5 && l.reviewCount <= 10 && !l._anomaly;
    });
    var manyReviews = data.listings.find(function (l) {
      return l._normalizedRating >= 9.3 && l._normalizedRating <= 9.6
        && l.reviewCount >= 100 && !l._anomaly;
    });
    if (fewReviews && manyReviews) {
      var fewIdx = data.listings.indexOf(fewReviews);
      var manyIdx = data.listings.indexOf(manyReviews);
      assert.ok(manyIdx < fewIdx,
        manyReviews.name + ' (' + manyReviews.reviewCount + ' reviews, pos ' + manyIdx +
        ') should rank above ' + fewReviews.name + ' (' + fewReviews.reviewCount +
        ' reviews, pos ' + fewIdx + ')');
    }
  });
});
