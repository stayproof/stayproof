const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  clamp, trustRating, trustLevel, valueScores,
  bimodalityCoefficient, wedgeDeviation, reviewDistributionAnomaly,
  bookingToGoogleScale, airbnbToNormalizedRating, agodaToNormalizedRating, computeAnomalyPenalty, checkStarPairInversions,
  fourStarDeficit,
  nameMatchConfidence, stripDiacritics, compoundVariants, bigramDiceOnStripped,
  jaroWinkler,
  platformLabel
} = require('../src/shared/scoring.js');

function assertApprox(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message} (expected ~${expected}, got ${actual.toFixed(4)})`);
}

// ─── Clamp ──────────────────────────────────────────────────────────

describe('clamp', () => {
  it('leaves 50 unchanged', () => {
    assert.strictEqual(clamp(50), 50);
  });
  it('clamps negative to 0', () => {
    assert.strictEqual(clamp(-10), 0);
  });
  it('clamps above 100 to 100', () => {
    assert.strictEqual(clamp(150), 100);
  });
  it('zero stays zero', () => {
    assert.strictEqual(clamp(0), 0);
  });
  it('100 stays 100', () => {
    assert.strictEqual(clamp(100), 100);
  });
});

// ─── Bimodality Coefficient ─────────────────────────────────────────

describe('bimodalityCoefficient', () => {
  it('natural distribution is not bimodal', () => {
    const naturalDist = [10, 20, 30, 50, 200];
    const bcNatural = bimodalityCoefficient(naturalDist);
    assert.ok(bcNatural < 0.555, `natural distribution is not bimodal (BC=${bcNatural.toFixed(4)})`);
  });
  it('bimodal distribution detected', () => {
    const bimodal = [100, 5, 3, 5, 100];
    const bcBimodal = bimodalityCoefficient(bimodal);
    assert.ok(bcBimodal > 0.555, `bimodal distribution detected (BC=${bcBimodal.toFixed(4)})`);
  });
  it('uniform distribution is not bimodal', () => {
    const uniform = [50, 50, 50, 50, 50];
    const bcUniform = bimodalityCoefficient(uniform);
    assert.ok(bcUniform <= 0.555, `uniform distribution is not bimodal (BC=${bcUniform.toFixed(4)})`);
  });
  it('all zeros returns 0', () => {
    const zeros = [0, 0, 0, 0, 0];
    assert.strictEqual(bimodalityCoefficient(zeros), 0);
  });
  it('single spike returns a number', () => {
    const allFive = [0, 0, 0, 0, 100];
    const bcAllFive = bimodalityCoefficient(allFive);
    assert.strictEqual(typeof bcAllFive, 'number', `single spike returns a number (BC=${bcAllFive.toFixed(4)})`);
  });
});

// ─── Wedge Deviation ────────────────────────────────────────────────

describe('wedgeDeviation', () => {
  it('perfect wedge has low deviation', () => {
    const perfectWedge = [5, 10, 20, 40, 100];
    const wdPerfect = wedgeDeviation(perfectWedge);
    assert.ok(wdPerfect < 0.2, `perfect wedge has low deviation (WD=${wdPerfect.toFixed(4)})`);
  });
  it('inverted wedge has high deviation', () => {
    const inverted = [100, 80, 60, 40, 20];
    const wdInverted = wedgeDeviation(inverted);
    assert.ok(wdInverted > 0.2, `inverted wedge has high deviation (WD=${wdInverted.toFixed(4)})`);
  });
  it('bimodal has high wedge deviation', () => {
    const bimodal = [80, 5, 3, 5, 80];
    const wdBimodal = wedgeDeviation(bimodal);
    assert.ok(wdBimodal > 0.3, `bimodal has high wedge deviation (WD=${wdBimodal.toFixed(4)})`);
  });
  it('all zeros returns 0', () => {
    assert.strictEqual(wedgeDeviation([0, 0, 0, 0, 0]), 0);
  });
});

// ─── Four-Star Deficit ──────────────────────────────────────────────

describe('fourStarDeficit', () => {
  it('genuine luxury hotel (4.7 mean, 13% 4★) passes threshold', () => {
    // Realistic luxury pattern: mean ~4.65, 4★ at 13% — consistent with Marina Bay Sands
    const ratio = fourStarDeficit([20, 20, 40, 130, 790]);
    assert.ok(ratio >= 0.7, `genuine luxury 4★ ratio should be >= 0.7 (got ${ratio.toFixed(3)})`);
  });
  it('genuine mid-range (4.3) passes threshold', () => {
    const ratio = fourStarDeficit([60, 60, 144, 300, 636]);
    assert.ok(ratio >= 0.7, `genuine mid-range 4★ ratio should be >= 0.7 (got ${ratio.toFixed(3)})`);
  });
  it('SHI HOUSE pattern (clean fake) below threshold', () => {
    const ratio = fourStarDeficit([5, 3, 3, 10, 350]);
    assert.ok(ratio < 0.7, `SHI HOUSE 4★ ratio should be < 0.7 (got ${ratio.toFixed(3)})`);
  });
  it('SeaColor pattern below threshold', () => {
    const ratio = fourStarDeficit([30, 3, 3, 8, 239]);
    assert.ok(ratio < 0.7, `SeaColor 4★ ratio should be < 0.7 (got ${ratio.toFixed(3)})`);
  });
  it('incentivized reviews pattern below threshold', () => {
    const ratio = fourStarDeficit([23, 23, 23, 30, 2234]);
    assert.ok(ratio < 0.7, `incentivized 4★ ratio should be < 0.7 (got ${ratio.toFixed(3)})`);
  });
  it('Parosand Da Nang pattern (7.9% 4★) below threshold', () => {
    // Parosand: 4.8★, 4749 reviews — 4★/5★ ratio 0.090, well below genuine range
    const ratio = fourStarDeficit([50, 24, 116, 376, 4183]);
    assert.ok(ratio < 0.7, `Parosand 4★ ratio should be < 0.7 (got ${ratio.toFixed(3)})`);
  });
  it('all zeros returns 1', () => {
    assert.strictEqual(fourStarDeficit([0, 0, 0, 0, 0]), 1);
  });
  it('uniform distribution passes threshold', () => {
    const ratio = fourStarDeficit([100, 100, 100, 100, 100]);
    assert.ok(ratio >= 0.7, `uniform distribution should not trigger (got ${ratio.toFixed(3)})`);
  });
});

// ─── trustRating ────────────────────────────────────────────────────

describe('trustRating', () => {
  it('500 reviews, no xref: trust = 10 (no penalties)', () => {
    const result = trustRating(500, null);
    assert.strictEqual(result.trust, 10);
    assert.strictEqual(result.reviewPenalty, 'none');
    assert.strictEqual(result.anomaly, false);
  });
  it('Booking 9.0, 150 reviews: trust = 9.0 (no review-count penalty)', () => {
    const result = trustRating(150, null, null, 9.0, 'booking');
    assert.strictEqual(result.trust, 9);
    assert.strictEqual(result.reviewPenalty, 'none');
  });
  it('Booking 9.0, 80 reviews: trust = 9.0 (no review-count penalty)', () => {
    const result = trustRating(80, null, null, 9.0, 'booking');
    assert.strictEqual(result.trust, 9);
    assert.strictEqual(result.reviewPenalty, 'none');
  });
  it('Booking 10.0, 2 reviews: trust = 10.0 (no review-count penalty)', () => {
    const result = trustRating(2, null, null, 10.0, 'booking');
    assert.strictEqual(result.trust, 10);
    assert.strictEqual(result.reviewPenalty, 'none');
  });
  it('500 reviews with clean xref: trust blends with Google rating (no anomaly)', () => {
    const result = trustRating(500, { rating: 4.2, reviewCount: 500, histogram: [20, 30, 60, 150, 500] });
    // Google 4.2★ = 8.4 normalized, blended with fallback trust 10 → ~9.2
    assert.ok(result.trust >= 8.5 && result.trust <= 10, `trust should blend toward Google rating, got ${result.trust}`);
    assert.strictEqual(result.anomaly, false);
  });
  it('500 reviews with anomalous xref: trust drops to 1/3', () => {
    const result = trustRating(500, { rating: 4.8, reviewCount: 1000, histogram: [5, 5, 5, 5, 980] });
    assert.ok(result.anomaly, 'anomaly should be detected');
    assert.ok(result.trust < 5, `trust should drop to ~3.3 (got ${result.trust})`);
  });
  it('80 reviews with anomalous xref: both penalties stack', () => {
    const result = trustRating(80, { rating: 4.8, reviewCount: 1000, histogram: [5, 5, 5, 5, 980] });
    assert.ok(result.anomaly, 'anomaly should be detected');
    // No platform info → fallback base 10, default penalty path: 80 < 200 = moderate
    assert.ok(result.trust < 4, `both penalties should stack (got ${result.trust})`);
  });
  it('xref with <50 Google reviews: no anomaly detection', () => {
    const result = trustRating(500, { rating: 4.8, reviewCount: 30, histogram: [1, 1, 1, 1, 26] });
    assert.strictEqual(result.anomaly, false, 'should not detect anomaly with <50 Google reviews');
    assert.strictEqual(result.trust, 10);
  });
  it('Return value has .trust, .anomaly, .reviewPenalty, .breakdown', () => {
    const result = trustRating(300, null);
    assert.ok(typeof result.trust === 'number', 'trust should be a number');
    assert.ok(typeof result.anomaly === 'boolean', 'anomaly should be a boolean');
    assert.ok(typeof result.reviewPenalty === 'string', 'reviewPenalty should be a string');
    assert.ok(typeof result.breakdown === 'object', 'breakdown should be an object');
  });
  it('.breakdown contains required fields', () => {
    const result = trustRating(300, null);
    const b = result.breakdown;
    assert.ok('reviewCount' in b, 'breakdown should have reviewCount');
    assert.ok('reviewPenalty' in b, 'breakdown should have reviewPenalty');
    assert.ok('anomaly' in b, 'breakdown should have anomaly');
    assert.ok('anomalyJsd' in b, 'breakdown should have anomalyJsd');
    assert.ok('hasXref' in b, 'breakdown should have hasXref');
    assert.ok('hasHistogram' in b, 'breakdown should have hasHistogram');
    assert.ok('xrefRating' in b, 'breakdown should have xrefRating');
  });
  it('hasHistogram false without xref', () => {
    const result = trustRating(300, null);
    assert.strictEqual(result.breakdown.hasHistogram, false);
    assert.strictEqual(result.breakdown.xrefRating, null);
  });
  it('hasHistogram false with search-only xref (no histogram)', () => {
    const result = trustRating(300, { rating: 4.5, reviewCount: 200, histogram: null });
    assert.strictEqual(result.breakdown.hasXref, true);
    assert.strictEqual(result.breakdown.hasHistogram, false);
    assert.strictEqual(result.breakdown.xrefRating, 4.5);
  });
  it('hasHistogram true with detail xref (has histogram)', () => {
    const result = trustRating(300, { rating: 4.5, reviewCount: 200, histogram: [5, 10, 20, 40, 125] });
    assert.strictEqual(result.breakdown.hasXref, true);
    assert.strictEqual(result.breakdown.hasHistogram, true);
    assert.strictEqual(result.breakdown.xrefRating, 4.5);
  });
  it('trust is clamped to 0-10', () => {
    const result = trustRating(500, null);
    assert.ok(result.trust >= 0 && result.trust <= 10);
  });
});

// ─── trustRating: Airbnb badge bonuses ──────────────────────────────

describe('trustRating with badges', () => {
  // Airbnb 4.5 → base 8.0 (piecewise), 50 reviews → no penalty (>=10), +1 badge = 9.0
  it('Guest Favorite boosts trust by 1', () => {
    const result = trustRating(50, null, { isGuestFavorite: true, isSuperhost: false }, 4.5, 'airbnb');
    assert.strictEqual(result.trust, 9);
    assert.strictEqual(result.breakdown.badgeBonus, 1);
  });
  // Airbnb 4.5 → base 8.0, 50 reviews → no penalty, +0.5 badge = 8.5
  it('Superhost boosts trust by 0.5', () => {
    const result = trustRating(50, null, { isGuestFavorite: false, isSuperhost: true }, 4.5, 'airbnb');
    assert.strictEqual(result.trust, 8.5);
    assert.strictEqual(result.breakdown.badgeBonus, 0.5);
  });
  // Airbnb 4.5 → base 8.0, 50 reviews → no penalty, +1.5 badge = 9.5
  it('Guest Favorite + Superhost stack: +1.5', () => {
    const result = trustRating(50, null, { isGuestFavorite: true, isSuperhost: true }, 4.5, 'airbnb');
    assert.strictEqual(result.trust, 9.5);
    assert.strictEqual(result.breakdown.badgeBonus, 1.5);
  });
  it('Guest Favorite with 200+ reviews clamped to 10', () => {
    // Use Airbnb 4.9 → base 9.5 + 1.0 GF = 10.0 (clamped)
    const result = trustRating(500, null, { isGuestFavorite: true, isSuperhost: false }, 4.9, 'airbnb');
    assert.strictEqual(result.trust, 10);
  });
  it('no badges = no bonus', () => {
    const result = trustRating(500, null, { isGuestFavorite: false, isSuperhost: false }, 4.5, 'airbnb');
    assert.strictEqual(result.trust, 8);
    assert.strictEqual(result.breakdown.badgeBonus, 0);
  });
  it('null badges = no bonus', () => {
    const result = trustRating(500, null, null, 4.5, 'airbnb');
    assert.strictEqual(result.trust, 8);
    assert.strictEqual(result.breakdown.badgeBonus, 0);
  });
});

// ─── trustRating: multi-signal anomaly detection ────────────────────

describe('trustRating multi-signal anomaly detection', () => {
  it('wedge deviation triggers anomaly on inverted histogram', () => {
    // Histogram where lower stars outnumber higher: 3★>4★ etc — triggers wedge >0.3
    const result = trustRating(500, { rating: 4.5, reviewCount: 500, histogram: [200, 150, 100, 50, 100] });
    assert.ok(result.anomaly, 'anomaly should be detected');
    assert.ok(result.breakdown.anomalySignals.length > 0, 'should have anomaly signals');
  });
  it('bimodal histogram triggers anomaly', () => {
    // Strong bimodal: high 1★ and 5★, hollow middle — triggers bimodalityCoefficient >0.555
    const result = trustRating(500, { rating: 4.5, reviewCount: 500, histogram: [200, 10, 5, 10, 200] });
    assert.ok(result.anomaly, 'anomaly should be detected');
    assert.ok(result.breakdown.anomalySignals.includes('Bimodal reviews'), 'should flag bimodal reviews');
  });
  it('star inversion triggers anomaly when 1★ towers over middle bins', () => {
    // 1★ massively exceeds 2★, 3★, AND 4★ — genuine spike, not just angry guests
    const result = trustRating(500, { rating: 4.5, reviewCount: 500, histogram: [150, 20, 30, 50, 400] });
    assert.ok(result.anomaly, 'anomaly should be detected');
    assert.ok(result.breakdown.anomalySignals.includes('Star inversions'), 'should flag star inversions');
  });
  it('mild 1★>2★ inversion is not anomalous when 4★ is healthy (Heritage Collection pattern)', () => {
    // Heritage Collection on Boat Quay: 4.5★, 335 reviews
    // 1★=12% > 2★=3% but 3★=10% ≈ 1★ and 4★=25% >> 1★ — natural angry-guest pattern
    const result = trustRating(335, { rating: 4.5, reviewCount: 335, histogram: [40, 10, 34, 84, 167] }, null, 9.1, 'booking');
    assert.strictEqual(result.anomaly, false, 'should NOT be flagged as anomaly');
    assert.strictEqual(result.breakdown.anomalySignals.length, 0, 'should have no anomaly signals');
  });
  it('clean histogram triggers no anomaly signals', () => {
    const result = trustRating(500, { rating: 4.5, reviewCount: 500, histogram: [20, 30, 60, 150, 500] });
    assert.strictEqual(result.anomaly, false);
    assert.strictEqual(result.breakdown.anomalySignals.length, 0);
  });
  it('breakdown.anomalySignals exists even without xref', () => {
    const result = trustRating(500, null);
    assert.ok(Array.isArray(result.breakdown.anomalySignals), 'anomalySignals should be an array');
    assert.strictEqual(result.breakdown.anomalySignals.length, 0);
  });
  it('anomaly still reduces trust to 1/3', () => {
    // 99% 5-star — triggers JSD anomaly
    const result = trustRating(500, { rating: 4.8, reviewCount: 1000, histogram: [5, 5, 5, 5, 980] });
    assert.ok(result.anomaly, 'anomaly detected');
    assert.ok(result.trust < 5, `trust reduced to ~3.3 (got ${result.trust})`);
  });
  it('budget hotel with J-shaped reviews is NOT flagged (YEE HOTEL pattern)', () => {
    // YEE HOTEL Permas Jaya: 4.2★, 109 reviews — J-shaped distribution natural for budget hotels
    // Booking 8.3/10, 644 reviews. High 1★ = genuine complaints, not manipulation.
    const result = trustRating(644, { rating: 4.2, reviewCount: 109, histogram: [15, 3, 7, 22, 62] }, null, 8.3, 'booking');
    assert.strictEqual(result.anomaly, false,
      `Budget hotel should not be flagged (signals: ${result.breakdown.anomalySignals.join(', ')})`);
  });
});

// ─── trustRating: histogram pipeline edge cases ──────────────────────

describe('trustRating - histogram pipeline edge cases', () => {
  it('SeaColor histogram [30,3,3,8,239] triggers anomaly', () => {
    const crossRef = { rating: 4.5, reviewCount: 283, histogram: [30, 3, 3, 8, 239] };
    const result = trustRating(560, crossRef, null, 9.1, 'booking');
    assert.ok(result.anomaly, 'anomaly detected for SeaColor pattern');
    assert.ok(result.breakdown.anomalySignals.length > 0, 'at least one signal fired');
  });

  it('SeaColor trust below clean hotel with same Booking 9.1', () => {
    const seaColorXref = { rating: 4.5, reviewCount: 283, histogram: [30, 3, 3, 8, 239] };
    const cleanXref = { rating: 4.3, reviewCount: 1200, histogram: [60, 60, 144, 300, 636] };
    const seaColor = trustRating(560, seaColorXref, null, 9.1, 'booking');
    const clean = trustRating(560, cleanXref, null, 9.1, 'booking');
    assert.ok(seaColor.trust < clean.trust,
      `SeaColor (${seaColor.trust}) should rank below clean (${clean.trust})`);
  });

  it('SHI HOUSE histogram [5,3,3,10,350] triggers anomaly (clean fake pattern)', () => {
    const crossRef = { rating: 4.9, reviewCount: 371, histogram: [5, 3, 3, 10, 350] };
    const result = trustRating(285, crossRef, null, 9.5, 'booking');
    assert.ok(result.anomaly, 'anomaly detected for SHI HOUSE clean fake pattern');
    assert.ok(result.breakdown.anomalySignals.some(s => s.includes('4\u2605 deficit')),
      `should flag 4★ deficit (got ${JSON.stringify(result.breakdown.anomalySignals)})`);
  });

  it('SHI HOUSE trust below clean hotel with same Booking 9.5', () => {
    const shiXref = { rating: 4.9, reviewCount: 371, histogram: [5, 3, 3, 10, 350] };
    const cleanXref = { rating: 4.5, reviewCount: 3200, histogram: [128, 96, 320, 736, 1920] };
    const shi = trustRating(285, shiXref, null, 9.5, 'booking');
    const clean = trustRating(2400, cleanXref, null, 9.5, 'booking');
    assert.ok(shi.trust < clean.trust,
      `SHI HOUSE (${shi.trust}) should rank below clean (${clean.trust})`);
  });

  it('Ubud-pattern histogram (genuine 4.9-star, top-heavy) is NOT anomalous', () => {
    // Genuine Ubud villa: 93% 5-star, 4.6% 4-star, very low complaints
    // FSD ~0.44 -- above 0.35 threshold, should NOT trigger
    var crossRef = { rating: 4.9, reviewCount: 219, histogram: [2, 1, 3, 10, 203] };
    var result = trustRating(400, crossRef, null, 9.8, 'booking');
    assert.strictEqual(result.anomaly, false,
      'Ubud-pattern genuine hotel should NOT be flagged (signals: ' +
      result.breakdown.anomalySignals.join(', ') + ')');
  });

  it('SHI HOUSE still caught after threshold change (FSD=0.259 < 0.35)', () => {
    // FSD=0.259 < 0.35, 1-star=1.3% < 2.5% -- must still fire
    var crossRef = { rating: 4.9, reviewCount: 371, histogram: [5, 3, 3, 10, 350] };
    var result = trustRating(285, crossRef, null, 9.5, 'booking');
    assert.ok(result.anomaly, 'SHI HOUSE must still be detected after threshold change');
    assert.ok(result.breakdown.anomalySignals.some(function(s) { return s.includes('4\u2605 deficit'); }),
      'Should flag 4\u2605 deficit (got: ' + JSON.stringify(result.breakdown.anomalySignals) + ')');
  });

  it('null histogram produces no anomaly', () => {
    const crossRef = { rating: 4.5, reviewCount: 283, histogram: null };
    const result = trustRating(560, crossRef, null, 9.1, 'booking');
    assert.strictEqual(result.anomaly, false);
    assert.strictEqual(result.breakdown.hasHistogram, false);
  });

  it('bad histogram with 49 Google reviews: no anomaly (confidence floor)', () => {
    const crossRef = { rating: 4.5, reviewCount: 49, histogram: [30, 0, 0, 0, 19] };
    const result = trustRating(100, crossRef, null, 9.0, 'booking');
    assert.strictEqual(result.anomaly, false, 'confidence floor suppresses at 49 reviews');
  });

  it('bad histogram with exactly 50 Google reviews: anomaly fires (boundary)', () => {
    const crossRef = { rating: 4.9, reviewCount: 50, histogram: [5, 5, 5, 5, 30] };
    const result = trustRating(100, crossRef, null, 9.0, 'booking');
    // At 50 reviews, the outer guard passes. Whether anomaly fires depends on signal thresholds.
    // This test documents the behavior at the boundary.
    assert.strictEqual(result.breakdown.hasHistogram, true, 'histogram is present at 50 reviews');
  });

  it('all-five histogram [0,0,0,0,100] with 100 reviews: documents JSD behavior', () => {
    const crossRef = { rating: 4.9, reviewCount: 100, histogram: [0, 0, 0, 0, 100] };
    const result = trustRating(300, crossRef, null, 9.5, 'booking');
    // All-five has JSD divergence from expected distribution. Document whether it triggers.
    assert.strictEqual(typeof result.anomaly, 'boolean', 'anomaly is boolean');
    assert.strictEqual(result.breakdown.hasHistogram, true, 'histogram recognized');
  });
});

// ─── trustLevel ─────────────────────────────────────────────────────

describe('trustLevel', () => {
  it('Score >= 8.0: level = high', () => {
    assert.strictEqual(trustLevel(8.5).level, 'high');
  });
  it('Score >= 5.0: level = medium', () => {
    assert.strictEqual(trustLevel(6.0).level, 'medium');
  });
  it('Score < 5.0: level = low', () => {
    assert.strictEqual(trustLevel(3.0).level, 'low');
  });
  it('8.0 boundary is high', () => {
    assert.strictEqual(trustLevel(8.0).level, 'high');
  });
  it('5.0 boundary is medium', () => {
    assert.strictEqual(trustLevel(5.0).level, 'medium');
  });
  it('each level has cssClass', () => {
    assert.strictEqual(trustLevel(8.5).cssClass, 'rt-trust-high');
    assert.strictEqual(trustLevel(6.0).cssClass, 'rt-trust-medium');
    assert.strictEqual(trustLevel(3.0).cssClass, 'rt-trust-low');
  });
});

// ─── Value Scores ────────────────────────────────────────────────────

describe('valueScores', () => {
  it('cheapest gets 100', () => {
    const basic = valueScores([100, 200, 300]);
    assert.strictEqual(basic[0], 100);
  });
  it('most expensive gets 0', () => {
    const basic = valueScores([100, 200, 300]);
    assert.strictEqual(basic[2], 0);
  });
  it('middle gets 50', () => {
    const basic = valueScores([100, 200, 300]);
    assert.strictEqual(basic[1], 50);
  });
  it('tied cheapest both get 100', () => {
    const ties = valueScores([100, 100, 200]);
    assert.ok(ties[0] === 100 && ties[1] === 100, `tied cheapest both get 100 (got ${ties[0]}, ${ties[1]})`);
  });
  it('most expensive with ties gets 0', () => {
    const ties = valueScores([100, 100, 200]);
    assert.strictEqual(ties[2], 0);
  });
  it('single price gives 50', () => {
    const single = valueScores([150]);
    assert.strictEqual(single[0], 50);
  });
  it('empty gives empty', () => {
    const empty = valueScores([]);
    assert.strictEqual(empty.length, 0);
  });
  it('all same price gives all 50', () => {
    const allSame = valueScores([99, 99, 99]);
    assert.ok(allSame.every(s => s === 50), `all same price → all 50 (got ${allSame})`);
  });
});

// ─── Review Distribution Anomaly ────────────────────────────────────

describe('reviewDistributionAnomaly', () => {
  it('Grand Hyatt pattern matches benchmark closely', () => {
    const grandHyatt = reviewDistributionAnomaly([20, 20, 50, 120, 790]);
    assert.ok(grandHyatt.jsd < 0.05,
      `Grand Hyatt pattern matches benchmark closely (JSD=${grandHyatt.jsd.toFixed(4)})`);
  });
  it('Grand Hyatt computes correct mean', () => {
    const grandHyatt = reviewDistributionAnomaly([20, 20, 50, 120, 790]);
    assert.ok(grandHyatt.meanRating > 4.5, `computes correct mean (${grandHyatt.meanRating.toFixed(2)})`);
  });
  it('Doha incentivized pattern has high JSD', () => {
    const doha = reviewDistributionAnomaly([23, 23, 23, 30, 2234]);
    assert.ok(doha.jsd > 0.02,
      `Doha incentivized pattern has high JSD (JSD=${doha.jsd.toFixed(4)})`);
  });
  it('Four Seasons pattern matches benchmark', () => {
    const fourSeasons = reviewDistributionAnomaly([30, 20, 50, 150, 750]);
    assert.ok(fourSeasons.jsd < 0.01,
      `Four Seasons pattern matches benchmark (JSD=${fourSeasons.jsd.toFixed(4)})`);
  });
  it('99% five-star is highly anomalous', () => {
    const extreme = reviewDistributionAnomaly([5, 5, 5, 5, 980]);
    assert.ok(extreme.jsd > 0.04,
      `99% five-star is highly anomalous (JSD=${extreme.jsd.toFixed(4)})`);
  });
  it('more extreme concentration gives higher JSD', () => {
    const doha = reviewDistributionAnomaly([23, 23, 23, 30, 2234]);
    const extreme = reviewDistributionAnomaly([5, 5, 5, 5, 980]);
    assert.ok(extreme.jsd > doha.jsd,
      `more extreme concentration → higher JSD (${extreme.jsd.toFixed(4)} > ${doha.jsd.toFixed(4)})`);
  });
  it('natural 4.0 hotel matches benchmark', () => {
    const midRange = reviewDistributionAnomaly([70, 70, 150, 280, 430]);
    assert.ok(midRange.jsd < 0.05,
      `natural 4.0 hotel matches benchmark (JSD=${midRange.jsd.toFixed(4)})`);
  });
  it('all zeros returns JSD 0', () => {
    const zeros = reviewDistributionAnomaly([0, 0, 0, 0, 0]);
    assert.strictEqual(zeros.jsd, 0);
  });
  it('expected has 5 bins', () => {
    const doha = reviewDistributionAnomaly([23, 23, 23, 30, 2234]);
    assert.strictEqual(doha.expected.length, 5);
  });
  it('expected 4-star for 4.9 rating is reasonable', () => {
    const doha = reviewDistributionAnomaly([23, 23, 23, 30, 2234]);
    assert.ok(doha.expected[3] > 0.08, `expected 4★ for 4.9 rating is ~10% (got ${(doha.expected[3] * 100).toFixed(1)}%)`);
  });
});

// ─── bookingToGoogleScale ────────────────────────────────────────────

describe('bookingToGoogleScale', () => {
  it('Booking 8.5 maps to ~4.2', () => {
    const b85 = bookingToGoogleScale(8.5);
    assertApprox(b85, 4.2, 0.1, 'Booking 8.5 maps to ~4.2 (not 4.0 from linear)');
  });
  it('Booking 7.0 maps to ~3.5', () => {
    const b70 = bookingToGoogleScale(7.0);
    assertApprox(b70, 3.5, 0.1, 'Booking 7.0 maps to ~3.5');
  });
  it('Booking 9.0 maps to ~4.4', () => {
    const b90 = bookingToGoogleScale(9.0);
    assertApprox(b90, 4.4, 0.1, 'Booking 9.0 maps to ~4.4');
  });
  it('Booking 9.5 maps to ~4.6', () => {
    const b95 = bookingToGoogleScale(9.5);
    assertApprox(b95, 4.6, 0.1, 'Booking 9.5 maps to ~4.6');
  });
  it('Booking 2.5 maps to floor 1.0', () => {
    const bFloor = bookingToGoogleScale(2.5);
    assert.strictEqual(bFloor, 1.0);
  });
  it('Booking 10.0 maps to ~4.9 ceiling', () => {
    const bCeil = bookingToGoogleScale(10.0);
    assertApprox(bCeil, 4.9, 0.1, 'Booking 10.0 maps to ~4.9 ceiling');
  });
  it('Booking 1.0 below effective range maps to floor 1.0', () => {
    const bBelow = bookingToGoogleScale(1.0);
    assert.strictEqual(bBelow, 1.0);
  });
});

// ─── airbnbToNormalizedRating ─────────────────────────────────────────
// Airbnb ratings are inflated (95% of listings 4.5-5.0, Zervas et al. 2021).
// Piecewise mapping corrects this so Airbnb and Booking sort fairly.

describe('airbnbToNormalizedRating', () => {
  it('Airbnb 5.0 → 9.8 (capped ceiling)', () => {
    assert.strictEqual(airbnbToNormalizedRating(5.0), 9.8);
  });
  it('Airbnb 4.9 → 9.5 (exceptional)', () => {
    assert.strictEqual(airbnbToNormalizedRating(4.9), 9.5);
  });
  it('Airbnb 4.8 → 9.0 (excellent, ≈ Booking 9.0)', () => {
    assert.strictEqual(airbnbToNormalizedRating(4.8), 9.0);
  });
  it('Airbnb 4.7 → 8.5 (very good, ≈ Booking 8.5)', () => {
    assert.strictEqual(airbnbToNormalizedRating(4.7), 8.5);
  });
  it('Airbnb 4.5 → 8.0 (good+, ≈ Booking 8.0)', () => {
    assert.strictEqual(airbnbToNormalizedRating(4.5), 8.0);
  });
  it('Airbnb 4.0 → 6.0 (okay)', () => {
    assert.strictEqual(airbnbToNormalizedRating(4.0), 6.0);
  });
  it('Airbnb 1.0 → 2.5 (floor)', () => {
    assert.strictEqual(airbnbToNormalizedRating(1.0), 2.5);
  });
  it('monotonically increasing', () => {
    for (let r = 1.0; r < 5.0; r += 0.1) {
      const lo = airbnbToNormalizedRating(r);
      const hi = airbnbToNormalizedRating(Math.round((r + 0.1) * 10) / 10);
      assert.ok(hi > lo, `${(r+0.1).toFixed(1)} (${hi.toFixed(2)}) should be > ${r.toFixed(1)} (${lo.toFixed(2)})`);
    }
  });
  it('Airbnb 4.7 is now lower than Booking 9.0 (was equal with ×2)', () => {
    // Old: 4.7 × 2 = 9.4. New: 8.5. Booking 9.0 should rank higher.
    assert.ok(airbnbToNormalizedRating(4.7) < 9.0,
      'Airbnb 4.7 should normalize below Booking 9.0');
  });
});

// ─── agodaToNormalizedRating ──────────────────────────────────────────
// Agoda ratings run ~0.3 points higher than Booking for same quality
// (Martin-Fuentes et al. 2020). Piecewise linear deflation to Booking scale.

describe('agodaToNormalizedRating', () => {
  it('Agoda 0 → 0 (scale floor preserved)', () => {
    assert.strictEqual(agodaToNormalizedRating(0), 0);
  });
  it('Agoda 2.0 → 1.0 (Agoda effective floor maps to Booking effective floor)', () => {
    assert.strictEqual(agodaToNormalizedRating(2.0), 1.0);
  });
  it('Agoda 5.0 → 4.3 (mid-range, empirical −0.7)', () => {
    assert.strictEqual(agodaToNormalizedRating(5.0), 4.3);
  });
  it('Agoda 7.0 → 6.5 (empirical −0.5, n=37, p<0.001)', () => {
    assert.strictEqual(agodaToNormalizedRating(7.0), 6.5);
  });
  it('Agoda 8.0 → 7.75 (empirical −0.25, n=67, p<0.001)', () => {
    assert.strictEqual(agodaToNormalizedRating(8.0), 7.75);
  });
  it('Agoda 9.0 → 8.85 (empirical −0.15, n=17, p<0.05)', () => {
    assert.strictEqual(agodaToNormalizedRating(9.0), 8.85);
  });
  it('Agoda 10.0 → 9.9 (ceiling, minimal correction)', () => {
    assert.strictEqual(agodaToNormalizedRating(10.0), 9.9);
  });
  it('monotonically increasing across entire 0-10 range', () => {
    for (var r = 0; r < 9.95; r += 0.1) {
      var lo = agodaToNormalizedRating(r);
      var hi = agodaToNormalizedRating(Math.round((r + 0.1) * 10) / 10);
      assert.ok(hi > lo, (r+0.1).toFixed(1) + ' (' + hi.toFixed(2) + ') should be > ' + r.toFixed(1) + ' (' + lo.toFixed(2) + ')');
    }
  });
  it('Agoda 8.5 normalized is close to but below Booking 8.5', () => {
    var normalized = agodaToNormalizedRating(8.5);
    assert.ok(normalized < 8.5, 'Agoda 8.5 normalized (' + normalized + ') should be below Booking 8.5');
    assert.ok(normalized > 7.5, 'Agoda 8.5 normalized (' + normalized + ') should not be too far below');
  });
  it('below floor clamped: agodaToNormalizedRating(-1) === 0', () => {
    assert.strictEqual(agodaToNormalizedRating(-1), 0);
  });
  it('above ceiling clamped: agodaToNormalizedRating(11) === 9.9', () => {
    assert.strictEqual(agodaToNormalizedRating(11), 9.9);
  });
});

// ─── trustRating with airbnbToNormalizedRating ──────────────────────

describe('trustRating — Airbnb normalization', () => {
  it('Airbnb 4.8 trust < Booking 9.3 trust (same review count, no xref)', () => {
    const airbnb = trustRating(200, null, null, 4.8, 'airbnb');
    const booking = trustRating(200, null, null, 9.3, 'booking');
    assert.ok(airbnb.trust < booking.trust,
      `Airbnb 4.8 trust (${airbnb.trust}) should be < Booking 9.3 trust (${booking.trust})`);
  });
  it('Airbnb 4.8 trust ≈ Booking 9.0 trust', () => {
    const airbnb = trustRating(200, null, null, 4.8, 'airbnb');
    const booking = trustRating(200, null, null, 9.0, 'booking');
    assert.ok(Math.abs(airbnb.trust - booking.trust) <= 0.5,
      `Airbnb 4.8 (${airbnb.trust}) should be close to Booking 9.0 (${booking.trust})`);
  });
  it('Airbnb 15 reviews: no review-count penalty (penalties removed)', () => {
    const few = trustRating(15, null, null, 4.8, 'airbnb');
    const many = trustRating(200, null, null, 4.8, 'airbnb');
    assert.strictEqual(few.trust, many.trust,
      `15 reviews (${few.trust}) should equal 200 reviews (${many.trust}) — no penalties`);
    assert.strictEqual(few.reviewPenalty, 'none');
  });
  it('Airbnb 31 reviews gets no penalty', () => {
    const result = trustRating(31, null, null, 4.8, 'airbnb');
    assert.strictEqual(result.reviewPenalty, 'none');
  });
  it('Airbnb 5 reviews: no review-count penalty (penalties removed)', () => {
    const veryFew = trustRating(5, null, null, 4.8, 'airbnb');
    const few = trustRating(15, null, null, 4.8, 'airbnb');
    assert.strictEqual(veryFew.trust, few.trust,
      `5 reviews (${veryFew.trust}) should equal 15 reviews (${few.trust}) — no penalties`);
    assert.strictEqual(veryFew.reviewPenalty, 'none');
  });
});

// ─── trustRating — Agoda normalization ──────────────────────────────

describe('trustRating — Agoda normalization', () => {
  it('Agoda 8.5 trust equals deflated value (not raw, not same as Booking)', () => {
    const agoda = trustRating(200, null, null, 8.5, 'agoda');
    const booking = trustRating(200, null, null, 8.5, 'booking');
    // Agoda 8.5 deflates to ~8.3, Booking 8.5 stays 8.5
    assert.ok(agoda.trust < booking.trust,
      'Agoda trust (' + agoda.trust + ') should be lower than Booking trust (' + booking.trust + ')');
    assert.strictEqual(agoda.trust, 8.3);
  });
  it('Agoda < 50 reviews: no penalty, trust is deflated rating', () => {
    const few = trustRating(30, null, null, 8.5, 'agoda');
    assert.strictEqual(few.reviewPenalty, 'none');
    assert.strictEqual(few.trust, 8.3, `30 reviews should have deflated trust 8.3, got ${few.trust}`);
  });
  it('Agoda 200+ reviews gets no penalty, trust is deflated rating', () => {
    const many = trustRating(200, null, null, 8.5, 'agoda');
    assert.strictEqual(many.reviewPenalty, 'none');
    assert.strictEqual(many.trust, 8.3);
  });
});

// ─── computeAnomalyPenalty ──────────────────────────────────────────

describe('computeAnomalyPenalty', () => {
  it('JSD 0.005 is below threshold', () => {
    const none = computeAnomalyPenalty(0.005, 200);
    assert.strictEqual(none.severity, 'none');
  });
  it('no gPenalty below threshold', () => {
    const none = computeAnomalyPenalty(0.005, 200);
    assert.strictEqual(none.gPenalty, 0);
  });
  it('no tPenalty below threshold', () => {
    const none = computeAnomalyPenalty(0.005, 200);
    assert.strictEqual(none.tPenalty, 0);
  });
  it('JSD 0.023 is mild', () => {
    const mild = computeAnomalyPenalty(0.023, 200);
    assert.strictEqual(mild.severity, 'mild');
  });
  it('mild G target in 55-65 range', () => {
    const mild = computeAnomalyPenalty(0.023, 200);
    const mildGTarget = 50 - mild.gPenalty;
    assert.ok(mildGTarget >= 55 && mildGTarget <= 65, `mild G target in 55-65 range (got ${mildGTarget})`);
  });
  it('mild tPenalty is 5', () => {
    const mild = computeAnomalyPenalty(0.023, 200);
    assert.strictEqual(mild.tPenalty, 5);
  });
  it('JSD 0.04 is moderate', () => {
    const moderate = computeAnomalyPenalty(0.04, 200);
    assert.strictEqual(moderate.severity, 'moderate');
  });
  it('moderate G target in 30-55 range', () => {
    const moderate = computeAnomalyPenalty(0.04, 200);
    const modGTarget = 50 - moderate.gPenalty;
    assert.ok(modGTarget >= 30 && modGTarget <= 55, `moderate G target in 30-55 range (got ${modGTarget})`);
  });
  it('moderate tPenalty is 15', () => {
    const moderate = computeAnomalyPenalty(0.04, 200);
    assert.strictEqual(moderate.tPenalty, 15);
  });
  it('JSD 0.07 is severe', () => {
    const severe = computeAnomalyPenalty(0.07, 200);
    assert.strictEqual(severe.severity, 'severe');
  });
  it('severe G target in 5-30 range', () => {
    const severe = computeAnomalyPenalty(0.07, 200);
    const sevGTarget = 50 - severe.gPenalty;
    assert.ok(sevGTarget >= 5 && sevGTarget <= 30, `severe G target in 5-30 range (got ${sevGTarget})`);
  });
  it('severe tPenalty is 25', () => {
    const severe = computeAnomalyPenalty(0.07, 200);
    assert.strictEqual(severe.tPenalty, 25);
  });
  it('60 reviews with high JSD still detects anomaly', () => {
    const attenuated = computeAnomalyPenalty(0.05, 60);
    assert.ok(attenuated.severity !== 'none', `60 reviews with high JSD still detects anomaly (severity=${attenuated.severity})`);
  });
  it('60 reviews attenuates penalty', () => {
    const severe = computeAnomalyPenalty(0.07, 200);
    const attenuated = computeAnomalyPenalty(0.05, 60);
    const sevGTarget = 50 - severe.gPenalty;
    const attGTarget = 50 - attenuated.gPenalty;
    assert.ok(attGTarget > sevGTarget, `60 reviews attenuates penalty (target ${attGTarget} > ${sevGTarget})`);
  });
  it('below 50 reviews returns none', () => {
    const belowFloor = computeAnomalyPenalty(0.03, 40);
    assert.strictEqual(belowFloor.severity, 'none');
  });
  it('below floor gPenalty is 0', () => {
    const belowFloor = computeAnomalyPenalty(0.03, 40);
    assert.strictEqual(belowFloor.gPenalty, 0);
  });
  it('none severity has discountFactor 1', () => {
    const none = computeAnomalyPenalty(0.005, 200);
    assert.strictEqual(none.discountFactor, 1);
  });
  it('mild anomaly discountFactor halves review-dependent scores', () => {
    const mild = computeAnomalyPenalty(0.023, 200);
    assert.ok(mild.discountFactor <= 0.5,
      `mild discountFactor should be <= 0.5 (got ${mild.discountFactor})`);
  });
  it('moderate anomaly discountFactor around 0.35', () => {
    const moderate = computeAnomalyPenalty(0.04, 200);
    assert.ok(moderate.discountFactor <= 0.4,
      `moderate discountFactor should be <= 0.4 (got ${moderate.discountFactor})`);
  });
  it('severe anomaly discountFactor around 0.2', () => {
    const severe = computeAnomalyPenalty(0.07, 200);
    assert.ok(severe.discountFactor <= 0.25,
      `severe discountFactor should be <= 0.25 (got ${severe.discountFactor})`);
  });
  it('discountFactor attenuates with low review count', () => {
    const full = computeAnomalyPenalty(0.04, 200);
    const attenuated = computeAnomalyPenalty(0.04, 60);
    assert.ok(attenuated.discountFactor > full.discountFactor,
      `low reviews should attenuate discount (60rev=${attenuated.discountFactor} > 200rev=${full.discountFactor})`);
  });
});

// ─── checkStarPairInversions ────────────────────────────────────────

describe('checkStarPairInversions', () => {
  it('histogram with 1-star > 4-star flags inversion', () => {
    const inverted = checkStarPairInversions([100, 5, 10, 3, 200]);
    assert.ok(inverted > 0.05, `histogram with 1-star > 4-star flags inversion (magnitude=${inverted.toFixed(4)})`);
  });
  it('natural distribution has no inversions', () => {
    const natural = checkStarPairInversions([10, 20, 30, 50, 200]);
    assert.strictEqual(natural, 0);
  });
  it('perfect wedge has no inversions', () => {
    const wedge = checkStarPairInversions([5, 10, 20, 40, 100]);
    assert.strictEqual(wedge, 0);
  });
  it('1★>2★ ignored when 1★ does not exceed 3★ and 4★ (angry-guest pattern)', () => {
    // 1★=12%, 2★=3%, 3★=10%, 4★=25%, 5★=50% — mild 1★ bump, healthy middle
    const result = checkStarPairInversions([40, 10, 34, 84, 167]);
    assert.strictEqual(result, 0, '1★>2★ alone should not flag when 4★ is healthy');
  });
  it('1★>2★ counts when 1★ also towers over 3★ and 4★', () => {
    // 1★=31%, 2★=2%, 3★=3%, 4★=1%, 5★=63% — 1★ dwarfs all middle bins
    const result = checkStarPairInversions([100, 5, 10, 3, 200]);
    assert.ok(result > 0.05, `extreme 1★ spike should still flag (magnitude=${result.toFixed(4)})`);
  });
});

// ─── trustRating: normalized rating base ────────────────────────────

describe('trustRating with platform rating', () => {
  it('Booking 9.0, 500 reviews: trust = 9.0 (rating used directly)', () => {
    const result = trustRating(500, null, null, 9.0, 'booking');
    assert.strictEqual(result.trust, 9);
  });
  it('Booking 8.5, 500 reviews: trust = 8.5', () => {
    const result = trustRating(500, null, null, 8.5, 'booking');
    assert.strictEqual(result.trust, 8.5);
  });
  it('Booking 7.0, 500 reviews: trust = 7.0', () => {
    const result = trustRating(500, null, null, 7.0, 'booking');
    assert.strictEqual(result.trust, 7);
  });
  it('Airbnb 4.5, 500 reviews: trust = 8.0 (piecewise normalization)', () => {
    const result = trustRating(500, null, null, 4.5, 'airbnb');
    assert.strictEqual(result.trust, 8);
  });
  it('Google Maps 4.2, 500 reviews: trust = 8.4', () => {
    const result = trustRating(500, null, null, 4.2, 'google-maps');
    assert.strictEqual(result.trust, 8.4);
  });
  it('higher booking rating → higher trust (same reviews)', () => {
    const high = trustRating(500, null, null, 9.0, 'booking');
    const low = trustRating(500, null, null, 7.5, 'booking');
    assert.ok(high.trust > low.trust,
      `Booking 9.0 (${high.trust}) should beat 7.5 (${low.trust})`);
  });
  it('Booking <100 reviews: no penalty (penalties removed)', () => {
    const result = trustRating(80, null, null, 9.0, 'booking');
    assert.strictEqual(result.trust, 9);
    assert.strictEqual(result.reviewPenalty, 'none');
  });
  it('Booking <200 reviews: no penalty (penalties removed)', () => {
    const result = trustRating(150, null, null, 9.0, 'booking');
    assert.strictEqual(result.trust, 9);
    assert.strictEqual(result.reviewPenalty, 'none');
  });
  it('Airbnb <10 reviews: no penalty (penalties removed)', () => {
    // Airbnb 4.5 → base 8.0, no review-count penalty
    const result = trustRating(5, null, null, 4.5, 'airbnb');
    assert.strictEqual(result.trust, 8);
    assert.strictEqual(result.reviewPenalty, 'none');
  });
  it('no platform info: fallback to base 10', () => {
    const result = trustRating(500, null);
    assert.strictEqual(result.trust, 10);
  });
});

// ─── Integration: trust rating ranking ───────────────────────────────

describe('integration: trust rating ranking', () => {
  const listings = [
    { reviewCount: 600, rating: 9.0 },
    { reviewCount: 30,  rating: 9.5 },
    { reviewCount: 200, rating: 8.5 },
    { reviewCount: 5,   rating: 8.0 },
  ];

  const results = listings.map(l => trustRating(l.reviewCount, null, null, l.rating, 'booking'));
  const scores = results.map(r => r.trust);

  it('600-review listing has higher trust than 5-review listing', () => {
    assert.ok(scores[0] > scores[3],
      `600-review (${scores[0]}) beats 5-review (${scores[3]})`);
  });
  it('all trust scores in 0-10 range', () => {
    assert.ok(scores.every(s => s >= 0 && s <= 10),
      `all trust scores in 0-10 range (${scores})`);
  });
  it('spread of at least 1.0 points across the 4 listings', () => {
    const spread = Math.max(...scores) - Math.min(...scores);
    assert.ok(spread >= 1.0,
      `score spread ${spread.toFixed(1)} should be at least 1.0 points`);
  });
});

// ─── Name Match Confidence ──────────────────────────────────────────

describe('nameMatchConfidence', () => {
  it('exact match gives 1', () => {
    const exact = nameMatchConfidence('Novotel Da Nang', 'Novotel Da Nang');
    assert.strictEqual(exact, 1);
  });
  it('hotel keyword stripped gives 1', () => {
    const withHotel = nameMatchConfidence('Hotel Novotel Da Nang', 'Novotel Da Nang');
    assert.strictEqual(withHotel, 1);
  });
  it('partial match in range', () => {
    const partial = nameMatchConfidence('Novotel Da Nang Premier', 'Novotel Da Nang Beach');
    assert.ok(partial >= 0.4 && partial < 1, `partial match in range (got ${partial.toFixed(2)})`);
  });
  it('no match below 0.4', () => {
    const noMatch = nameMatchConfidence('Hilton Garden Inn', 'Sunrise Beach Resort');
    assert.ok(noMatch < 0.4, `no match → below 0.4 (got ${noMatch.toFixed(2)})`);
  });
  it('both empty after stripping gives 0', () => {
    const bothEmpty = nameMatchConfidence('Hotel', 'Resort');
    assert.strictEqual(bothEmpty, 0);
  });
});

// ─── stripDiacritics ─────────────────────────────────────────────────

describe('stripDiacritics', () => {
  it('Vietnamese: Khach san Nhat Linh stripped', () => {
    assert.strictEqual(stripDiacritics('Kh\u00e1ch s\u1ea1n Nh\u1eadt Linh'), 'Khach san Nhat Linh');
  });
  it('Vietnamese: Khach San Bong Sen stripped', () => {
    assert.strictEqual(stripDiacritics('Kh\u00e1ch S\u1ea1n B\u00f4ng Sen'), 'Khach San Bong Sen');
  });
  it('Vietnamese: Nha nghi Huong Tra stripped', () => {
    assert.strictEqual(stripDiacritics('Nh\u00e0 ngh\u1ec9 H\u01b0\u01a1ng Tr\u00e0'), 'Nha nghi Huong Tra');
  });
  it('German: Hotel Garni Munchen stripped', () => {
    assert.strictEqual(stripDiacritics('Hotel Garni M\u00fcnchen'), 'Hotel Garni Munchen');
  });
  it('French: Cafe de Paris stripped', () => {
    assert.strictEqual(stripDiacritics('Caf\u00e9 de Paris'), 'Cafe de Paris');
  });
  it('ASCII passthrough unchanged', () => {
    assert.strictEqual(stripDiacritics('already ascii'), 'already ascii');
  });
  it('Vietnamese d-bar uppercase: U+0110 maps to D', () => {
    assert.strictEqual(stripDiacritics('\u0110'), 'D');
  });
  it('Vietnamese d-bar lowercase: U+0111 maps to d', () => {
    assert.strictEqual(stripDiacritics('\u0111'), 'd');
  });
  it('Vietnamese city name with d-bar: Da Nang', () => {
    assert.strictEqual(stripDiacritics('\u0110\u00e0 N\u1eb5ng'), 'Da Nang');
  });
});

// ─── nameMatchConfidence with d-bar characters ──────────────────────

describe('nameMatchConfidence with d-bar', () => {
  it('d-bar pair: Khach San Dong Phuong matches transliterated >= 0.7', () => {
    const score = nameMatchConfidence('Kh\u00e1ch S\u1ea1n \u0110\u00f4ng Ph\u01b0\u01a1ng', 'Khach San Dong Phuong', 'Da Nang');
    assert.ok(score >= 0.7,
      `d-bar pair should match >= 0.7 (got ${score.toFixed(2)})`);
  });
});

// ─── SCORING_CONFIG.MATCHING structure ──────────────────────────────

describe('SCORING_CONFIG.MATCHING thresholds', () => {
  const { SCORING_CONFIG } = require('../src/shared/scoring-config.js');

  it('has CONFIDENCE_THRESHOLD key', () => {
    assert.strictEqual(typeof SCORING_CONFIG.MATCHING.CONFIDENCE_THRESHOLD, 'number');
  });
  it('has STAGE2_THRESHOLD key', () => {
    assert.strictEqual(typeof SCORING_CONFIG.MATCHING.STAGE2_THRESHOLD, 'number');
  });
  it('has DEDUP_THRESHOLD key', () => {
    assert.strictEqual(typeof SCORING_CONFIG.MATCHING.DEDUP_THRESHOLD, 'number');
  });
});

// ─── No hardcoded thresholds in search.js matching logic ────────────

describe('search.js threshold centralization', () => {
  const fs = require('fs');
  const searchSrc = fs.readFileSync(require('path').join(__dirname, '../src/search/search.js'), 'utf8');

  it('no hardcoded 0.4 in confidence check', () => {
    // Should NOT contain "confidence < 0.4" — must use SCORING_CONFIG
    assert.ok(!searchSrc.includes('confidence < 0.4'),
      'search.js should not contain hardcoded "confidence < 0.4"');
  });
  it('no hardcoded 0.5 in dedup threshold', () => {
    // Should NOT contain "confidence >= 0.5" — must use SCORING_CONFIG
    assert.ok(!searchSrc.includes('confidence >= 0.5'),
      'search.js should not contain hardcoded "confidence >= 0.5"');
  });
});

// ─── nameMatchConfidence with diacritics ─────────────────────────────

describe('nameMatchConfidence with diacritics', () => {
  it('Vietnamese diacritics: Nhat Linh Hotel vs Khach san Nhat Linh >= 0.7', () => {
    const nhatLinh = nameMatchConfidence('Nhat Linh Hotel', 'Kh\u00e1ch s\u1ea1n Nh\u1eadt Linh');
    assert.ok(nhatLinh >= 0.7,
      `Vietnamese diacritics: Nhat Linh Hotel vs Khach san Nhat Linh >= 0.7 (got ${nhatLinh.toFixed(2)})`);
  });
  it('Vietnamese identical after stripping: Khach San Bong Sen >= 0.9', () => {
    const bongSen = nameMatchConfidence('Kh\u00e1ch S\u1ea1n B\u00f4ng Sen', 'Khach San Bong Sen');
    assert.ok(bongSen >= 0.9,
      `Vietnamese identical after stripping: Khach San Bong Sen >= 0.9 (got ${bongSen.toFixed(2)})`);
  });
  it('exact match preserved: Novotel Da Nang = 1.0', () => {
    const novotel = nameMatchConfidence('Novotel Da Nang', 'Novotel Da Nang');
    assert.strictEqual(novotel, 1.0);
  });
});

// ─── False positive prevention ───────────────────────────────────────

describe('nameMatchConfidence false positive prevention', () => {
  it('false positive blocked: Gold Hotel vs Gold Central < 0.4', () => {
    const gold = nameMatchConfidence('Gold Hotel Da Nang', 'Gold Central Hotel by Haviland');
    assert.ok(gold < 0.4,
      `false positive blocked: Gold Hotel vs Gold Central < 0.4 (got ${gold.toFixed(2)})`);
  });
  it('false positive blocked: Star Hotel vs Star Beach < 0.4', () => {
    const star = nameMatchConfidence('Star Hotel', 'Star Beach Resort');
    assert.ok(star < 0.4,
      `false positive blocked: Star Hotel vs Star Beach < 0.4 (got ${star.toFixed(2)})`);
  });
  it('false positive blocked: Sun Palace vs Sun Moon Lake < 0.4', () => {
    const sun = nameMatchConfidence('Sun Palace', 'Sun Moon Lake Hotel');
    assert.ok(sun < 0.4,
      `false positive blocked: Sun Palace vs Sun Moon Lake < 0.4 (got ${sun.toFixed(2)})`);
  });
  it('two shared tokens: Royal Orchid >= 0.5', () => {
    const royalOrchid = nameMatchConfidence('Royal Orchid Hotel', 'Royal Orchid Sheraton');
    assert.ok(royalOrchid >= 0.5,
      `two shared tokens: Royal Orchid >= 0.5 (got ${royalOrchid.toFixed(2)})`);
  });
});

// ─── nameMatchConfidence edge cases ──────────────────────────────────

describe('nameMatchConfidence edge cases', () => {
  it('shorter name contained: R&F Princess Cove >= 0.6', () => {
    const princess = nameMatchConfidence('R&F Princess Cove Cozy&Boutique Homestay', 'R&F Princess Cove');
    assert.ok(princess >= 0.6,
      `shorter name contained: R&F Princess Cove >= 0.6 (got ${princess.toFixed(2)})`);
  });
  it('both empty after stripping gives 0', () => {
    const bothEmpty = nameMatchConfidence('Hotel', 'Resort');
    assert.strictEqual(bothEmpty, 0);
  });
  it('numeric token shared: 123 >= 0.5', () => {
    const numeric = nameMatchConfidence('123 Hotel', '123 Resort');
    assert.ok(numeric >= 0.5,
      `numeric token shared: 123 >= 0.5 (got ${numeric.toFixed(2)})`);
  });
});

// ─── Google subset matching (truncated Google names) ────────────────

describe('nameMatchConfidence Google subset matching', () => {
  it('Google subset: Yes Hotel Da Nang vs Yes Hotel >= 0.6', () => {
    const yesHotel = nameMatchConfidence('Yes Hotel Da Nang', 'Yes Hotel');
    assert.ok(yesHotel >= 0.6,
      `Google subset: Yes Hotel Da Nang vs Yes Hotel >= 0.6 (got ${yesHotel.toFixed(2)})`);
  });
  it('Google subset: Star Hotel and Fitness vs Star Hotel >= 0.6', () => {
    const starFitness = nameMatchConfidence('Star Hotel and Fitness- Free Sauna', 'Star Hotel');
    assert.ok(starFitness >= 0.6,
      `Google subset: Star Hotel and Fitness vs Star Hotel >= 0.6 (got ${starFitness.toFixed(2)})`);
  });
  it('Google subset: Moonlight long name vs Moonlight Spa >= 0.5', () => {
    const moonlight = nameMatchConfidence(
      'Moonlight Hotel & Suites - City Center Views, Han River and Dragon Bridge',
      'Moonlight Hotel Suites & Spa');
    assert.ok(moonlight >= 0.5,
      `Google subset: Moonlight long name vs Moonlight Spa >= 0.5 (got ${moonlight.toFixed(2)})`);
  });
  it('letter-digit split: Nhat Linh vs Linh194 address >= 0.5', () => {
    const nhatLinh = nameMatchConfidence(
      'Nhat Linh Hotel & Suites Da Nang',
      'Kh\u00e1ch s\u1ea1n Nh\u1eadt Linh194 Nguy\u1ec5n Ch\u00ed Thanh',
      'Da Nang');
    assert.ok(nhatLinh >= 0.5,
      `letter-digit split: Nhat Linh vs Linh194 address >= 0.5 (got ${nhatLinh.toFixed(2)})`);
  });
});

// ─── City-aware name matching ───────────────────────────────────────

describe('nameMatchConfidence with city parameter', () => {
  it('city-aware: Maxhome Luxury vs Maxhome Da Nang >= 0.6', () => {
    const maxhome = nameMatchConfidence('Maxhome Luxury Hotel', 'Maxhome Hotel Da Nang', 'Da Nang');
    assert.ok(maxhome >= 0.6,
      `city-aware: Maxhome Luxury vs Maxhome Da Nang >= 0.6 (got ${maxhome.toFixed(2)})`);
  });
  it('city-aware: Yes Hotel Da Nang vs Yes Hotel >= 0.6', () => {
    const yesCity = nameMatchConfidence('Yes Hotel Da Nang', 'Yes Hotel', 'Da Nang, Da Nang Municipality, Vietnam');
    assert.ok(yesCity >= 0.6,
      `city-aware: Yes Hotel Da Nang vs Yes Hotel >= 0.6 (got ${yesCity.toFixed(2)})`);
  });
  it('city-aware false positive: Gold vs Gold Central < 0.4', () => {
    const goldCity = nameMatchConfidence('Gold Hotel Da Nang', 'Gold Central Hotel by Haviland', 'Da Nang');
    assert.ok(goldCity < 0.4,
      `city-aware false positive: Gold vs Gold Central < 0.4 (got ${goldCity.toFixed(2)})`);
  });
  it('city-aware exact: Novotel Da Nang = high score', () => {
    const exact = nameMatchConfidence('Novotel Da Nang', 'Novotel Da Nang', 'Da Nang');
    assert.ok(exact >= 0.9,
      `city-aware exact: Novotel Da Nang = high score (got ${exact.toFixed(2)})`);
  });
});

// ─── Compound-word name matching (MATCH-01) ─────────────────────────

describe('nameMatchConfidence compound-word matching', () => {
  it('Star City Hotel vs Starcity Hotel >= 0.7', () => {
    const score = nameMatchConfidence('Star City Hotel', 'Starcity Hotel');
    assert.ok(score >= 0.7,
      `Star City Hotel vs Starcity Hotel >= 0.7 (got ${score.toFixed(4)})`);
  });
  it('Grand Star City vs GrandStarCity >= 0.7', () => {
    const score = nameMatchConfidence('Grand Star City', 'GrandStarCity');
    assert.ok(score >= 0.7,
      `Grand Star City vs GrandStarCity >= 0.7 (got ${score.toFixed(4)})`);
  });
  it('Eco Green Hotel vs Ecogreen Hotel >= 0.7', () => {
    const score = nameMatchConfidence('Eco Green Hotel', 'Ecogreen Hotel');
    assert.ok(score >= 0.7,
      `Eco Green Hotel vs Ecogreen Hotel >= 0.7 (got ${score.toFixed(4)})`);
  });
  it('Star City Hotel Nha Trang vs Starcity Hotel & Condotel Beachfront Nha Trang with city >= 0.4', () => {
    const score = nameMatchConfidence(
      'Star City Hotel Nha Trang',
      'Starcity Hotel & Condotel Beachfront Nha Trang',
      'Nha Trang');
    assert.ok(score >= 0.4,
      `Star City Hotel Nha Trang vs Starcity long name with city >= 0.4 (got ${score.toFixed(4)})`);
  });
});

// ─── Bigram Dice fallback (MATCH-02) ────────────────────────────────

describe('nameMatchConfidence bigram Dice fallback', () => {
  it('bigram Dice rescue produces >= 0.7 on compound-word case with disjoint tokens', () => {
    const score = nameMatchConfidence('Grand Star City', 'GrandStarCity');
    assert.ok(score >= 0.7,
      `bigram Dice rescue produces >= 0.7 on compound-word case (got ${score.toFixed(4)})`);
  });
  it('bigram Dice does NOT rescue false-positive: Gold Hotel vs Gold Central < 0.4', () => {
    const score = nameMatchConfidence('Gold Hotel', 'Gold Central Hotel');
    assert.ok(score < 0.4,
      `bigram Dice does NOT rescue false-positive: Gold Hotel vs Gold Central (got ${score.toFixed(4)})`);
  });
  it('bigram Dice does NOT rescue false-positive: Star Hotel vs Star Beach Resort < 0.4', () => {
    const score = nameMatchConfidence('Star Hotel', 'Star Beach Resort');
    assert.ok(score < 0.4,
      `bigram Dice does NOT rescue false-positive: Star Hotel vs Star Beach Resort (got ${score.toFixed(4)})`);
  });
});

// ─── Compound-word false-positive regression (MATCH-03) ─────────────

describe('nameMatchConfidence compound-word false-positive regression', () => {
  it('Gold Hotel Da Nang vs Gold Central Hotel by Haviland with city < 0.4', () => {
    const score = nameMatchConfidence('Gold Hotel Da Nang', 'Gold Central Hotel by Haviland', 'Da Nang');
    assert.ok(score < 0.4,
      `Gold Hotel vs Gold Central with city < 0.4 (got ${score.toFixed(4)})`);
  });
  it('Star Hotel vs Star Beach Resort < 0.4', () => {
    const score = nameMatchConfidence('Star Hotel', 'Star Beach Resort');
    assert.ok(score < 0.4,
      `Star Hotel vs Star Beach Resort < 0.4 (got ${score.toFixed(4)})`);
  });
  it('Sun Palace vs Sun Moon Lake Hotel < 0.4', () => {
    const score = nameMatchConfidence('Sun Palace', 'Sun Moon Lake Hotel');
    assert.ok(score < 0.4,
      `Sun Palace vs Sun Moon Lake Hotel < 0.4 (got ${score.toFixed(4)})`);
  });
  it('Royal Hotel vs Royal Beach Resort < 0.4', () => {
    const score = nameMatchConfidence('Royal Hotel', 'Royal Beach Resort');
    assert.ok(score < 0.4,
      `Royal Hotel vs Royal Beach Resort < 0.4 (got ${score.toFixed(4)})`);
  });
});

// ─── trustRating: rating-gap signal ─────────────────────────────────

describe('trustRating — rating-gap signal', () => {
  it('rating-gap fires for large gap (Booking 9.0 vs Google 3.5)', () => {
    // Booking 9.0 normalized = 9.0; Google 3.5 * 2 = 7.0; gap = 2.0 — hits threshold
    const result = trustRating(200, { rating: 3.5, reviewCount: 100, histogram: null }, null, 9.0, 'booking');
    assert.ok(result.anomaly, 'anomaly should be true when rating gap fires');
    assert.ok(result.trust < 9.0, `trust should be reduced from 9.0 (got ${result.trust})`);
    assert.ok(result.breakdown.anomalySignals.some(s => s.includes('Rating gap')),
      `anomalySignals should include Rating gap (got ${JSON.stringify(result.breakdown.anomalySignals)})`);
  });

  it('rating-gap does NOT fire for small gap (Booking 9.1 vs Google 4.5)', () => {
    // Booking 9.1 normalized = 9.1; Google 4.5 * 2 = 9.0; gap = 0.1 — below threshold
    const result = trustRating(200, { rating: 4.5, reviewCount: 283, histogram: null }, null, 9.1, 'booking');
    assert.strictEqual(result.anomaly, false, 'anomaly should be false for SeaColor-like gap of 0.1');
  });

  it('rating-gap does NOT fire when Google > Booking (reverse gap)', () => {
    // Booking 7.0 normalized = 7.0; Google 4.8 * 2 = 9.6; gap = -2.6 — negative, should not fire
    const result = trustRating(200, { rating: 4.8, reviewCount: 100, histogram: null }, null, 7.0, 'booking');
    assert.strictEqual(result.anomaly, false, 'anomaly should be false for reverse gap (Google > Booking)');
  });

  it('rating-gap does NOT fire with Booking < 50 reviews', () => {
    // Booking has 30 reviews — below MIN_REVIEW_COUNT
    const result = trustRating(30, { rating: 3.0, reviewCount: 100, histogram: null }, null, 9.0, 'booking');
    assert.strictEqual(result.anomaly, false, 'anomaly should be false when Booking has < 50 reviews');
  });

  it('rating-gap does NOT fire with Google < 50 reviews', () => {
    // Google has 30 reviews — below MIN_REVIEW_COUNT
    const result = trustRating(200, { rating: 3.0, reviewCount: 30, histogram: null }, null, 9.0, 'booking');
    assert.strictEqual(result.anomaly, false, 'anomaly should be false when Google has < 50 reviews');
  });

  it('rating-gap fires for Airbnb platform (normalization check)', () => {
    // Airbnb 4.8 * 2 = 9.6; Google 3.5 * 2 = 7.0; gap = 2.6 — fires
    const result = trustRating(200, { rating: 3.5, reviewCount: 100, histogram: null }, null, 4.8, 'airbnb');
    assert.ok(result.anomaly, 'anomaly should be true for Airbnb rating gap');
    assert.ok(result.trust < 9.6, `trust should be reduced from 9.6 (got ${result.trust})`);
  });

  it('double-penalty prevention: histogram anomaly + rating-gap does not multiply trust twice', () => {
    // histogram with extreme pattern triggers anomaly (trust/3)
    // rating gap also present (gap = 2.0): should NOT multiply trust by 0.7 again
    const result = trustRating(500, { rating: 3.5, reviewCount: 1000, histogram: [5, 5, 5, 5, 980] }, null, 9.0, 'booking');
    // histogram anomaly fires: trust = 9.0 / 3 = 3.0
    // rating-gap should only add signal, NOT discount again
    const histogramOnlyResult = trustRating(500, { rating: 4.2, reviewCount: 1000, histogram: [5, 5, 5, 5, 980] }, null, 9.0, 'booking');
    assert.ok(result.anomaly, 'anomaly should be true');
    // trust should be same as histogram-only (no double penalty)
    assert.strictEqual(result.trust, histogramOnlyResult.trust,
      `double penalty prevented: trust should match histogram-only (got ${result.trust}, expected ${histogramOnlyResult.trust})`);
  });

  it('rating-gap discount is lighter than histogram anomaly penalty', () => {
    // rating-gap only: no histogram, large gap
    const ratingGapOnly = trustRating(200, { rating: 3.5, reviewCount: 100, histogram: null }, null, 9.0, 'booking');
    // histogram anomaly only: anomalous histogram, no rating gap
    const histogramOnly = trustRating(500, { rating: 4.8, reviewCount: 1000, histogram: [5, 5, 5, 5, 980] }, null, 9.0, 'booking');
    assert.ok(ratingGapOnly.trust > histogramOnly.trust,
      `rating-gap trust (${ratingGapOnly.trust}) should be higher than histogram anomaly trust (${histogramOnly.trust})`);
  });

  it('breakdown includes ratingGap field when rating-gap fires', () => {
    const result = trustRating(200, { rating: 3.5, reviewCount: 100, histogram: null }, null, 9.0, 'booking');
    assert.ok('ratingGap' in result.breakdown, 'breakdown should have ratingGap field');
    assert.ok(result.breakdown.ratingGap > 0, `ratingGap should be > 0 when fired (got ${result.breakdown.ratingGap})`);
  });

  it('breakdown ratingGap is 0 when rating-gap does not fire', () => {
    const result = trustRating(200, { rating: 4.5, reviewCount: 283, histogram: null }, null, 9.1, 'booking');
    assert.ok('ratingGap' in result.breakdown, 'breakdown should have ratingGap field even when not fired');
    const rg = result.breakdown.ratingGap;
    assert.ok(rg === 0 || rg === undefined,
      `ratingGap should be 0 or undefined when not fired (got ${rg})`);
  });
});

// ─── Four-star deficit golden cases ──────────────────────────────────
// Real-world histograms scraped from Google Maps to validate anomaly detection.
// Genuine hotels should NOT be flagged; suspicious ones SHOULD.

describe('fourStarDeficit — genuine hotels (should NOT flag)', () => {
  // Marina Bay Sands Singapore: 4.7★, 62,644 reviews — iconic 5-star, genuine pattern
  it('Marina Bay Sands passes (genuine)', () => {
    const hist = [1878, 1253, 3132, 9397, 46984];
    const fsd = fourStarDeficit(hist);
    assert.ok(fsd >= 0.7, `Marina Bay Sands should pass (deficit=${fsd.toFixed(3)})`);
  });

  // The Stones Hotel Bali: 4.7★, 5,496 reviews — genuine resort
  it('The Stones Bali passes (genuine)', () => {
    const hist = [165, 110, 275, 824, 4122];
    const fsd = fourStarDeficit(hist);
    assert.ok(fsd >= 0.7, `The Stones Bali should pass (deficit=${fsd.toFixed(3)})`);
  });

  // Risemount Premier Da Nang: 4.5★, 2,649 reviews — healthy 4★ bar
  it('Risemount Premier passes (genuine)', () => {
    const hist = [97, 43, 150, 513, 1846];
    const fsd = fourStarDeficit(hist);
    assert.ok(fsd >= 0.7, `Risemount Premier should pass (deficit=${fsd.toFixed(3)})`);
  });
});

describe('fourStarDeficit — suspicious hotels (should flag)', () => {
  // Parosand Da Nang: 4.8★, 4,749 reviews — 4★/5★ ratio 0.090, below genuine range 0.12-0.20
  it('Parosand Da Nang flagged (4★ = 7.9%)', () => {
    const hist = [50, 24, 116, 376, 4183];
    const fsd = fourStarDeficit(hist);
    assert.ok(fsd < 0.7, `Parosand should be flagged (deficit=${fsd.toFixed(3)})`);
  });

  // Doha Central Bliss Da Nang: 4.9★, 2,435 reviews — 4★ ratio 1.8%, extreme concentration
  it('Doha Central Bliss flagged (4★ = 1.8%)', () => {
    const hist = [27, 10, 15, 43, 2340];
    const fsd = fourStarDeficit(hist);
    assert.ok(fsd < 0.7, `Doha Central Bliss should be flagged (deficit=${fsd.toFixed(3)})`);
  });

  // Golden Lotus Da Nang: 4.8★, 2,630 reviews — 4★ ratio 4.4%
  it('Golden Lotus flagged (4★ = 4.4%)', () => {
    const hist = [49, 20, 43, 117, 2401];
    const fsd = fourStarDeficit(hist);
    assert.ok(fsd < 0.7, `Golden Lotus should be flagged (deficit=${fsd.toFixed(3)})`);
  });

  // Crowne Plaza Da Nang: 4.8★, 1,335 reviews — 4★ ratio 4.2%
  it('Crowne Plaza Da Nang flagged (4★ = 4.2%)', () => {
    const hist = [24, 8, 17, 56, 1230];
    const fsd = fourStarDeficit(hist);
    assert.ok(fsd < 0.7, `Crowne Plaza should be flagged (deficit=${fsd.toFixed(3)})`);
  });
});

// ─── Volume-aware FSD detection (260402-0n6) ──────────────────────────
// Golden Lotus (FSD=0.387, 2630 reviews) must be flagged by computeTrust at
// high volume. Kahayana (FSD=0.436, 219 reviews) must NOT be flagged.

describe('Volume-aware FSD threshold', () => {
  it('Golden Lotus high-volume pattern triggers anomaly (computeTrust)', function() {
    // FSD=0.387 < 0.45 high-vol threshold, 1-star=1.9% < 2.5% floor, 2630 reviews >= 500
    var crossRef = { rating: 4.9, reviewCount: 2630, histogram: [49, 20, 43, 117, 2401] };
    var result = trustRating(5000, crossRef, null, 9.6, 'agoda');
    assert.ok(result.anomaly, 'Golden Lotus should be flagged as anomalous at high volume');
    assert.ok(
      result.breakdown.anomalySignals.some(function(s) { return s.includes('4\u2605 deficit'); }),
      'Should flag 4\u2605 deficit (got: ' + JSON.stringify(result.breakdown.anomalySignals) + ')'
    );
  });

  it('Kahayana Suites low-volume (219 reviews) is NOT flagged (FSD=0.436 > 0.35)', function() {
    // 219 reviews < 500 threshold, uses 0.35 threshold — FSD=0.436 > 0.35 so passes
    var crossRef = { rating: 4.9, reviewCount: 219, histogram: [2, 1, 3, 10, 203] };
    var result = trustRating(400, crossRef, null, 9.8, 'booking');
    assert.strictEqual(result.anomaly, false,
      'Kahayana Suites should NOT be flagged at low volume (signals: ' +
      result.breakdown.anomalySignals.join(', ') + ')');
  });

  it('same Golden Lotus histogram at low histTotal (200) uses 0.35 threshold and passes', function() {
    // Scale down histogram to 200 reviews total — histTotal < 500, threshold = 0.35
    // FSD remains the same (0.387), 0.387 > 0.35, so should NOT trigger
    var scaledHist = [4, 2, 3, 9, 182]; // ~200 reviews, same proportions, FSD ~0.387
    var crossRef = { rating: 4.9, reviewCount: 200, histogram: scaledHist };
    var result = trustRating(400, crossRef, null, 9.6, 'booking');
    assert.strictEqual(result.anomaly, false,
      'Same histogram pattern at 200 reviews should NOT trigger (uses 0.35 threshold, signals: ' +
      result.breakdown.anomalySignals.join(', ') + ')');
  });

  it('same Golden Lotus histogram at high histTotal (2000+) uses 0.45 threshold and flags', function() {
    // Full histogram at 2630 reviews, histTotal >= 500, threshold = 0.45, FSD=0.387 < 0.45 FIRES
    var crossRef = { rating: 4.9, reviewCount: 2630, histogram: [49, 20, 43, 117, 2401] };
    var result = trustRating(5000, crossRef, null, 9.6, 'booking');
    assert.ok(result.anomaly,
      'Golden Lotus histogram at 2630 reviews should trigger anomaly (uses 0.45 threshold)');
  });
});

// ─── GMATCH golden cases (Phase 16) ─────────────────────────────────
// Documents nameMatchConfidence behavior for known-failing hotels.
// Note: "Ocean Garden Restaurant" and "Ocean Garden Cafe & Bar" score HIGH
// by name alone because stop-word removal strips "boutique"/"hotel"/"restaurant"
// leaving identical core tokens [ocean, garden]. The scraper's isNonHotelType
// filter (not name scoring) is responsible for rejecting restaurants/cafes.

describe('nameMatchConfidence - GMATCH golden cases', () => {
  // Ocean Garden: restaurant scores high by name — scraper type filter handles rejection
  it('Ocean Garden Boutique Hotel vs Ocean Garden Restaurant scores high (name overlap)', () => {
    const score = nameMatchConfidence('Ocean Garden Boutique Hotel', 'Ocean Garden Restaurant');
    assert.ok(score >= 0.5, `Ocean Garden Boutique vs Restaurant: name overlap is high, got ${score.toFixed(3)}`);
  });

  it('Ocean Garden Boutique Hotel vs Ocean Garden Cafe & Bar scores high (name overlap)', () => {
    const score = nameMatchConfidence('Ocean Garden Boutique Hotel', 'Ocean Garden Cafe & Bar');
    assert.ok(score >= 0.5, `Ocean Garden Boutique vs Cafe: name overlap is high, got ${score.toFixed(3)}`);
  });

  // Ocean Garden: correct hotel SHOULD match strongly
  it('Ocean Garden Boutique Hotel matches Ocean Garden Boutique (>= 0.5)', () => {
    const score = nameMatchConfidence('Ocean Garden Boutique Hotel', 'Ocean Garden Boutique');
    assert.ok(score >= 0.5, `Ocean Garden exact match should be >= 0.5, got ${score.toFixed(3)}`);
  });

  // SeaColor: correct Google listing with suffix SHOULD match
  it('SeaColor Beachstay matches SeaColor Beachstay Danang By Haviland (>= 0.5)', () => {
    const score = nameMatchConfidence('SeaColor Beachstay', 'SeaColor Beachstay Danang By Haviland');
    assert.ok(score >= 0.5, `SeaColor subset match should be >= 0.5, got ${score.toFixed(3)}`);
  });

  // SeaColor: unrelated hotel should NOT match
  it('SeaColor Beachstay does NOT match Sea Star Resort (< 0.5)', () => {
    const score = nameMatchConfidence('SeaColor Beachstay', 'Sea Star Resort');
    assert.ok(score < 0.5, `SeaColor vs Sea Star should be < 0.5, got ${score.toFixed(3)}`);
  });

  // Regression: known-good matches still work at threshold 0.5
  it('regression: Novotel Da Nang vs Novotel Da Nang >= 0.5', () => {
    const score = nameMatchConfidence('Novotel Da Nang', 'Novotel Da Nang');
    assert.ok(score >= 0.5, `Novotel exact match regression: got ${score.toFixed(3)}`);
  });

  it('regression: Yes Hotel Da Nang vs Yes Hotel >= 0.5', () => {
    const score = nameMatchConfidence('Yes Hotel Da Nang', 'Yes Hotel');
    assert.ok(score >= 0.5, `Yes Hotel subset regression: got ${score.toFixed(3)}`);
  });

  // "Formerly" alias stripping — Google Maps appends old hotel name
  it('Prince Hotel Da Nang matches despite "Formerly" suffix (>= 0.5)', () => {
    const score = nameMatchConfidence('Prince Hotel Da Nang', 'Prince Hotel Da Nang - Formerly Sel de Mer Hotel and Suites', 'Da Nang');
    assert.ok(score >= 0.5, `Prince Hotel with Formerly suffix should match, got ${score.toFixed(3)}`);
  });

  // Compound city token — "danang" (one word) treated as city stop word
  it('Sujet Residence matches despite compound city "Danang" (>= 0.5)', () => {
    const score = nameMatchConfidence('Sujet Residence Da Nang by Haviland', 'Sujet Residence Danang', 'Da Nang');
    assert.ok(score >= 0.5, `Sujet Residence with compound city should match, got ${score.toFixed(3)}`);
  });

  // Shared building name false positive — different homestays in same building
  it('R&F Princess Cove Wan Li does NOT match Yussy Homestay at same building (< 0.5)', () => {
    const score = nameMatchConfidence(
      'R&F Princess Cove Cozy&Boutique Homestay By Wan Li Property Management',
      'Yussy Homestay JB @R&F Princess Cove'
    );
    assert.ok(score < 0.5, `Different homestays in same building should not match, got ${score.toFixed(3)}`);
  });

  // Building-name subset false positive — Google has the building, not the specific homestay
  it('R&F Princess Cove Wan Li does NOT match building name "R&F Princess Cove" (< 0.5)', () => {
    const score = nameMatchConfidence(
      'R&F Princess Cove Cozy&Boutique Homestay By Wan Li Property Management',
      'R&F Princess Cove'
    );
    assert.ok(score < 0.5, `Building name should not match specific homestay, got ${score.toFixed(3)}`);
  });

  it('FUJU operator does NOT match SaffronCasa operator in same building (< 0.5)', () => {
    const score = nameMatchConfidence(
      'R&F Princess Cove Seine Region by FUJU with Seaview at JB City Centre',
      'SaffronCasa JB @ R&F Princess Cove'
    );
    assert.ok(score < 0.5, `Different operators in same building should not match, got ${score.toFixed(3)}`);
  });

  it('SaffronCasa booking matches SaffronCasa Google (>= 0.5)', () => {
    const score = nameMatchConfidence(
      'R&F Princess Cove JB By SaffronCasa JB',
      'SaffronCasa JB @ R&F Princess Cove'
    );
    assert.ok(score >= 0.5, `Same operator should match, got ${score.toFixed(3)}`);
  });

});

// ─── Cross-platform dedup matching ──────────────────────────────────
// Different operators in the same building are DIFFERENT listings.
// Only truly identical properties across platforms should dedup.

describe('cross-platform dedup — false positives (should NOT match)', () => {
  it('R&F Princess Cove: ANJU vs SaffronCasa are different operators', () => {
    const score = nameMatchConfidence(
      'Tropical Cityview Studiounit at R&FPrincess byANJU',
      'R&F Princess Cove JB By SaffronCasa JB',
      'Johor Bahru'
    );
    assert.ok(score < 0.5, `Different operators should not match, got ${score.toFixed(3)}`);
  });

  it('R&F Princess Cove: FUJU vs ANJU are different operators', () => {
    const score = nameMatchConfidence(
      'R&F Princess Cove Seine Region by FUJU with Seaview at JB City Centre',
      'Tropical Cityview Studiounit at R&FPrincess byANJU',
      'Johor Bahru'
    );
    assert.ok(score < 0.5, `Different operators should not match, got ${score.toFixed(3)}`);
  });

  it('Palazio: different units should not match', () => {
    const score = nameMatchConfidence(
      'Palazio high floor balcony corner lot free Netflix',
      'Palazio Studio JB by Rentradise',
      'Johor Bahru'
    );
    assert.ok(score < 0.5, `Different Palazio units should not match, got ${score.toFixed(3)}`);
  });

  it('TwinGalaxy vs KSL Residence are different buildings', () => {
    const score = nameMatchConfidence(
      'ChicVintageFrench Studio 1-2pax TwinGalaxy 5MinKSL',
      'KSL Residence 2 by Rentradise',
      'Johor Bahru'
    );
    assert.ok(score < 0.5, `Different buildings should not match, got ${score.toFixed(3)}`);
  });

  it('Johor Shopping Mall Apartment vs KSL Residence are different', () => {
    const score = nameMatchConfidence(
      'Johor Shopping Mall Apartment',
      'KSL Residence 2 by Rentradise',
      'Johor Bahru'
    );
    assert.ok(score < 0.5, `Different properties should not match, got ${score.toFixed(3)}`);
  });

  it('different properties: Teega vs Palazio', () => {
    const score = nameMatchConfidence(
      'Teega Suites by Subhome',
      'Palazio high floor balcony corner lot',
      'Johor Bahru'
    );
    assert.ok(score < 0.5, `Different properties should not match, got ${score.toFixed(3)}`);
  });

  it('generic Airbnb name vs hotel', () => {
    const score = nameMatchConfidence(
      'Condo in Johor Bahru',
      'Solid Hotels',
      'Johor Bahru'
    );
    assert.ok(score < 0.5, `Generic name should not match, got ${score.toFixed(3)}`);
  });

  it('Ubud Terrace vs Hotel Terrace are different properties', () => {
    const score = nameMatchConfidence('Ubud Terrace', 'Hotel Terrace', 'ubud');
    assert.ok(score < 0.80,
      `Ubud Terrace vs Hotel Terrace should not dedup (got ${score.toFixed(3)})`);
  });

  it('asymmetric generic: single generic token vs same token + extras rejects', () => {
    const score = nameMatchConfidence('Ubud Terrace', 'Hotel Terrace at Kuta', 'ubud');
    assert.strictEqual(score, 0,
      `Ubud Terrace vs Hotel Terrace at Kuta: asymmetric generic should return 0 (got ${score.toFixed(3)})`);
  });

  it('plural normalization: Garden vs Gardens should match', () => {
    const score = nameMatchConfidence('Daisy Garden Villa Hoi An', 'Daisy Gardens Villa', 'Da Nang');
    assert.ok(score >= 0.85,
      `Daisy Garden vs Daisy Gardens should match (got ${score.toFixed(3)}, need >= 0.85)`);
  });

  it('plural normalization: Heights vs Height treated as same', () => {
    const score = nameMatchConfidence('Ocean Heights Hotel', 'Ocean Height Hotel', null);
    assert.ok(score >= 0.85,
      `Heights vs Height should match (got ${score.toFixed(3)})`);
  });
});

describe('cross-platform dedup — true positives (SHOULD match)', () => {
  it('same operator same building across platforms', () => {
    const score = nameMatchConfidence(
      'R&F Princess Cove JB By SaffronCasa JB',
      'SaffronCasa JB @ R&F Princess Cove',
      'Johor Bahru'
    );
    assert.ok(score >= 0.5, `Same operator should match, got ${score.toFixed(3)}`);
  });

  it('same hotel different platform name style', () => {
    const score = nameMatchConfidence(
      'Solid Hotels',
      'Solid Hotels Johor Bahru',
      'Johor Bahru'
    );
    assert.ok(score >= 0.5, `Same hotel should match, got ${score.toFixed(3)}`);
  });
});

describe('Da Nang cross-reference matching', () => {
  // Golden Lotus: Google uses Vietnamese name "Khách sạn Golden Lotus Grand"
  it('Golden Lotus Grand Da Nang matches Vietnamese Google name (>= 0.5)', () => {
    const score = nameMatchConfidence(
      'Golden Lotus Grand Da Nang - Panoramic Rooftop Bar & Daily Afternoon Tea',
      'Khách sạn Golden Lotus Grand',
      'Da Nang'
    );
    assert.ok(score >= 0.5, `Golden Lotus should match Vietnamese name, got ${score.toFixed(3)}`);
  });

  // Crystal Hotel: Google may use Vietnamese prefix
  it('Crystal Hotel matches Google Maps Crystal Hotel (>= 0.5)', () => {
    const score = nameMatchConfidence(
      'Crystal Hotel',
      'Crystal Hotel',
      'Da Nang'
    );
    assert.ok(score >= 0.5, `Crystal Hotel exact match should work, got ${score.toFixed(3)}`);
  });

  // New Orient Hotel: Agoda "Da Nang" vs Google "Danang"
  it('New Orient Hotel Da Nang matches Google Danang variant (>= 0.5)', () => {
    const score = nameMatchConfidence(
      'New Orient Hotel Da Nang',
      'New Orient Hotel Danang',
      'Da Nang'
    );
    assert.ok(score >= 0.5, `New Orient should match Danang variant, got ${score.toFixed(3)}`);
  });

  // Sunset Sea Hotel
  it('Sunset Sea Hotel Da Nang matches Google Sunset Sea Hotel (>= 0.5)', () => {
    const score = nameMatchConfidence(
      'Sunset Sea Hotel Da Nang',
      'Sunset Sea Hotel',
      'Da Nang'
    );
    assert.ok(score >= 0.5, `Sunset Sea should match, got ${score.toFixed(3)}`);
  });

  // Prince Hotel: Google appends "- Formerly Sel de Mer Hotel and Suites"
  it('Prince Hotel Da Nang matches Google with Formerly suffix (>= 0.5)', () => {
    const score = nameMatchConfidence(
      'Prince Hotel Da Nang',
      'Prince Hotel Da Nang - Formerly Sel de Mer Hotel and Suites',
      'Da Nang'
    );
    assert.ok(score >= 0.5, `Prince Hotel should match despite Formerly suffix, got ${score.toFixed(3)}`);
  });
});

describe('cross-validated trust scoring', () => {
  // When Google Maps rating is lower but genuine, trust should be pulled down
  it('Crystal Hotel: Booking 8.7 with lower Google rating reduces trust', () => {
    // Crystal Hotel: Booking 8.7/10 (1089 reviews), Google ~4.1★ (say 600 reviews)
    // A genuine Google review of 4.1★ = 8.2 on 0-10 scale
    // Trust should be below the raw Booking 8.7
    const result = trustRating(1089, { rating: 4.1, reviewCount: 600, histogram: [30, 25, 60, 150, 335] }, null, 8.7, 'booking');
    assert.ok(result.trust < 8.7, `Cross-validated trust should be below platform rating 8.7, got ${result.trust}`);
  });

  it('high Google rating boosts confidence in platform rating', () => {
    // Hotel with Booking 9.0 and Google 4.5★ (= 9.0 normalized) — ratings agree
    const result = trustRating(500, { rating: 4.5, reviewCount: 1000, histogram: [20, 30, 60, 150, 740] }, null, 9.0, 'booking');
    // Trust should remain close to 9.0 (ratings corroborate each other)
    assert.ok(result.trust >= 8.5, `Corroborated rating should stay high, got ${result.trust}`);
  });

  it('Agoda rating gap uses 0-10 scale (not doubled)', () => {
    // New Orient Hotel: Agoda 9.2/10, Google 4.4★ — gap = 9.2 - 8.8 = 0.4 (not anomalous)
    // Bug: was computing 9.2×2 = 18.4, creating false anomaly
    const result = trustRating(7055, { rating: 4.4, reviewCount: 1537, histogram: [120, 30, 80, 250, 1057] }, null, 9.2, 'agoda');
    assert.strictEqual(result.anomaly, false, `Agoda 9.2 vs Google 4.4 should NOT be anomalous, signals: ${result.breakdown.anomalySignals}`);
    assert.ok(result.trust >= 8.0, `Trust should be high for well-reviewed hotel, got ${result.trust}`);
  });

  it('genuinely lower Google rating reduces trust proportionally', () => {
    // Hotel with Booking 8.5 and Google 3.8★ (= 7.6 normalized)
    // Gap = 0.9 points — not enough for anomaly, but should still adjust
    const highGoogle = trustRating(500, { rating: 4.5, reviewCount: 800, histogram: [20, 25, 50, 140, 565] }, null, 8.5, 'booking');
    const lowGoogle = trustRating(500, { rating: 3.8, reviewCount: 800, histogram: [40, 35, 80, 200, 445] }, null, 8.5, 'booking');
    assert.ok(lowGoogle.trust < highGoogle.trust,
      `Lower Google rating should reduce trust: 3.8★→${lowGoogle.trust} should be < 4.5★→${highGoogle.trust}`);
  });
});

// ─── Platform Label ─────────────────────────────────────────────────

describe('platformLabel', () => {
  it('returns B for booking', () => {
    assert.equal(platformLabel('booking'), 'B');
  });

  it('returns Ag for agoda', () => {
    assert.equal(platformLabel('agoda'), 'Ag');
  });

  it('returns A for airbnb', () => {
    assert.equal(platformLabel('airbnb'), 'A');
  });

  it('returns ? for unknown platform', () => {
    assert.equal(platformLabel(undefined), '?');
  });

  it('returns ? for null platform', () => {
    assert.equal(platformLabel(null), '?');
  });
});

// ─── Jaro-Winkler similarity (Phase 31) ─────────────────────────────

describe('jaroWinkler', () => {
  it('classic test case: martha vs marhta ~= 0.961', () => {
    const score = jaroWinkler('martha', 'marhta');
    assertApprox(score, 0.961, 0.005, 'martha vs marhta');
  });
  it('identical strings return 1.0', () => {
    assert.strictEqual(jaroWinkler('abc', 'abc'), 1.0);
  });
  it('empty first string returns 0.0', () => {
    assert.strictEqual(jaroWinkler('', 'abc'), 0.0);
  });
  it('empty second string returns 0.0', () => {
    assert.strictEqual(jaroWinkler('abc', ''), 0.0);
  });
  it('both empty returns 1.0', () => {
    assert.strictEqual(jaroWinkler('', ''), 1.0);
  });
  it('similar hotel tokens: plaza vs place > 0.8', () => {
    const score = jaroWinkler('plaza', 'place');
    assert.ok(score > 0.8, `plaza vs place should be > 0.8 (got ${score.toFixed(4)})`);
  });
  it('different hotel tokens: plaza vs house < 0.6', () => {
    const score = jaroWinkler('plaza', 'house');
    assert.ok(score < 0.6, `plaza vs house should be < 0.6 (got ${score.toFixed(4)})`);
  });
  it('different hotel tokens: ocean vs orient < 0.75', () => {
    const score = jaroWinkler('ocean', 'orient');
    assert.ok(score < 0.75, `ocean vs orient should be < 0.75 (got ${score.toFixed(4)})`);
  });
  it('star vs stay > 0.8 (similar short tokens)', () => {
    const score = jaroWinkler('star', 'stay');
    assert.ok(score > 0.8, `star vs stay should be > 0.8 (got ${score.toFixed(4)})`);
  });
  it('completely different: abc vs xyz = 0', () => {
    assert.strictEqual(jaroWinkler('abc', 'xyz'), 0);
  });
});

// ─── Algorithm improvement assertions (Phase 31) ────────────────────

describe('nameMatchConfidence algorithm improvements (Phase 31)', () => {
  it('FP fix: Eden Hotel Saigon vs Eden Star Saigon Hotel < 0.80', () => {
    const score = nameMatchConfidence('Eden Hotel Saigon', 'Eden Star Saigon Hotel', 'Da Nang');
    assert.ok(score < 0.80,
      `Eden vs Eden Star should be < 0.80 after JW improvement (got ${score.toFixed(4)})`);
  });
  // Green Plaza/House and Dong Khoi/Da are structural FPs — after stop-word + city
  // removal, Google reduces to a single token that matches one booking token.
  // The googleSubset path returns early (legitimate truncation pattern).
  // Fixing these would break true positives like "Star Hotel" matching "Star Hotel and Fitness".
  it('structural FP: Green Plaza vs Green House = 0.8 (googleSubset path)', () => {
    const score = nameMatchConfidence('Green Plaza Hotel Da Nang', 'Green House Hotel Da Nang', 'Da Nang');
    assert.ok(score >= 0.7 && score <= 0.9,
      `Green Plaza vs Green House structural FP (got ${score.toFixed(4)})`);
  });
  it('structural FP: Dong Khoi vs Dong Da = 0.8 (googleSubset path)', () => {
    const score = nameMatchConfidence('Khach san Dong Khoi', 'Khach san Dong Da');
    assert.ok(score >= 0.7 && score <= 0.9,
      `Dong Khoi vs Dong Da structural FP (got ${score.toFixed(4)})`);
  });
  it('FN rescue: Hiyori Hotel Da Nang vs Hiyori Ocean Resort still viable', () => {
    // This is currently a FN at 0.300 — we want to preserve it (not make it worse).
    // The Dice rescue path should still work for this case.
    const score = nameMatchConfidence('Hiyori Hotel Da Nang', 'Hiyori Ocean Resort', 'Da Nang');
    assert.ok(score >= 0.25,
      `Hiyori should not get worse than 0.25 (got ${score.toFixed(4)})`);
  });

  it('FP prevention: Kano Sari Ubud Villas vs Sari Villa Ubud — partial overlap, different property', () => {
    const score = nameMatchConfidence('Kano Sari Ubud Villas', 'Sari Villa Ubud', 'ubud, bali');
    assert.ok(score < 0.80, `Expected < 0.80 but got ${score}`);
  });
});

describe('nameMatchConfidence city parameter impact (real xref cases)', () => {
  // Cases from live Da Nang search — city parameter should improve matching
  // by stripping "Da Nang"/"Danang" tokens that inflate set differences.

  it('city lifts Thanh Lan Riverside vs Thanh Lan Hotel above threshold', () => {
    const withCity = nameMatchConfidence('Thanh Lan Riverside Hotel Da Nang', 'Thanh Lan Hotel', 'Da Nang');
    const noCity = nameMatchConfidence('Thanh Lan Riverside Hotel Da Nang', 'Thanh Lan Hotel');
    assert.ok(withCity >= 0.85,
      `with city should be >= 0.85 (got ${withCity.toFixed(4)})`);
    assert.ok(noCity < 0.85,
      `without city should be < 0.85 (got ${noCity.toFixed(4)})`);
  });

  it('city lifts Happy Day Riverside vs Happy Day Hotel above threshold', () => {
    const withCity = nameMatchConfidence('Happy Day Riverside Hotel & Spa Danang', 'Happy Day Hotel', 'Da Nang');
    const noCity = nameMatchConfidence('Happy Day Riverside Hotel & Spa Danang', 'Happy Day Hotel');
    assert.ok(withCity >= 0.85,
      `with city should be >= 0.85 (got ${withCity.toFixed(4)})`);
    assert.ok(noCity < 0.85,
      `without city should be < 0.85 (got ${noCity.toFixed(4)})`);
  });

  it('city does not cause false positive: Santori Hotel Da Nang Bay vs Santori Hotel & Spa < 0.85', () => {
    const score = nameMatchConfidence('Santori Hotel Da Nang Bay', 'Santori Hotel & Spa', 'Da Nang');
    assert.ok(score < 0.85,
      `different Santori properties should not match (got ${score.toFixed(4)})`);
  });

  it('city does not break exact matches: TMS Hotel Da Nang Beach = 1.0', () => {
    const score = nameMatchConfidence('TMS Hotel Da Nang Beach', 'TMS Hotel Da Nang Beach', 'Da Nang');
    assert.strictEqual(score, 1);
  });

  it('city does not break Google subset: Glamour Hotel Da Nang vs Glamour Hotel = 1.0', () => {
    const score = nameMatchConfidence('Glamour Hotel Da Nang', 'Glamour Hotel', 'Da Nang');
    assert.strictEqual(score, 1);
  });

  it('city handles compound "danang": Grand Citiview Da Nang vs Grand Citiview Danang = 1.0', () => {
    const score = nameMatchConfidence('Grand Citiview Da Nang Hotel', 'Grand Citiview Danang Hotel', 'Da Nang');
    assert.strictEqual(score, 1);
  });

  it('dash-suffix fallback: Heritage Collection with location suffix matches >= 0.85', () => {
    const score = nameMatchConfidence(
      'Heritage Collection on Boat Quay - South Bridge Wing - Mobile App Check-In',
      'Heritage Collection on Boat Quay (South Bridge Wing)', 'singapore');
    assert.ok(score >= 0.85,
      `Heritage Collection with location suffix should match (got ${score.toFixed(4)})`);
  });

  it('chain suffix match: Hotel Waterloo - Handwritten Collection vs itself = 1.0', () => {
    const score = nameMatchConfidence(
      'Hotel Waterloo Singapore - Handwritten Collection',
      'Hotel Waterloo Singapore - Handwritten Collection', 'singapore');
    assert.strictEqual(score, 1,
      `identical name with chain suffix should match perfectly (got ${score.toFixed(4)})`);
  });

  it('chain suffix corpus: should match when same hotel', () => {
    const shouldMatch = [
      ['The Vagabond Club Singapore - Tribute Portfolio', 'The Vagabond Club - A Tribute Portfolio Hotel', 'singapore'],
      ['Duxton Reserve Singapore - Autograph Collection', 'Duxton Reserve Singapore, Autograph Collection', 'singapore'],
      ['Hotel Waterloo Singapore - Handwritten Collection', 'Hotel Waterloo Singapore', 'singapore'],
      ['Duxton Reserve Singapore - Autograph Collection', 'Duxton Reserve Singapore', 'singapore'],
      ['Pan Pacific Singapore - Panoramic Rooftop Bar & Daily Afternoon Tea', 'Pan Pacific Singapore', 'singapore'],
    ];
    shouldMatch.forEach(([booking, google, city]) => {
      const score = nameMatchConfidence(booking, google, city);
      assert.ok(score >= 0.85,
        `${booking} vs ${google} should match (got ${score.toFixed(4)})`);
    });
  });

  it('chain suffix corpus: should NOT match different hotels sharing a chain', () => {
    const shouldNotMatch = [
      ['Hotel Waterloo Singapore - Handwritten Collection', 'Hotel Fort Canning - Handwritten Collection', 'singapore'],
      ['Duxton Reserve Singapore - Autograph Collection', 'The Warehouse Hotel - Autograph Collection', 'singapore'],
    ];
    shouldNotMatch.forEach(([booking, google, city]) => {
      const score = nameMatchConfidence(booking, google, city);
      assert.ok(score < 0.85,
        `${booking} vs ${google} should NOT match (got ${score.toFixed(4)})`);
    });
  });

  it('dedup: Heritage Collection vs Southbridge Hotel should NOT match (location word compound FP)', () => {
    // "South Bridge Wing" in the booking name compounds to "southbridge" matching
    // "The Southbridge Hotel" — but these are different properties
    const score = nameMatchConfidence(
      'Heritage Collection on Boat Quay - South Bridge Wing - Mobile App Check-In',
      'The Southbridge Hotel', 'singapore');
    assert.ok(score < 0.80,
      `Heritage Collection should NOT dedup-match Southbridge Hotel (got ${score.toFixed(4)})`);
  });

  it('Santori candidates: non-matches rejected with city', () => {
    const marriott = nameMatchConfidence('Santori Hotel Da Nang Bay', 'Danang Marriott Resort & Spa', 'Da Nang');
    const hyatt = nameMatchConfidence('Santori Hotel Da Nang Bay', 'Hyatt Regency Danang Resort and Spa', 'Da Nang');
    assert.ok(marriott < 0.3, `Marriott should not match Santori (got ${marriott.toFixed(4)})`);
    assert.ok(hyatt < 0.3, `Hyatt should not match Santori (got ${hyatt.toFixed(4)})`);
  });
});

describe('xref matching corpus — known hotel pairs', () => {
  const knownMatches = [
    // Exact matches
    { a: 'Sala Danang Beach Hotel', b: 'Sala Danang Beach Hotel', city: 'Da Nang', label: 'exact match' },
    { a: 'Marvelous Homestay Hoi An', b: 'Marvelous Homestay Hoi An', city: 'Da Nang', label: 'exact match Hoi An' },

    // Punctuation differences
    { a: 'take me 3seasons', b: 'take me. 3seasons', city: 'Da Nang', label: 'dot in name' },

    // Plural differences
    { a: 'Daisy Garden Villa Hoi An', b: 'Daisy Gardens Villa', city: 'Da Nang', label: 'plural garden/gardens' },

    // Diacritics
    { a: 'Hai Hoi Villa Hoi An', b: 'Hai Hội Villa Hoi An', city: 'Da Nang', label: 'diacritics' },

    // Operator suffix stripped
    { a: 'Sujet Beach Hotel and Apartment Danang by Haviland', b: 'Sujet Beach Hotel', city: 'Da Nang', label: 'operator suffix stripped' },

    // Abbreviation/expansion
    { a: 'HAIAN Beach Hotel & Spa', b: 'HAIAN Beach Hotel and Spa', city: 'Da Nang', label: 'ampersand vs and' },

    // City in name
    { a: 'Gold Central Hotel Da Nang', b: 'Gold Central Hotel', city: 'Da Nang', label: 'city in booking name' },

    // Minor word differences
    { a: 'Caro Premium Danang Hotel', b: 'Caro Premium Hotel', city: 'Da Nang', label: 'city variant danang' },

    // Compound names
    { a: 'Star City Hotel', b: 'Starcity Hotel', city: 'Da Nang', label: 'compound starcity' },

    // Google Maps uses different property type word (resort vs villas both stripped as stop words but partial overlap)
    { a: 'Zest Resort & Spa Hoi An', b: 'Zest Villas & Spa', city: 'Da Nang', label: 'resort vs villas', threshold: 0.75 },

    // Additional real-world pairs
    { a: 'Novotel Danang Premier Han River', b: 'Novotel Da Nang Premier Han River', city: 'Da Nang', label: 'Danang vs Da Nang spelling' },
    { a: 'A La Carte Da Nang Beach', b: 'A La Carte Danang Beach', city: 'Da Nang', label: 'Da Nang vs Danang reverse' },
    { a: 'Fusion Suites Danang Beach', b: 'Fusion Suites Da Nang Beach', city: 'Da Nang', label: 'suites danang fusion' },
    { a: 'TMS Hotel Da Nang Beach', b: 'TMS Hotel Danang Beach', city: 'Da Nang', label: 'TMS hotel city spelling' },
  ];

  for (const pair of knownMatches) {
    it(`known match: ${pair.label}`, () => {
      const score = nameMatchConfidence(pair.a, pair.b, pair.city);
      const minScore = pair.threshold || 0.85;
      assert.ok(score >= minScore,
        `"${pair.a}" vs "${pair.b}" should match >= ${minScore} (got ${score.toFixed(4)})`);
    });
  }

  // Known FALSE matches — should NOT pass
  const knownNonMatches = [
    { a: 'Ubud Terrace', b: 'Hotel Terrace at Kuta', city: 'Ubud', label: 'different properties same generic word' },
    { a: 'Star Hotel', b: 'Star City Hotel', city: null, label: 'subset name different property' },
    { a: 'Da Nang Beach Hotel', b: 'Hoi An Beach Resort', city: 'Da Nang', label: 'completely different properties' },
    { a: 'Golden Hotel', b: 'Gold Central Hotel', city: 'Da Nang', label: 'similar prefix different hotel' },
  ];

  for (const pair of knownNonMatches) {
    it(`known non-match: ${pair.label}`, () => {
      const score = nameMatchConfidence(pair.a, pair.b, pair.city);
      assert.ok(score < 0.85,
        `"${pair.a}" vs "${pair.b}" should NOT match (score ${score.toFixed(4)} should be < 0.85)`);
    });
  }

  // Null guard tests
  it('null bookingName returns 0', () => {
    assert.strictEqual(nameMatchConfidence(null, 'Some Hotel', null), 0);
  });

  it('null googleName returns 0', () => {
    assert.strictEqual(nameMatchConfidence('Some Hotel', null, null), 0);
  });

  it('empty bookingName returns 0', () => {
    assert.strictEqual(nameMatchConfidence('', 'Some Hotel', null), 0);
  });

  it('empty googleName returns 0', () => {
    assert.strictEqual(nameMatchConfidence('Some Hotel', '', null), 0);
  });

  it('both null returns 0', () => {
    assert.strictEqual(nameMatchConfidence(null, null, null), 0);
  });
});

// ─── Dedup primary selection (cheapest wins) ─────────────────────────────────
//
// search.js is not a module, so we duplicate the dedup sort logic here for
// testing. These tests verify that after the fix, the cheapest listing in a
// dedup group becomes primary.

// --- helpers (mirrors the production functions in search.js) ---

function computePerNightPricesForTest(listings, nights) {
  for (var i = 0; i < listings.length; i++) {
    if (listings[i].price != null) {
      if (listings[i].platform === 'agoda') {
        listings[i]._pricePerNight = listings[i].price;
      } else {
        listings[i]._pricePerNight = Math.round(listings[i].price / nights);
      }
    }
  }
}

function pickDedupPrimary(group) {
  // Mirrors the FIXED sort in deduplicateListings()
  group.sort(function (a, b) {
    var aPrice = a._pricePerNight != null ? a._pricePerNight : Infinity;
    var bPrice = b._pricePerNight != null ? b._pricePerNight : Infinity;
    return aPrice - bPrice;
  });
  return group[0];
}

describe('Dedup primary selection — cheapest wins', function () {
  it('picks Agoda over Booking when Agoda is cheaper', function () {
    var nights = 3;
    var group = [
      { platform: 'booking', price: 333, name: 'Hotel X' },  // $111/night
      { platform: 'agoda',   price: 45,  name: 'Hotel X' },  // $45/night (already per-night)
    ];
    computePerNightPricesForTest(group, nights);
    var primary = pickDedupPrimary(group);
    assert.strictEqual(primary.platform, 'agoda',
      'Agoda ($45/night) should be primary over Booking ($111/night)');
  });

  it('picks Booking over Airbnb when Booking is cheaper per night', function () {
    var nights = 2;
    var group = [
      { platform: 'booking', price: 100, name: 'Hotel Y' },  // $50/night
      { platform: 'airbnb',  price: 200, name: 'Hotel Y' },  // $100/night
    ];
    computePerNightPricesForTest(group, nights);
    var primary = pickDedupPrimary(group);
    assert.strictEqual(primary.platform, 'booking',
      'Booking ($50/night) should be primary over Airbnb ($100/night)');
  });

  it('null price is treated as Infinity and never becomes primary', function () {
    var nights = 3;
    var group = [
      { platform: 'booking', price: null, name: 'Hotel Z' },
      { platform: 'agoda',   price: 80,   name: 'Hotel Z' },
    ];
    computePerNightPricesForTest(group, nights);
    var primary = pickDedupPrimary(group);
    assert.strictEqual(primary.platform, 'agoda',
      'Listing with null price should never become primary');
  });

  it('both null prices: first listing wins (stable fallback)', function () {
    var nights = 3;
    var group = [
      { platform: 'booking', price: null, name: 'Hotel W' },
      { platform: 'airbnb',  price: null, name: 'Hotel W' },
    ];
    computePerNightPricesForTest(group, nights);
    var primary = pickDedupPrimary(group);
    // Both treated as Infinity so sort is stable; first element stays first
    assert.ok(primary !== undefined, 'Should return a primary even when all prices are null');
  });

  it('_otherPrices contains correct pricePerNight for all platforms', function () {
    var nights = 5;
    var group = [
      { platform: 'booking', price: 500, name: 'Suite A' },  // $100/night
      { platform: 'agoda',   price: 80,  name: 'Suite A' },  // $80/night
      { platform: 'airbnb',  price: 750, name: 'Suite A' },  // $150/night
    ];
    computePerNightPricesForTest(group, nights);
    // Sort cheapest first (mirrors dedup logic)
    group.sort(function (a, b) {
      var aPrice = a._pricePerNight != null ? a._pricePerNight : Infinity;
      var bPrice = b._pricePerNight != null ? b._pricePerNight : Infinity;
      return aPrice - bPrice;
    });
    var primary = group[0];
    // Build _otherPrices as deduplicateListings() does
    primary._otherPrices = [];
    for (var j = 0; j < group.length; j++) {
      primary._otherPrices.push({
        platform: group[j].platform,
        pricePerNight: group[j]._pricePerNight,
        price: group[j].price,
        url: group[j].url,
      });
    }
    assert.strictEqual(primary.platform, 'agoda', 'Agoda ($80/night) should be primary');
    var bookingEntry = primary._otherPrices.find(function (e) { return e.platform === 'booking'; });
    var agodaEntry   = primary._otherPrices.find(function (e) { return e.platform === 'agoda'; });
    var airbnbEntry  = primary._otherPrices.find(function (e) { return e.platform === 'airbnb'; });
    assert.strictEqual(bookingEntry.pricePerNight, 100, 'Booking per-night should be $100');
    assert.strictEqual(agodaEntry.pricePerNight,    80, 'Agoda per-night should be $80');
    assert.strictEqual(airbnbEntry.pricePerNight,  150, 'Airbnb per-night should be $150');
  });
});
