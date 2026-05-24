// Scoring algorithms — pure math, no DOM dependencies
// Trust rating system: review count penalty + anomaly detection

// Config: loaded by manifest before this script in browser;
// in Node.js test environment, require it explicitly.
if (typeof SCORING_CONFIG === 'undefined' && typeof require === 'function') {
  var SCORING_CONFIG = require('./scoring-config.js').SCORING_CONFIG;
}

/**
 * Clamp a value between 0 and 100
 */
function clamp(score) {
  return Math.max(0, Math.min(100, score));
}

/**
 * Detect bimodal review distribution (hollow middle with extreme spikes).
 * Returns a score where > 0.555 indicates bimodal (fake review pattern).
 *
 * Direct detection: only triggers when BOTH 1★ and 5★ individually exceed
 * the average of 2-4★ bins, measuring how dominant extremes are.
 *
 * @param {number[]} bins - [1star, 2star, 3star, 4star, 5star] counts
 * @returns {number} bimodality score (> 0.555 = bimodal)
 */
function bimodalityCoefficient(bins) {
  const total = bins.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  const p = bins.map(b => b / total);

  const middleAvg = (p[1] + p[2] + p[3]) / 3;

  // Both extremes must individually exceed the middle average
  if (p[0] <= middleAvg || p[4] <= middleAvg) return 0;

  // Ratio of extreme mass to total — approaches 1 when middle is hollow
  const extremeSum = p[0] + p[4];
  const ratio = extremeSum / (extremeSum + p[1] + p[2] + p[3]);
  return ratio;
}

/**
 * Review distribution anomaly — measures how far an observed histogram
 * deviates from what genuinely excellent hotels look like.
 *
 * Reference model calibrated from verified luxury chains on Google Maps:
 * Grand Hyatt, Four Seasons, Ritz-Carlton, Mandarin Oriental.
 * Even the world's best hotels have natural complaint rates — a 4.9-rated
 * Grand Hyatt still shows ~10% four-star and ~3% three-star reviews.
 * When those bins are nearly empty, reviews are likely incentivized.
 *
 * Uses Jensen-Shannon divergence (information-theoretic, symmetric, bounded 0-1).
 *
 * @param {number[]} bins - [1star, 2star, 3star, 4star, 5star] counts
 * @returns {{ jsd: number, expected: number[], meanRating: number }}
 *   jsd: 0 = matches benchmark perfectly, >0.15 = notable, >0.3 = highly suspicious
 */
function reviewDistributionAnomaly(bins) {
  var total = bins.reduce(function (a, b) { return a + b; }, 0);
  if (total === 0) return { jsd: 0, expected: [0, 0, 0, 0, 0], meanRating: 0 };

  var observed = bins.map(function (b) { return b / total; });

  // Compute mean rating from histogram
  var meanRating = 0;
  for (var i = 0; i < 5; i++) meanRating += observed[i] * (i + 1);

  // Reference distributions from genuine luxury hotel data on Google Maps.
  // Format: [1★, 2★, 3★, 4★, 5★] as proportions.
  //
  // Sources (representative patterns):
  //   Grand Hyatt Singapore  (~4.5): 4% 3% 10% 23% 60%
  //   Ritz-Carlton Tokyo     (~4.6): 3% 3%  7% 18% 69%
  //   Four Seasons Bali      (~4.7): 3% 2%  5% 15% 75%
  //   Mandarin Oriental BKK  (~4.8): 2% 2%  5% 12% 79%
  //   Aman Tokyo             (~4.9): 2% 2%  3% 10% 83%
  var references = [
    { rating: 3.5, dist: [0.12, 0.10, 0.18, 0.25, 0.35] },
    { rating: 4.0, dist: [0.07, 0.07, 0.15, 0.28, 0.43] },
    { rating: 4.2, dist: [0.05, 0.05, 0.12, 0.25, 0.53] },
    { rating: 4.5, dist: [0.04, 0.03, 0.10, 0.23, 0.60] },
    { rating: 4.6, dist: [0.03, 0.03, 0.07, 0.18, 0.69] },
    { rating: 4.7, dist: [0.03, 0.02, 0.05, 0.15, 0.75] },
    { rating: 4.8, dist: [0.02, 0.02, 0.05, 0.12, 0.79] },
    { rating: 4.9, dist: [0.02, 0.02, 0.03, 0.10, 0.83] },
  ];

  // Interpolate expected distribution for the observed mean rating
  var expected;
  if (meanRating <= references[0].rating) {
    expected = references[0].dist.slice();
  } else if (meanRating >= references[references.length - 1].rating) {
    expected = references[references.length - 1].dist.slice();
  } else {
    for (var r = 0; r < references.length - 1; r++) {
      if (meanRating >= references[r].rating && meanRating <= references[r + 1].rating) {
        var t = (meanRating - references[r].rating) / (references[r + 1].rating - references[r].rating);
        expected = references[r].dist.map(function (v, idx) {
          return v + t * (references[r + 1].dist[idx] - v);
        });
        break;
      }
    }
  }

  // Jensen-Shannon divergence (log base 2, bounded 0-1)
  var m = observed.map(function (p, idx) { return 0.5 * p + 0.5 * expected[idx]; });

  function klDiv(p, q) {
    var sum = 0;
    for (var i = 0; i < p.length; i++) {
      if (p[i] > 0 && q[i] > 0) {
        sum += p[i] * Math.log(p[i] / q[i]) / Math.LN2;
      }
    }
    return sum;
  }

  var jsd = 0.5 * klDiv(observed, m) + 0.5 * klDiv(expected, m);

  return { jsd: jsd, expected: expected, meanRating: meanRating };
}

/**
 * Wedge deviation — measures how well the distribution matches the
 * "natural" pattern: 5★ > 4★ > 3★ > 2★ > 1★
 * Returns 0 for perfect wedge, 1 for maximally broken
 *
 * @param {number[]} bins - [1star, 2star, 3star, 4star, 5star] counts
 * @returns {number} deviation score 0-1
 */
function wedgeDeviation(bins) {
  const total = bins.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;

  const p = bins.map(b => b / total);

  // Sum inversion magnitudes (where a lower star has more reviews than a higher star)
  let inversionMagnitude = 0;
  for (let i = 0; i < 4; i++) {
    if (p[i] > p[i + 1]) {
      inversionMagnitude += p[i] - p[i + 1];
    }
  }

  // Penalize hollow middle (both 1★ and 5★ exceed middle bins)
  const middleAvg = (p[1] + p[2] + p[3]) / 3;
  const hollowness = (Math.min(p[0], p[4]) > middleAvg && middleAvg < SCORING_CONFIG.ANOMALY.WEDGE_HOLLOW_MIDDLE_MAX)
    ? (p[0] + p[4] - 2 * middleAvg) : 0;

  return Math.min(1, inversionMagnitude + hollowness);
}

/**
 * Four-star deficit — detects "too perfect" distributions where the 4★ bin
 * is far below what genuine hotels produce at the same mean rating.
 *
 * Even the world's best hotels (Aman Tokyo, $1500/night, 4.9 rating) show
 * a 4★ ratio of ~0.67. Genuine satisfied guests naturally vary between 4★
 * and 5★. When the 4★ bin is less than half the expected value, reviews
 * are likely manufactured — the histogram preserves the natural wedge shape
 * but is impossibly concentrated at 5★.
 *
 * @param {number[]} bins - [1star, 2star, 3star, 4star, 5star] counts
 * @returns {number} ratio of observed 4★% to expected 4★% (< 0.5 = suspicious)
 */
function fourStarDeficit(bins) {
  var total = bins.reduce(function (a, b) { return a + b; }, 0);
  if (total === 0) return 1;

  var anomalyData = reviewDistributionAnomaly(bins);
  var observed4 = bins[3] / total;
  var expected4 = anomalyData.expected[3];

  if (expected4 <= 0) return 1;
  return observed4 / expected4;
}

/**
 * Value scores — percentile rank of prices (cheapest = 100, most expensive = 0)
 * @param {number[]} prices - Array of prices (nulls should be filtered out before calling)
 * @returns {number[]} Same length array of scores 0-100
 */
function valueScores(prices) {
  if (prices.length === 0) return [];
  if (prices.length === 1) return [50];
  const allSame = prices.every(function (p) { return p === prices[0]; });
  if (allSame) return prices.map(function () { return 50; });

  const n = prices.length;
  return prices.map(function (price) {
    var belowCount = 0;
    for (var i = 0; i < n; i++) {
      if (prices[i] < price) belowCount++;
    }
    return Math.round((1 - belowCount / (n - 1)) * 100);
  });
}

/**
 * Piecewise Booking-to-Google scale mapping.
 * Booking.com uses an effective 2.5-10 scale (Mellinas et al., 2015), not 0-10.
 * Google Maps uses 1-5. This function maps between the two using empirical anchors.
 *
 * @param {number} bookingRating - Booking.com rating (typically 2.5-10)
 * @returns {number} Equivalent Google Maps rating (1.0-4.9)
 */
function bookingToGoogleScale(bookingRating) {
  var segments = [
    { bMin: 2.5, bMax: 5.0, gMin: 1.0, gMax: 2.5 },
    { bMin: 5.0, bMax: 7.0, gMin: 2.5, gMax: 3.5 },
    { bMin: 7.0, bMax: 8.0, gMin: 3.5, gMax: 4.0 },
    { bMin: 8.0, bMax: 8.5, gMin: 4.0, gMax: 4.2 },
    { bMin: 8.5, bMax: 9.0, gMin: 4.2, gMax: 4.4 },
    { bMin: 9.0, bMax: 9.5, gMin: 4.4, gMax: 4.6 },
    { bMin: 9.5, bMax: 10.0, gMin: 4.6, gMax: 4.9 },
  ];

  if (bookingRating <= 2.5) return 1.0;
  if (bookingRating >= 10.0) return 4.9;

  for (var i = 0; i < segments.length; i++) {
    var s = segments[i];
    if (bookingRating >= s.bMin && bookingRating <= s.bMax) {
      var t = (bookingRating - s.bMin) / (s.bMax - s.bMin);
      return s.gMin + t * (s.gMax - s.gMin);
    }
  }
  return bookingRating / 2; // Fallback (should not reach here)
}

/**
 * Piecewise Airbnb-to-normalized (0-10) scale mapping.
 * Airbnb ratings are severely inflated — 95% of listings score 4.5-5.0
 * (Zervas et al., 2021). A simple ×2 mapping makes Airbnb 4.7 appear
 * equivalent to Booking 9.4, when research shows it's closer to 8.0-8.5.
 *
 * Anchors calibrated from cross-platform review studies:
 *   Airbnb 5.0 → 10.0 (perfect on both platforms)
 *   Airbnb 4.9 →  9.5 (exceptional)
 *   Airbnb 4.8 →  9.0 (excellent, ≈ Booking 9.0)
 *   Airbnb 4.7 →  8.5 (very good, ≈ Booking 8.5)
 *   Airbnb 4.5 →  8.0 (good+, ≈ Booking 8.0)
 *   Airbnb 4.2 →  7.0 (good)
 *   Airbnb 4.0 →  6.0 (okay)
 *   Airbnb 3.5 →  5.0 (mediocre)
 *   Airbnb 3.0 →  4.0 (poor)
 *   Airbnb 1.0 →  2.5 (floor — Booking minimum)
 *
 * @param {number} airbnbRating - Airbnb rating (1.0-5.0)
 * @returns {number} Normalized rating on 0-10 scale
 */
function airbnbToNormalizedRating(airbnbRating) {
  var segments = [
    { aMin: 1.0, aMax: 3.0, nMin: 2.5, nMax: 4.0 },
    { aMin: 3.0, aMax: 3.5, nMin: 4.0, nMax: 5.0 },
    { aMin: 3.5, aMax: 4.0, nMin: 5.0, nMax: 6.0 },
    { aMin: 4.0, aMax: 4.2, nMin: 6.0, nMax: 7.0 },
    { aMin: 4.2, aMax: 4.5, nMin: 7.0, nMax: 8.0 },
    { aMin: 4.5, aMax: 4.7, nMin: 8.0, nMax: 8.5 },
    { aMin: 4.7, aMax: 4.8, nMin: 8.5, nMax: 9.0 },
    { aMin: 4.8, aMax: 4.9, nMin: 9.0, nMax: 9.5 },
    { aMin: 4.9, aMax: 5.0, nMin: 9.5, nMax: 9.8 },
  ];

  if (airbnbRating <= 1.0) return 2.5;
  if (airbnbRating >= 5.0) return 9.8;

  for (var i = 0; i < segments.length; i++) {
    var s = segments[i];
    if (airbnbRating >= s.aMin && airbnbRating <= s.aMax) {
      var t = (airbnbRating - s.aMin) / (s.aMax - s.aMin);
      return s.nMin + t * (s.nMax - s.nMin);
    }
  }
  return airbnbRating * 2; // Fallback (should not reach here)
}

/**
 * agodaToNormalizedRating — deflate Agoda rating to Booking-equivalent scale.
 *
 * Agoda ratings are systematically inflated vs Booking (t=10.61, p<0.001, n=126).
 * Inflation is graduated: +0.74 at <7.0, +0.49 at 7.x, +0.26 at 8.x, +0.16 at 9.x.
 * Calibrated from 126 paired observations across 11 cities (2026-03-28).
 * Piecewise linear mapping using breakpoints from scoring-config.js.
 *
 * Breakpoints:
 *   Agoda 0   → 0    (identity at zero)
 *   Agoda 2.0 → 1.0  (Agoda effective floor → Booking effective floor)
 *   Agoda 5.0 → 4.3  (mid-range −0.7 deflation)
 *   Agoda 7.0 → 6.5  (search result range, −0.5 empirical)
 *   Agoda 8.0 → 7.75 (typical search result, −0.25 empirical)
 *   Agoda 9.0 → 8.85 (excellent, −0.15 empirical)
 *   Agoda 10  → 9.9  (ceiling, −0.1 minimal correction)
 *
 * @param {number} agodaRating - Agoda rating (0-10)
 * @returns {number} Normalized rating on Booking-equivalent 0-10 scale
 */
function agodaToNormalizedRating(agodaRating) {
  var bp = SCORING_CONFIG.AGODA_NORMALIZATION.BREAKPOINTS;
  var floor = bp[0];
  var ceiling = bp[bp.length - 1];

  if (agodaRating <= floor.agoda) return floor.booking;
  if (agodaRating >= ceiling.agoda) return ceiling.booking;

  for (var i = 0; i < bp.length - 1; i++) {
    var lo = bp[i];
    var hi = bp[i + 1];
    if (agodaRating >= lo.agoda && agodaRating <= hi.agoda) {
      var t = (agodaRating - lo.agoda) / (hi.agoda - lo.agoda);
      var result = lo.booking + t * (hi.booking - lo.booking);
      return Math.round(result * 100) / 100;
    }
  }
  return agodaRating; // Fallback (should not reach here)
}

/**
 * Compute anomaly penalty from JSD and review count.
 * Returns target-based G score penalty and trust bleed penalty.
 *
 * @param {number} jsd - Jensen-Shannon divergence value
 * @param {number} reviewCount - Number of Google reviews
 * @returns {{ gPenalty: number, tPenalty: number, severity: string }}
 */
function computeAnomalyPenalty(jsd, reviewCount) {
  // Floor: reviewCount < MIN_REVIEW_COUNT returns no penalty (JSD unreliable)
  if (reviewCount < SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT) return { gPenalty: 0, tPenalty: 0, severity: 'none', discountFactor: 1 };

  // Confidence factor: 0 at MIN_REVIEW_COUNT, 1 at MIN_REVIEW_COUNT + CONFIDENCE_RAMP_RANGE
  var confidenceFactor = Math.min(1, (reviewCount - SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT) / SCORING_CONFIG.ANOMALY.CONFIDENCE_RAMP_RANGE);

  if (jsd <= SCORING_CONFIG.ANOMALY.JSD_NONE_MAX) return { gPenalty: 0, tPenalty: 0, severity: 'none', discountFactor: 1 };

  var severity, gTarget, tPenalty, discountFactor;

  if (jsd <= SCORING_CONFIG.ANOMALY.JSD_MILD_MAX) {
    severity = 'mild';
    // G target: MILD_G_MAX at JSD_NONE_MAX, MILD_G_MIN at JSD_MILD_MAX (linear interpolation)
    gTarget = SCORING_CONFIG.ANOMALY.MILD_G_MAX - (jsd - SCORING_CONFIG.ANOMALY.JSD_NONE_MAX) * ((SCORING_CONFIG.ANOMALY.MILD_G_MAX - SCORING_CONFIG.ANOMALY.MILD_G_MIN) / (SCORING_CONFIG.ANOMALY.JSD_MILD_MAX - SCORING_CONFIG.ANOMALY.JSD_NONE_MAX));
    tPenalty = SCORING_CONFIG.ANOMALY.MILD_T_PENALTY;
    discountFactor = SCORING_CONFIG.ANOMALY.MILD_DISCOUNT;
  } else if (jsd <= SCORING_CONFIG.ANOMALY.JSD_MODERATE_MAX) {
    severity = 'moderate';
    // G target: MODERATE_G_MAX at JSD_MILD_MAX, MODERATE_G_MIN at JSD_MODERATE_MAX
    gTarget = SCORING_CONFIG.ANOMALY.MODERATE_G_MAX - (jsd - SCORING_CONFIG.ANOMALY.JSD_MILD_MAX) * ((SCORING_CONFIG.ANOMALY.MODERATE_G_MAX - SCORING_CONFIG.ANOMALY.MODERATE_G_MIN) / (SCORING_CONFIG.ANOMALY.JSD_MODERATE_MAX - SCORING_CONFIG.ANOMALY.JSD_MILD_MAX));
    tPenalty = SCORING_CONFIG.ANOMALY.MODERATE_T_PENALTY;
    discountFactor = SCORING_CONFIG.ANOMALY.MODERATE_DISCOUNT;
  } else {
    severity = 'severe';
    // G target: SEVERE_G_MAX at JSD_MODERATE_MAX, SEVERE_G_FLOOR at 0.10+
    gTarget = Math.max(SCORING_CONFIG.ANOMALY.SEVERE_G_FLOOR, SCORING_CONFIG.ANOMALY.SEVERE_G_MAX - (jsd - SCORING_CONFIG.ANOMALY.JSD_MODERATE_MAX) * ((SCORING_CONFIG.ANOMALY.SEVERE_G_MAX - SCORING_CONFIG.ANOMALY.SEVERE_G_FLOOR) / 0.05));
    tPenalty = SCORING_CONFIG.ANOMALY.SEVERE_T_PENALTY;
    discountFactor = SCORING_CONFIG.ANOMALY.SEVERE_DISCOUNT;
  }

  // Apply confidence attenuation (attenuate distance from neutral 50)
  gTarget = 50 + (gTarget - 50) * confidenceFactor;
  tPenalty = Math.round(tPenalty * confidenceFactor);
  // Attenuate discount toward 1 (no discount) for low review counts
  discountFactor = 1 - (1 - discountFactor) * confidenceFactor;

  return { gPenalty: Math.round(50 - gTarget), tPenalty: tPenalty, severity: severity, discountFactor: discountFactor };
}

/**
 * Check for star-pair inversions in histogram.
 * A lower star rating having more reviews than a higher star is unnatural.
 * Returns the maximum inversion magnitude in percentage points.
 *
 * @param {number[]} histogram - [1star, 2star, 3star, 4star, 5star] counts
 * @returns {number} Maximum inversion magnitude (0 if none exceed 5pp threshold)
 */
function checkStarPairInversions(histogram) {
  var total = histogram.reduce(function (a, b) { return a + b; }, 0);
  if (total === 0) return 0;

  var p = histogram.map(function (b) { return b / total; });

  var maxInversion = 0;
  var threshold = SCORING_CONFIG.ANOMALY.INVERSION_THRESHOLD;
  // Check each adjacent pair: does lower star exceed higher star by > 5pp?
  for (var i = 0; i < 4; i++) {
    if (p[i] > p[i + 1] + threshold) {
      // 1★>2★ (i=0): only suspicious if 1★ also exceeds 3★ AND 4★ by threshold.
      // Dissatisfied guests naturally skip 2★ for 1★; a mild 1★ bump is normal.
      // Only flag when the 1★ spike towers over the entire middle of the distribution.
      if (i === 0 && !(p[0] > p[2] + threshold && p[0] > p[3] + threshold)) continue;
      var magnitude = p[i] - p[i + 1];
      if (magnitude > maxInversion) maxInversion = magnitude;
    }
  }

  return maxInversion;
}

// ─── Name Matching ───────────────────────────────────────────────────
// nameMatchConfidence + Soft TF-IDF helpers live in ./name-matching.js
// (public module). In the browser, importScripts('../shared/name-matching.js')
// loads them into the global scope. In Node.js test context, we require them
// and expose them locally so this file's module.exports block below can
// re-export them for back-compat with existing tests that import from
// '../src/shared/scoring.js'.
if (typeof module !== 'undefined' && module.exports) {
  var __nm = require('./name-matching.js');
  var nameMatchConfidence = __nm.nameMatchConfidence;
  var stripDiacritics = __nm.stripDiacritics;
  var jaroWinkler = __nm.jaroWinkler;
  var softTfIdfScore = __nm.softTfIdfScore;
  var compoundVariants = __nm.compoundVariants;
  var bigramDiceOnStripped = __nm.bigramDiceOnStripped;
}

// ─── Rating Blending ──────────────────────────────────────────────────

/**
 * Blend Google Maps rating into platform rating using credibility-weighted
 * inverse-variance averaging. Returns platform rating unchanged when Google
 * data is missing, has an anomalous histogram (when present), or has
 * too few reviews. Histogram-null listings (search-fallback) still blend.
 *
 * @param {number} platformRating - Original platform rating (0-10 for booking/agoda, 0-5 for airbnb)
 * @param {string} platform - 'booking' | 'agoda' | 'airbnb'
 * @param {object|null} crossRef - { rating, reviewCount, histogram } from Google Maps
 * @returns {{ blended: number, changed: boolean, reason: string }}
 */
function blendRating(platformRating, platform, crossRef) {
  // Guard 1: No Google data
  if (!crossRef) return { blended: platformRating, changed: false, reason: 'No Google data' };

  // Guard 2: Too few effective Google reviews (after credibility multiplier)
  var credMult = SCORING_CONFIG.BLENDING.CREDIBILITY_MULTIPLIER;
  var effectiveGoogleReviews = crossRef.reviewCount * credMult;
  if (effectiveGoogleReviews < SCORING_CONFIG.BLENDING.MIN_EFFECTIVE_REVIEWS) {
    return { blended: platformRating, changed: false, reason: 'Too few Google reviews' };
  }

  // Normalize both to 0-10 scale
  var normPlatform = platformRating;
  if (platform === 'airbnb') normPlatform = airbnbToNormalizedRating(platformRating);
  else if (platform === 'agoda') normPlatform = agodaToNormalizedRating(platformRating);
  var normGoogle = crossRef.rating * 2; // Google 1-5 to 2-10

  // Inverse-variance weighted average
  // Platform weight = 1.0 (fixed baseline)
  // Google weight = credMult * sqrt(reviewCount) / sqrt(reviewCount + k)
  // k is a damping constant giving diminishing returns for review count
  var k = 100;
  var googleWeight = credMult * Math.sqrt(crossRef.reviewCount) / Math.sqrt(crossRef.reviewCount + k);
  var platformWeight = 1.0;
  var blended = (normPlatform * platformWeight + normGoogle * googleWeight) / (platformWeight + googleWeight);

  // Asymmetric clamp: Google Maps can only REDUCE a platform rating, never inflate it.
  // Rationale: Booking/Agoda/Airbnb ratings come from verified stays (trustworthy floor).
  // Google Maps reviews are unverified — downward pull is informative (surfaces anomalies),
  // upward push would misrepresent stay-verified quality.
  var clamped = false;
  if (blended > normPlatform) {
    blended = normPlatform;
    clamped = true;
  }

  // Round to 1 decimal place
  blended = Math.round(blended * 10) / 10;

  var reason = clamped
    ? 'Google higher than platform — clamped to platform (asymmetric)'
    : 'Blended with Google data';
  return { blended: blended, changed: true, reason: reason };
}

// ─── Review Confidence ────────────────────────────────────────────────

/**
 * Linear confidence ramp: reviewCount / cap, capped at 1.0.
 * No sigmoid, no steps — pure linear scaling per platform.
 *
 * @param {number} reviewCount - Number of reviews
 * @param {string} platform - 'airbnb' | 'booking' | 'agoda'
 * @returns {number} Confidence value 0-1
 */
function reviewConfidence(reviewCount, platform) {
  var cap;
  if (platform === 'airbnb') {
    cap = SCORING_CONFIG.CONFIDENCE.AIRBNB_CAP;
  } else {
    cap = SCORING_CONFIG.CONFIDENCE.BOOKING_CAP; // booking and agoda use same cap
  }
  return Math.min(1, reviewCount / cap);
}

// ─── Compute Trust (new — no review-count penalties) ─────────────────

/**
 * Compute trust for a listing. Measures "is this rating real?" — NOT the rating itself.
 * No review-count penalties (hard cutoffs removed). Trust is based on:
 *   1. Normalized platform rating (base)
 *   2. Badge bonuses (Guest Favorite +1, Superhost +0.5)
 *   3. Anomaly detection from cross-reference histogram
 *   4. Cross-validated rating blend when no anomaly detected
 *
 * @param {object} listing - { name, platform, rating, reviewCount, badges?, _googleData? }
 * @param {object|null} crossRef - { rating, reviewCount, histogram } from Google Maps
 * @returns {{ trust: number, anomaly: boolean, anomalySignals: string[], breakdown: object }}
 */
function computeTrust(listing, crossRef) {
  var platform = listing.platform;
  var platformRating = listing.rating;
  var reviewCount = listing.reviewCount || 0;
  var badges = listing.badges || null;

  // Base: platform rating normalized to 0-10
  var trust;
  if (platformRating != null && platform) {
    if (platform === 'booking') {
      trust = platformRating; // already 0-10
    } else if (platform === 'agoda') {
      trust = agodaToNormalizedRating(platformRating);
    } else if (platform === 'airbnb') {
      trust = airbnbToNormalizedRating(platformRating);
    } else {
      // google-maps: rating is on 1-5 scale
      trust = platformRating * 2;
    }
  } else {
    trust = 10; // fallback when no platform info
  }

  var anomaly = false;
  var anomalyJsd = 0;
  var anomalySignals = [];
  var ratingGap = 0;
  var googleVerified = false;

  // Badge bonuses (Airbnb)
  var badgeBonus = 0;
  if (badges) {
    if (badges.isGuestFavorite) badgeBonus += SCORING_CONFIG.AIRBNB.GUEST_FAVORITE_BONUS;
    if (badges.isSuperhost) badgeBonus += SCORING_CONFIG.AIRBNB.SUPERHOST_BONUS;
  }
  trust += badgeBonus;

  // NO review-count penalties — that's the whole point

  // Save baseline trust (before any cross-ref modifications)
  var baselineTrust = trust;

  // Anomaly detection from cross-reference histogram
  if (crossRef && crossRef.histogram && crossRef.histogram.length === 5 && crossRef.reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT) {
    var anomalyData = reviewDistributionAnomaly(crossRef.histogram);
    anomalyJsd = anomalyData.jsd;

    var highRated = crossRef.rating >= SCORING_CONFIG.ANOMALY.HISTOGRAM_MIN_RATING;

    if (highRated && anomalyData.jsd > SCORING_CONFIG.ANOMALY.JSD_SIGNAL_THRESHOLD) {
      anomalySignals.push('Review pattern anomaly');
    }

    if (highRated) {
      var wd = wedgeDeviation(crossRef.histogram);
      if (wd > SCORING_CONFIG.ANOMALY.WEDGE_THRESHOLD) {
        anomalySignals.push('Unnatural star distribution');
      }

      var bc = bimodalityCoefficient(crossRef.histogram);
      if (bc > SCORING_CONFIG.ANOMALY.BIMODALITY_THRESHOLD) {
        anomalySignals.push('Bimodal reviews');
      }

      var inv = checkStarPairInversions(crossRef.histogram);
      if (inv > SCORING_CONFIG.ANOMALY.INVERSION_THRESHOLD) {
        anomalySignals.push('Star inversions');
      }
    }

    if (crossRef.reviewCount >= SCORING_CONFIG.ANOMALY.FOUR_STAR_DEFICIT_MIN_REVIEWS) {
      var histTotal = crossRef.histogram.reduce(function (a, b) { return a + b; }, 0);
      var oneStarPct = histTotal > 0 ? crossRef.histogram[0] / histTotal : 0;
      var fsd = fourStarDeficit(crossRef.histogram);
      var fsdThreshold = histTotal >= SCORING_CONFIG.ANOMALY.FOUR_STAR_DEFICIT_HIGH_VOL_MIN_REVIEWS
        ? SCORING_CONFIG.ANOMALY.FOUR_STAR_DEFICIT_HIGH_VOL_THRESHOLD
        : SCORING_CONFIG.ANOMALY.FOUR_STAR_DEFICIT_THRESHOLD;
      if (fsd < fsdThreshold
          && oneStarPct < SCORING_CONFIG.ANOMALY.ONE_STAR_AUTHENTICITY_FLOOR) {
        anomalySignals.push('Unnaturally concentrated (4\u2605 deficit)');
      }
    }

    if (anomalySignals.length > 0) {
      anomaly = true;
    }
  }

  // Rating-gap signal
  if (crossRef && crossRef.rating && crossRef.reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT
      && reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT) {
    var googleNormalized = crossRef.rating * 2;
    var platformNormalized = (platform === 'booking') ? platformRating : (platform === 'agoda') ? agodaToNormalizedRating(platformRating) : (platformRating * 2);
    var computedGap = platformNormalized - googleNormalized;

    if (computedGap >= SCORING_CONFIG.ANOMALY.RATING_GAP_THRESHOLD) {
      ratingGap = computedGap;
      anomalySignals.push('Rating gap (' + platformNormalized.toFixed(1) + ' vs Google ' + googleNormalized.toFixed(1) + ')');
      anomaly = true;
    }
  }

  // Cross-ref trust adjustment: anomaly keeps baseline, clean gets blend + boost
  if (anomaly) {
    // Anomalous: keep baseline trust (no boost, no penalty relative to no-crossRef)
    trust = baselineTrust;
  } else if (crossRef && crossRef.rating
      && crossRef.reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT
      && reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT) {
    // Clean cross-ref: blend ratings
    var gNorm = crossRef.rating * 2;
    var pWeight = Math.sqrt(reviewCount);
    var gWeight = Math.sqrt(crossRef.reviewCount);
    var blended = (trust * pWeight + gNorm * gWeight) / (pWeight + gWeight);
    trust = Math.round(blended * 10) / 10;

    // Google Maps clean-match trust boost (Booking/Agoda only, not Airbnb)
    if ((platform === 'booking' || platform === 'agoda')
        && crossRef.reviewCount >= SCORING_CONFIG.TRUST.GOOGLE_CLEAN_MIN_REVIEWS) {
      trust += SCORING_CONFIG.TRUST.GOOGLE_CLEAN_BOOST;
      trust = Math.round(trust * 10) / 10;
      googleVerified = true;
    }
  }

  // Clamp
  trust = Math.max(0, Math.min(10, Math.round(trust * 10) / 10));

  return {
    trust: trust,
    anomaly: anomaly,
    anomalySignals: anomalySignals,
    breakdown: {
      reviewCount: reviewCount,
      anomaly: anomaly,
      anomalyJsd: anomalyJsd,
      anomalySignals: anomalySignals,
      hasXref: !!crossRef,
      hasHistogram: !!(crossRef && crossRef.histogram && crossRef.histogram.length === 5),
      xrefRating: crossRef ? crossRef.rating : null,
      badgeBonus: badgeBonus,
      ratingGap: ratingGap,
      googleVerified: googleVerified
    }
  };
}

// ─── Trust Rating System (legacy — kept for backward compat) ─────────

/**
 * Compute trust rating for a listing.
 * Base = platform rating normalized to 0-10 scale:
 *   Booking.com: rating used directly (already 0-10)
 *   Airbnb: piecewise mapping via airbnbToNormalizedRating (corrects inflation)
 *   Google Maps: rating × 2 (1-5 → 2-10)
 *
 * Modifiers:
 * 1. Badge bonuses: Guest Favorite +1, Superhost +0.5
 * 2. Review count penalty (platform-specific thresholds)
 * 3. Anomaly detection from cross-reference: reduces score to 1/3
 *
 * @param {number} reviewCount - Number of platform reviews
 * @param {object|null} crossRef - { rating, reviewCount, histogram } from Google Maps
 * @param {object|null} badges - { isGuestFavorite, isSuperhost } from Airbnb
 * @param {number} [platformRating] - Original platform rating (e.g. 9.1 for Booking, 4.5 for Airbnb)
 * @param {string} [platform] - 'booking' | 'airbnb' | 'google-maps'
 * @returns {{ trust: number, anomaly: boolean, reviewPenalty: string, breakdown: object }}
 */
function trustRating(reviewCount, crossRef, badges, platformRating, platform) {
  // Base: platform rating normalized to 0-10
  var trust;
  if (platformRating != null && platform) {
    if (platform === 'booking') {
      trust = platformRating; // already 0-10
    } else if (platform === 'agoda') {
      trust = agodaToNormalizedRating(platformRating);
    } else if (platform === 'airbnb') {
      trust = airbnbToNormalizedRating(platformRating);
    } else {
      // google-maps: rating is on 1-5 scale
      trust = platformRating * 2;
    }
  } else {
    trust = 10; // fallback when no platform info
  }

  var anomaly = false;
  var reviewPenalty = 'none';
  var anomalyJsd = 0;
  var anomalySignals = [];
  var ratingGap = 0;

  // Airbnb badge bonuses
  var badgeBonus = 0;
  if (badges) {
    if (badges.isGuestFavorite) badgeBonus += SCORING_CONFIG.AIRBNB.GUEST_FAVORITE_BONUS;
    if (badges.isSuperhost) badgeBonus += SCORING_CONFIG.AIRBNB.SUPERHOST_BONUS;
  }
  trust += badgeBonus;

  // Review count penalties REMOVED — replaced by reviewConfidence() linear ramp
  // and Bayesian shrinkage in the ranking pipeline. See computeTrust().
  // reviewPenalty kept as 'none' for backward compatibility.

  // Anomaly detection from cross-reference histogram
  if (crossRef && crossRef.histogram && crossRef.histogram.length === 5 && crossRef.reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT) {
    var anomalyData = reviewDistributionAnomaly(crossRef.histogram);
    anomalyJsd = anomalyData.jsd;

    // Histogram shape signals only apply to high-rated hotels (>= 4.5★).
    // Below 4.5★, J-shaped distributions are natural for budget hotels and
    // the reference model (calibrated from luxury chains) doesn't apply.
    var highRated = crossRef.rating >= SCORING_CONFIG.ANOMALY.HISTOGRAM_MIN_RATING;

    if (highRated && anomalyData.jsd > SCORING_CONFIG.ANOMALY.JSD_SIGNAL_THRESHOLD) {
      anomalySignals.push('Review pattern anomaly');
    }

    if (highRated) {
      var wd = wedgeDeviation(crossRef.histogram);
      if (wd > SCORING_CONFIG.ANOMALY.WEDGE_THRESHOLD) {
        anomalySignals.push('Unnatural star distribution');
      }

      var bc = bimodalityCoefficient(crossRef.histogram);
      if (bc > SCORING_CONFIG.ANOMALY.BIMODALITY_THRESHOLD) {
        anomalySignals.push('Bimodal reviews');
      }

      var inv = checkStarPairInversions(crossRef.histogram);
      if (inv > SCORING_CONFIG.ANOMALY.INVERSION_THRESHOLD) {
        anomalySignals.push('Star inversions');
      }
    }

    if (crossRef.reviewCount >= SCORING_CONFIG.ANOMALY.FOUR_STAR_DEFICIT_MIN_REVIEWS) {
      var histTotal = crossRef.histogram.reduce(function (a, b) { return a + b; }, 0);
      var oneStarPct = histTotal > 0 ? crossRef.histogram[0] / histTotal : 0;
      var fsd = fourStarDeficit(crossRef.histogram);
      var fsdThreshold = histTotal >= SCORING_CONFIG.ANOMALY.FOUR_STAR_DEFICIT_HIGH_VOL_MIN_REVIEWS
        ? SCORING_CONFIG.ANOMALY.FOUR_STAR_DEFICIT_HIGH_VOL_THRESHOLD
        : SCORING_CONFIG.ANOMALY.FOUR_STAR_DEFICIT_THRESHOLD;
      if (fsd < fsdThreshold
          && oneStarPct < SCORING_CONFIG.ANOMALY.ONE_STAR_AUTHENTICITY_FLOOR) {
        anomalySignals.push('Unnaturally concentrated (4\u2605 deficit)');
      }
    }

    if (anomalySignals.length > 0) {
      anomaly = true;
      trust = Math.round((trust / SCORING_CONFIG.ANOMALY.TRUST_DIVISOR) * 10) / 10;
    }
  }

  // Rating-gap signal: platform rating significantly exceeds Google Maps rating
  // Only fires when platform > Google (inflated rating concern) and both have 50+ reviews
  if (crossRef && crossRef.rating && crossRef.reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT
      && reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT) {
    var googleNormalized = crossRef.rating * 2; // Google 1-5 → 0-10
    var platformNormalized = (platform === 'booking') ? platformRating : (platform === 'agoda') ? agodaToNormalizedRating(platformRating) : (platformRating * 2);
    var computedGap = platformNormalized - googleNormalized;

    if (computedGap >= SCORING_CONFIG.ANOMALY.RATING_GAP_THRESHOLD) {
      ratingGap = computedGap;
      anomalySignals.push('Rating gap (' + platformNormalized.toFixed(1) + ' vs Google ' + googleNormalized.toFixed(1) + ')');

      if (!anomaly) {
        // First anomaly: apply rating-gap discount (lighter than trust/3)
        trust *= SCORING_CONFIG.ANOMALY.RATING_GAP_DISCOUNT;
        trust = Math.round(trust * 10) / 10;
      }
      // If histogram anomaly already fired, just add signal — no double penalty
      anomaly = true;
    }
  }

  // Cross-validated rating blend: when Google Maps rating is available and
  // no anomaly was detected, blend platform and Google ratings weighted by
  // review count. This uses the same Bayesian principle as the IMDb formula:
  // more reviews = more weight. Google ratings are less inflated than platform
  // ratings (Mellinas et al., 2015), making them a valuable second opinion.
  if (crossRef && crossRef.rating && !anomaly
      && crossRef.reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT
      && reviewCount >= SCORING_CONFIG.ANOMALY.MIN_REVIEW_COUNT) {
    var gNorm = crossRef.rating * 2; // Google 1-5 → 0-10
    // Weight by sqrt of review count (diminishing returns on large counts)
    var pWeight = Math.sqrt(reviewCount);
    var gWeight = Math.sqrt(crossRef.reviewCount);
    var blended = (trust * pWeight + gNorm * gWeight) / (pWeight + gWeight);
    trust = Math.round(blended * 10) / 10;
  }

  // Clamp
  trust = Math.max(0, Math.min(10, Math.round(trust * 10) / 10));

  return {
    trust: trust,
    anomaly: anomaly,
    reviewPenalty: reviewPenalty,
    breakdown: {
      reviewCount: reviewCount,
      reviewPenalty: reviewPenalty,
      anomaly: anomaly,
      anomalyJsd: anomalyJsd,
      anomalySignals: anomalySignals,
      hasXref: !!crossRef,
      hasHistogram: !!(crossRef && crossRef.histogram && crossRef.histogram.length === 5),
      xrefRating: crossRef ? crossRef.rating : null,
      badgeBonus: badgeBonus,
      ratingGap: ratingGap
    }
  };
}

/**
 * Trust level classification for trust score.
 *
 * @param {number} trust - Trust score on 0-10 scale
 * @returns {{ level: string, cssClass: string }}
 */
function trustLevel(trust) {
  if (trust >= SCORING_CONFIG.TRUST_LEVEL.HIGH_THRESHOLD) return { level: 'high', cssClass: 'rt-trust-high' };
  if (trust >= SCORING_CONFIG.TRUST_LEVEL.MEDIUM_THRESHOLD) return { level: 'medium', cssClass: 'rt-trust-medium' };
  return { level: 'low', cssClass: 'rt-trust-low' };
}

/**
 * Platform badge label for display.
 *
 * @param {string} platform - Platform identifier
 * @returns {string} Short label for badge display
 */
function platformLabel(platform) {
  if (platform === 'booking') return 'B';
  if (platform === 'agoda') return 'Ag';
  if (platform === 'airbnb') return 'A';
  return '?';
}

// Export for both content scripts and Node.js tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    trustRating, trustLevel, valueScores,
    clamp, bimodalityCoefficient, wedgeDeviation, reviewDistributionAnomaly,
    bookingToGoogleScale, airbnbToNormalizedRating, agodaToNormalizedRating, computeAnomalyPenalty, checkStarPairInversions,
    fourStarDeficit, blendRating, reviewConfidence, computeTrust,
    nameMatchConfidence, stripDiacritics, compoundVariants, bigramDiceOnStripped,
    jaroWinkler, platformLabel
  };
}
