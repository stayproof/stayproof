// Behavioral tests for scoring simplification (Phase 43)
// TDD RED: these tests define expected behavior for reviewConfidence + computeTrust
// which do NOT exist yet. Tests are SKIPPED until Phase 44 implements the functions.

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var scoring = require('../src/shared/scoring.js');

// Attempt to destructure new functions (they don't exist yet => undefined)
var reviewConfidence = scoring.reviewConfidence;
var computeTrust = scoring.computeTrust;

var hasNewFunctions = typeof reviewConfidence === 'function' && typeof computeTrust === 'function';

// ── Fixtures ──
var goldenHotels = require('./fixtures/golden-hotels.js');
var londonFixture = require('./fixtures/london-2026-03-16.js');
var johorFixture = require('./fixtures/johor-bahru-2026-03-16.js');
var singaporeFixture = require('./fixtures/singapore-2026-03-16.js');

// ══════════════════════════════════════════════════════════════════════
// reviewConfidence — linear ramp
// ══════════════════════════════════════════════════════════════════════

describe('reviewConfidence — linear ramp', { skip: !hasNewFunctions }, function () {

  it('Airbnb: 0 reviews = 0 confidence', function () {
    assert.strictEqual(reviewConfidence(0, 'airbnb'), 0,
      'Airbnb 0 reviews should have 0 confidence');
  });

  it('Airbnb: 15 reviews = 0.5 confidence (midpoint)', function () {
    assert.strictEqual(reviewConfidence(15, 'airbnb'), 0.5,
      'Airbnb 15 reviews should be at 0.5 (halfway to 30)');
  });

  it('Airbnb: 30 reviews = 1.0 confidence (full)', function () {
    assert.strictEqual(reviewConfidence(30, 'airbnb'), 1.0,
      'Airbnb 30 reviews should reach full confidence');
  });

  it('Airbnb: 60 reviews = 1.0 confidence (capped)', function () {
    assert.strictEqual(reviewConfidence(60, 'airbnb'), 1.0,
      'Airbnb 60 reviews should still be 1.0 (capped)');
  });

  it('Booking: 0 reviews = 0 confidence', function () {
    assert.strictEqual(reviewConfidence(0, 'booking'), 0,
      'Booking 0 reviews should have 0 confidence');
  });

  it('Booking: 100 reviews = 0.5 confidence (midpoint)', function () {
    assert.strictEqual(reviewConfidence(100, 'booking'), 0.5,
      'Booking 100 reviews should be at 0.5 (halfway to 200)');
  });

  it('Booking: 200 reviews = 1.0 confidence (full)', function () {
    assert.strictEqual(reviewConfidence(200, 'booking'), 1.0,
      'Booking 200 reviews should reach full confidence');
  });

  it('Booking: 500 reviews = 1.0 confidence (capped)', function () {
    assert.strictEqual(reviewConfidence(500, 'booking'), 1.0,
      'Booking 500 reviews should still be 1.0 (capped)');
  });

  it('Agoda: same caps as Booking (0=0, 100=0.5, 200=1.0)', function () {
    assert.strictEqual(reviewConfidence(0, 'agoda'), 0,
      'Agoda 0 reviews should have 0 confidence');
    assert.strictEqual(reviewConfidence(100, 'agoda'), 0.5,
      'Agoda 100 reviews should be 0.5');
    assert.strictEqual(reviewConfidence(200, 'agoda'), 1.0,
      'Agoda 200 reviews should reach full confidence');
  });
});

// ══════════════════════════════════════════════════════════════════════
// reviewConfidence — no cliff effects (TEST-02)
// ══════════════════════════════════════════════════════════════════════

describe('reviewConfidence — no cliff effects (TEST-02)', { skip: !hasNewFunctions }, function () {

  it('9 vs 11 Airbnb reviews differ by less than 0.1 (smooth, no step)', function () {
    var diff = Math.abs(reviewConfidence(9, 'airbnb') - reviewConfidence(11, 'airbnb'));
    assert.ok(diff < 0.1,
      '9 vs 11 Airbnb reviews should differ by <0.1, got ' + diff.toFixed(4));
  });

  it('49 vs 51 Booking reviews differ by less than 0.1 (smooth, no step)', function () {
    var diff = Math.abs(reviewConfidence(49, 'booking') - reviewConfidence(51, 'booking'));
    assert.ok(diff < 0.1,
      '49 vs 51 Booking reviews should differ by <0.1, got ' + diff.toFixed(4));
  });

  it('199 vs 201 Agoda reviews differ by less than 0.1 (smooth, no step)', function () {
    var diff = Math.abs(reviewConfidence(199, 'agoda') - reviewConfidence(201, 'agoda'));
    assert.ok(diff < 0.1,
      '199 vs 201 Agoda reviews should differ by <0.1, got ' + diff.toFixed(4));
  });

  it('monotonically increasing: more reviews = higher or equal confidence', function () {
    var counts = [1, 5, 10, 20, 50, 100, 200];
    var platforms = ['airbnb', 'booking', 'agoda'];
    for (var p = 0; p < platforms.length; p++) {
      var prev = reviewConfidence(0, platforms[p]);
      for (var i = 0; i < counts.length; i++) {
        var curr = reviewConfidence(counts[i], platforms[p]);
        assert.ok(curr >= prev,
          platforms[p] + ': ' + counts[i] + ' reviews (' + curr.toFixed(3) +
          ') should be >= previous (' + prev.toFixed(3) + ')');
        prev = curr;
      }
    }
  });

  it('confidence never exceeds 1.0 even at 1000 reviews', function () {
    var platforms = ['airbnb', 'booking', 'agoda'];
    for (var p = 0; p < platforms.length; p++) {
      var conf = reviewConfidence(1000, platforms[p]);
      assert.ok(conf <= 1.0,
        platforms[p] + ' at 1000 reviews should not exceed 1.0, got ' + conf.toFixed(3));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Established hotels beat low-review perfect scores (TEST-03)
// ══════════════════════════════════════════════════════════════════════

describe('established hotels beat low-review perfect scores (TEST-03)', { skip: !hasNewFunctions }, function () {

  it('Booking 500 reviews at 8.5 beats Booking 5 reviews at 10.0', function () {
    var established = { name: 'Established', platform: 'booking', rating: 8.5, reviewCount: 500 };
    var newcomer = { name: 'Newcomer', platform: 'booking', rating: 10.0, reviewCount: 5 };

    var estConf = reviewConfidence(established.reviewCount, established.platform);
    var newConf = reviewConfidence(newcomer.reviewCount, newcomer.platform);

    var estResult = computeTrust(established, null);
    var newResult = computeTrust(newcomer, null);

    // Bayesian shrinkage: established (high confidence) keeps its rating,
    // newcomer (low confidence) gets pulled toward the dataset mean
    var mean = 7.5; // realistic dataset mean across all platforms
    var estScore = estConf * estResult.trust + (1 - estConf) * mean;
    var newScore = newConf * newResult.trust + (1 - newConf) * mean;

    assert.ok(estScore > newScore,
      'Established (500 reviews, 8.5 rating, score=' + estScore.toFixed(2) +
      ') should beat Newcomer (5 reviews, 10.0 rating, score=' + newScore.toFixed(2) + ')');
  });

  it('citizenM Victoria Station (8.7, 6259 reviews) beats any listing with <10 reviews', function () {
    var listings = londonFixture.listings;
    var citizenM = null;
    var lowReviewListings = [];

    for (var i = 0; i < listings.length; i++) {
      if (listings[i].name === 'citizenM London Victoria Station') {
        citizenM = listings[i];
      }
      if (listings[i].reviewCount > 0 && listings[i].reviewCount < 10 && listings[i].rating != null) {
        lowReviewListings.push(listings[i]);
      }
    }

    assert.ok(citizenM, 'citizenM Victoria Station should exist in London fixture');
    assert.ok(lowReviewListings.length > 0, 'Should have low-review listings to compare against');

    var citizenMConf = reviewConfidence(citizenM.reviewCount, citizenM.platform);
    var citizenMTrust = computeTrust(citizenM, citizenM._googleData || null);
    var citizenMScore = citizenMConf * citizenMTrust.trust + (1 - citizenMConf) * 8.0;

    for (var j = 0; j < lowReviewListings.length; j++) {
      var lr = lowReviewListings[j];
      var lrConf = reviewConfidence(lr.reviewCount, lr.platform);
      var lrTrust = computeTrust(lr, lr._googleData || null);
      var lrScore = lrConf * lrTrust.trust + (1 - lrConf) * 8.0;

      assert.ok(citizenMScore > lrScore,
        'citizenM Victoria (8.7, 6259 reviews, score=' + citizenMScore.toFixed(2) +
        ') should beat ' + lr.name + ' (' + lr.rating + ', ' + lr.reviewCount +
        ' reviews, score=' + lrScore.toFixed(2) + ')');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Real hotel behavioral tests (TEST-01)
// ══════════════════════════════════════════════════════════════════════

describe('real hotel behavioral tests (TEST-01)', { skip: !hasNewFunctions }, function () {

  it('Tier 1 golden hotels (2400, 800, 400 reviews) should have confidence > 0.8', function () {
    var tier1 = goldenHotels.filter(function (h) { return h.tier === 1; });
    assert.ok(tier1.length >= 3, 'Should have at least 3 Tier 1 golden hotels');

    for (var i = 0; i < tier1.length; i++) {
      var h = tier1[i];
      // Golden hotels use Booking platform scale
      var conf = reviewConfidence(h.booking.reviewCount, 'booking');
      assert.ok(conf > 0.8,
        h.name + ' (' + h.booking.reviewCount + ' reviews) confidence should be > 0.8, got ' + conf.toFixed(2));
    }
  });

  it('Tier 3 Inflated Newcomer (12 reviews) should have confidence < 0.3 on Booking scale', function () {
    var inflated = goldenHotels.find(function (h) { return h.name === 'Inflated Newcomer'; });
    assert.ok(inflated, 'Inflated Newcomer should exist in golden hotels');

    var conf = reviewConfidence(inflated.booking.reviewCount, 'booking');
    assert.ok(conf < 0.3,
      'Inflated Newcomer (' + inflated.booking.reviewCount + ' reviews) confidence should be < 0.3, got ' + conf.toFixed(2));
  });

  it('Tier 3 Too Perfect (25 reviews) should have confidence < 0.3 on Booking scale', function () {
    var tooPerfect = goldenHotels.find(function (h) { return h.name === 'Too Perfect'; });
    assert.ok(tooPerfect, 'Too Perfect should exist in golden hotels');

    var conf = reviewConfidence(tooPerfect.booking.reviewCount, 'booking');
    assert.ok(conf < 0.3,
      'Too Perfect (' + tooPerfect.booking.reviewCount + ' reviews) confidence should be < 0.3, got ' + conf.toFixed(2));
  });

  it('London fixture loads real data from all platforms', function () {
    var platforms = {};
    for (var i = 0; i < londonFixture.listings.length; i++) {
      platforms[londonFixture.listings[i].platform] = true;
    }
    assert.ok(platforms['booking'], 'London fixture should have Booking listings');
    assert.ok(platforms['airbnb'], 'London fixture should have Airbnb listings');
    assert.ok(platforms['agoda'], 'London fixture should have Agoda listings');
  });

  it('Johor Bahru hotels with Google Maps cross-ref should not have lower trust', function () {
    var listings = johorFixture.listings;
    var withGoogle = [];
    var withoutGoogle = [];

    for (var i = 0; i < listings.length; i++) {
      var l = listings[i];
      if (l.rating == null || l.reviewCount < 20) continue;
      if (l._googleData) {
        withGoogle.push(l);
      } else {
        withoutGoogle.push(l);
      }
    }

    // For each hotel with Google data, compute trust with and without cross-ref
    for (var g = 0; g < withGoogle.length; g++) {
      var hotel = withGoogle[g];
      var trustWith = computeTrust(hotel, hotel._googleData);
      var trustWithout = computeTrust(hotel, null);

      assert.ok(trustWith.trust >= trustWithout.trust,
        hotel.name + ': trust with Google cross-ref (' + trustWith.trust.toFixed(2) +
        ') should not be lower than without (' + trustWithout.trust.toFixed(2) + ')');
    }
  });

  it('Singapore fixture loads and has real hotel data', function () {
    assert.ok(singaporeFixture.listings.length > 0,
      'Singapore fixture should have listings');
    assert.ok(singaporeFixture.destination,
      'Singapore fixture should have a destination');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Google Maps clean-match trust boost (TRST-03)
// ══════════════════════════════════════════════════════════════════════

describe('Google Maps clean-match trust boost (TRST-03)', { skip: !hasNewFunctions }, function () {

  it('Booking listing with clean Google Maps match gets trust boost', function () {
    var listing = { name: 'Test Hotel', platform: 'booking', rating: 8.5, reviewCount: 500 };
    var cleanGoogle = { rating: 4.3, reviewCount: 600, histogram: [30, 30, 72, 150, 318] };
    var trustWith = computeTrust(listing, cleanGoogle);
    var trustWithout = computeTrust(listing, null);
    assert.ok(trustWith.trust > trustWithout.trust,
      'Booking with clean Google match (' + trustWith.trust.toFixed(2) +
      ') should be higher than without (' + trustWithout.trust.toFixed(2) + ')');
  });

  it('Agoda listing with clean Google Maps match gets trust boost', function () {
    var listing = { name: 'Agoda Hotel', platform: 'agoda', rating: 8.2, reviewCount: 400 };
    var cleanGoogle = { rating: 4.1, reviewCount: 500, histogram: [25, 25, 60, 125, 265] };
    var trustWith = computeTrust(listing, cleanGoogle);
    var trustWithout = computeTrust(listing, null);
    assert.ok(trustWith.trust > trustWithout.trust,
      'Agoda with clean Google match (' + trustWith.trust.toFixed(2) +
      ') should be higher than without (' + trustWithout.trust.toFixed(2) + ')');
  });

  it('Airbnb listing with clean Google Maps match does NOT get trust boost', function () {
    var listing = { name: 'Airbnb Place', platform: 'airbnb', rating: 4.8, reviewCount: 100 };
    var cleanGoogle = { rating: 4.5, reviewCount: 300, histogram: [15, 15, 36, 75, 159] };
    var trustWith = computeTrust(listing, cleanGoogle);
    var trustWithout = computeTrust(listing, null);
    assert.strictEqual(trustWith.trust, trustWithout.trust,
      'Airbnb trust should be same with or without Google data (' +
      trustWith.trust.toFixed(2) + ' vs ' + trustWithout.trust.toFixed(2) + ')');
  });

  it('Listing with anomaly detected does NOT get trust boost', function () {
    var listing = { name: 'Fake Hotel', platform: 'booking', rating: 9.1, reviewCount: 560 };
    // SeaColor-like anomalous histogram
    var anomalousGoogle = { rating: 4.5, reviewCount: 283, histogram: [30, 3, 3, 8, 239] };
    var result = computeTrust(listing, anomalousGoogle);
    assert.ok(result.anomaly === true, 'Should detect anomaly');
    // Anomalous trust should NOT be boosted above no-crossRef baseline
    var trustWithout = computeTrust(listing, null);
    assert.ok(result.trust <= trustWithout.trust + 0.01,
      'Anomalous listing trust (' + result.trust.toFixed(2) +
      ') should not exceed no-crossRef trust (' + trustWithout.trust.toFixed(2) + ')');
  });

  it('Listing with no crossRef does NOT get trust boost', function () {
    var listing = { name: 'Solo Hotel', platform: 'booking', rating: 8.5, reviewCount: 500 };
    var result = computeTrust(listing, null);
    assert.ok(!result.breakdown.googleVerified,
      'No crossRef should not have googleVerified in breakdown');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Anomaly reduces trust relative to clean (TRST-04)
// ══════════════════════════════════════════════════════════════════════

describe('anomaly reduces trust relative to clean (TRST-04)', function () {

  it('Anomalous listing scores lower than clean listing with identical ratings', function () {
    var cleanListing = { name: 'Clean Hotel', platform: 'booking', rating: 9.0, reviewCount: 500 };
    var anomalousListing = { name: 'Fake Hotel', platform: 'booking', rating: 9.0, reviewCount: 500 };
    // Clean Google data (natural distribution)
    var cleanGoogle = { rating: 4.5, reviewCount: 600, histogram: [30, 30, 72, 150, 318] };
    // Anomalous Google data (SeaColor-like: hollow middle, spike at 5-star)
    var anomalousGoogle = { rating: 4.5, reviewCount: 283, histogram: [30, 3, 3, 8, 239] };

    var cleanTrust = computeTrust(cleanListing, cleanGoogle);
    var anomalousTrust = computeTrust(anomalousListing, anomalousGoogle);

    assert.ok(cleanTrust.trust > anomalousTrust.trust,
      'Clean listing trust (' + cleanTrust.trust.toFixed(2) +
      ') should be higher than anomalous (' + anomalousTrust.trust.toFixed(2) + ')');
  });

  it('Rating gap listing has lower trust than concordant listing', function () {
    var concordant = { name: 'Concordant', platform: 'booking', rating: 9.0, reviewCount: 200 };
    var gapped = { name: 'Gapped', platform: 'booking', rating: 9.0, reviewCount: 200 };
    // Concordant: booking 9.0 matches Google 4.5 (normalized 9.0)
    var concordantGoogle = { rating: 4.5, reviewCount: 300, histogram: [15, 15, 36, 75, 159] };
    // Gapped: booking 9.0 vs Google 3.5 (normalized 7.0 — 2.0 point gap)
    var gappedGoogle = { rating: 3.5, reviewCount: 300, histogram: [21, 21, 51, 81, 126] };

    var concordantTrust = computeTrust(concordant, concordantGoogle);
    var gappedTrust = computeTrust(gapped, gappedGoogle);

    assert.ok(concordantTrust.trust > gappedTrust.trust,
      'Concordant trust (' + concordantTrust.trust.toFixed(2) +
      ') should be higher than rating-gap (' + gappedTrust.trust.toFixed(2) + ')');
  });

  it('Golden hotel SeaColor (Tier 4) at same rating as Genuine Luxury (Tier 1) has lower trust', function () {
    var seaColor = goldenHotels.find(function (h) { return h.name === 'SeaColor Beachstay'; });
    var genuine = goldenHotels.find(function (h) { return h.name === 'Genuine Luxury'; });
    assert.ok(seaColor, 'SeaColor should exist in golden hotels');
    assert.ok(genuine, 'Genuine Luxury should exist in golden hotels');

    // Use identical platform rating (8.6) to isolate the trust signal from anomaly detection
    // SeaColor's anomalous histogram should prevent the Google Maps boost that Genuine Luxury gets
    var seaColorListing = { name: seaColor.name, platform: 'booking', rating: 8.6, reviewCount: seaColor.booking.reviewCount };
    var genuineListing = { name: genuine.name, platform: 'booking', rating: genuine.booking.rating, reviewCount: genuine.booking.reviewCount };

    var seaColorTrust = computeTrust(seaColorListing, seaColor.google);
    var genuineTrust = computeTrust(genuineListing, genuine.google);

    assert.ok(genuineTrust.trust > seaColorTrust.trust,
      'Genuine Luxury trust (' + genuineTrust.trust.toFixed(2) +
      ') should be higher than SeaColor at same rating (' + seaColorTrust.trust.toFixed(2) + ')');
  });
});
