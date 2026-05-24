const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  trustRating, valueScores,
} = require('../src/shared/scoring.js');
const hotels = require('./fixtures/golden-hotels.js');

// ─── Helper: compute full ranking for a set of hotels ──────────────
//
// Trust = platform rating (normalized to 0-10), penalized for low reviews,
// discounted for anomalies when histogram data is available.

function computeRanking(hotelList) {
  return hotelList.map(h => {
    const result = trustRating(
      h.booking.reviewCount,
      h.google || null,
      null,
      h.booking.rating,
      'booking'
    );
    return result.trust;
  });
}

// ─── Golden Scenario Ranking ────────────────────────────────────────
//
// All assertions are RELATIONAL (A > B) or THRESHOLD.
// Anomaly detection only fires when histogram data is present (tier 4 with histograms).
// Tier 3 hotels (suspicious but no histogram evidence) rank by their rating.

describe('golden scenario ranking', () => {
  const scores = computeRanking(hotels);

  // ── Anomaly-detected hotels rank below trustworthy ones ──

  it('Genuine Luxury (tier 1) ranks above Confirmed Fake (tier 4, anomaly)', () => {
    assert.ok(scores[0] > scores[9],
      `Genuine Luxury (${scores[0]}) should rank above Confirmed Fake (${scores[9]})`);
  });

  it('Established Average (tier 2) ranks above Confirmed Fake (tier 4, anomaly)', () => {
    assert.ok(scores[4] > scores[9],
      `Established Average (${scores[4]}) should rank above Confirmed Fake (${scores[9]})`);
  });

  it('Cheap And Cheerful (tier 2) ranks above Incentivized Reviews (tier 4, anomaly)', () => {
    assert.ok(scores[5] > scores[10],
      `Cheap And Cheerful (${scores[5]}) should rank above Incentivized Reviews (${scores[10]})`);
  });

  // ── Cross-tier aggregate: anomaly-detected tier 4 always ranks lowest ──

  it('average tier 2 score exceeds average tier 4 score', () => {
    const tier2 = hotels.reduce((acc, h, i) => h.tier === 2 ? acc.concat(scores[i]) : acc, []);
    const tier4 = hotels.reduce((acc, h, i) => h.tier === 4 ? acc.concat(scores[i]) : acc, []);
    const avg2 = tier2.reduce((a, b) => a + b, 0) / tier2.length;
    const avg4 = tier4.reduce((a, b) => a + b, 0) / tier4.length;
    assert.ok(avg2 > avg4,
      `tier 2 avg (${avg2.toFixed(1)}) should exceed tier 4 avg (${avg4.toFixed(1)})`);
  });

  // ── Score range checks ──

  it('all scores in 0-10 range', () => {
    scores.forEach((s, i) => {
      assert.ok(s >= 0 && s <= 10,
        `hotel ${hotels[i].name} score ${s} out of 0-10 range`);
    });
  });

  it('max - min spread is at least 2.0 points', () => {
    const spread = Math.max(...scores) - Math.min(...scores);
    assert.ok(spread >= 2.0,
      `score spread ${spread.toFixed(1)} should be at least 2.0 points`);
  });
});
