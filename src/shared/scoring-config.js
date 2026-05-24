// Single source of truth for all numeric thresholds in the scoring pipeline.
// Frozen to prevent accidental mutation.

var SCORING_CONFIG = Object.freeze({

  BOOKING: Object.freeze({
    RATING_SCALE_MIN:       2.5,
    RATING_SCALE_MAX:       10.0,
  }),

  AIRBNB: Object.freeze({
    GUEST_FAVORITE_BONUS:   1.0,
    SUPERHOST_BONUS:        0.5,
  }),

  ANOMALY: Object.freeze({
    MIN_REVIEW_COUNT:       50,
    CONFIDENCE_RAMP_RANGE:  50,
    JSD_NONE_MAX:           0.01,
    JSD_MILD_MAX:           0.03,
    JSD_MODERATE_MAX:       0.05,
    JSD_SIGNAL_THRESHOLD:   0.03,
    WEDGE_THRESHOLD:        0.3,
    WEDGE_HOLLOW_MIDDLE_MAX: 0.15,
    BIMODALITY_THRESHOLD:   0.555,
    INVERSION_THRESHOLD:    0.05,
    MILD_G_MAX:             65,
    MILD_G_MIN:             55,
    MODERATE_G_MAX:         55,
    MODERATE_G_MIN:         30,
    SEVERE_G_FLOOR:         5,
    SEVERE_G_MAX:           30,
    MILD_T_PENALTY:         5,
    MODERATE_T_PENALTY:     15,
    SEVERE_T_PENALTY:       25,
    MILD_DISCOUNT:          0.5,
    MODERATE_DISCOUNT:      0.35,
    SEVERE_DISCOUNT:        0.2,
    TRUST_DIVISOR:          3,
    FOUR_STAR_DEFICIT_THRESHOLD: 0.35, // below 0.35 = unnatural (SHI HOUSE=0.26 caught, genuine Ubud 4.9★=0.44 cleared)
    FOUR_STAR_DEFICIT_MIN_REVIEWS: 100, // need 100+ reviews for concentration signal to be reliable
    FOUR_STAR_DEFICIT_HIGH_VOL_MIN_REVIEWS: 500, // stricter FSD threshold above this histogram total
    FOUR_STAR_DEFICIT_HIGH_VOL_THRESHOLD: 0.45, // replaces 0.35 at high volume (catches Golden Lotus FSD=0.387, clears Kahayana FSD=0.436 at low vol)
    ONE_STAR_AUTHENTICITY_FLOOR: 0.025, // 1★ >= 2.5% suppresses 4★ deficit (real complaints = genuine)
    HISTOGRAM_MIN_RATING:   4.5,   // skip histogram shape signals below 4.5★ (budget hotels have natural J-shapes)
    RATING_GAP_THRESHOLD:   2.0,   // 2.0 points on 0-10 normalized scale
    RATING_GAP_DISCOUNT:    0.7,   // multiply trust by 0.7 (lighter than trust/3 ≈ 0.33)
  }),

  TRUST_LEVEL: Object.freeze({
    HIGH_THRESHOLD:         8.0,
    MEDIUM_THRESHOLD:       5.0,
  }),

  MATCHING: Object.freeze({
    CONFIDENCE_THRESHOLD:   0.85, // Stage 1: F0.5=0.957 at T=0.85 (post-improvement harness 2026-03-10, 1 FP / 6 FN)
    STAGE2_THRESHOLD:       0.75, // Stage 2: 0.10 lower than Stage 1 — city context improves scores (F0.5=0.913 at T=0.75)
    DEDUP_THRESHOLD:        0.80, // Dedup grouping: slightly below Stage 1, similar trust requirement (F0.5=0.927 at T=0.80)
  }),

  RATING_FLOOR: Object.freeze({
    DEFAULT:                8.0,
    STEP:                   0.5,
    MIN_RESULTS:            5,
    MIN_FLOOR:              0,
  }),

  BLENDING: Object.freeze({
    CREDIBILITY_MULTIPLIER: 3,       // Clean Google reviews count 3x their number
    MIN_EFFECTIVE_REVIEWS:  50,      // Minimum effective Google reviews (after multiplier) for blending
  }),

  TRUST: Object.freeze({
    GOOGLE_CLEAN_BOOST: 0.3,          // Trust bonus for clean Google Maps match
    GOOGLE_CLEAN_MIN_REVIEWS: 50,     // Minimum Google reviews to qualify for boost
  }),

  AGODA_NORMALIZATION: Object.freeze({
    // Piecewise linear breakpoints: Agoda -> Booking-equivalent
    // Calibrated from 126 paired observations across 11 cities (2026-03-28)
    // Inflation is graduated: +0.74 at <7.0, +0.49 at 7.x, +0.26 at 8.x, +0.16 at 9.x
    // All bands p < 0.05, overall t=10.61, Cohen's d=0.945
    // See: tests/analysis/agoda-inflation.js, tests/fixtures/rating-pairs-2026-03-28.js
    BREAKPOINTS: Object.freeze([
      { agoda: 0,    booking: 0 },
      { agoda: 2.0,  booking: 1.0 },
      { agoda: 5.0,  booking: 4.3 },
      { agoda: 7.0,  booking: 6.5 },
      { agoda: 8.0,  booking: 7.75 },
      { agoda: 9.0,  booking: 8.85 },
      { agoda: 10.0, booking: 9.9 },
    ]),
  }),

  CONFIDENCE: Object.freeze({
    AIRBNB_CAP: 30,      // Airbnb reaches full confidence at 30 reviews
    BOOKING_CAP: 200,    // Booking reaches full confidence at 200 reviews
    AGODA_CAP: 200,      // Agoda reaches full confidence at 200 reviews
  }),

});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SCORING_CONFIG };
}
