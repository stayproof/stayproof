// Blending test fixtures — real-world hotel scenarios for credibility-weighted rating blending.
// Each hotel defines platform data, Google cross-reference data, and expected blending outcome.
// Used by tests/blending.test.js (RED phase — blendRating() does not exist yet).

module.exports = [
  // ─── Golden cases ─────────────────────────────────────────────────

  {
    name: 'MIICO HOTEL',
    platform: 'agoda',
    platformRating: 9.0,
    platformReviewCount: 200,
    google: { rating: 3.6, reviewCount: 39, histogram: [8, 5, 6, 8, 12] },
    expected: {
      direction: 'down',
      changed: true,
      blendedRange: [7.0, 8.5],
      reason: 'Google rating significantly lower than platform',
    },
  },

  {
    name: 'Grand Hyatt',
    platform: 'booking',
    platformRating: 8.6,
    platformReviewCount: 2400,
    google: { rating: 4.5, reviewCount: 3200, histogram: [128, 96, 320, 736, 1920] },
    expected: {
      direction: 'slight',
      changed: true,
      maxChange: 0.5,
      reason: 'Ratings roughly agree after normalization (4.5 Google ~ 9.0 norm)',
    },
  },

  {
    name: 'Budget Gem',
    platform: 'booking',
    platformRating: 7.5,
    platformReviewCount: 300,
    google: { rating: 3.8, reviewCount: 400, histogram: [28, 28, 72, 112, 160] },
    expected: {
      direction: 'minimal',
      changed: true,
      maxChange: 0.3,
      reason: 'Normalized Google rating (7.6) nearly identical to platform (7.5)',
    },
  },

  // ─── Edge cases: no blending ──────────────────────────────────────

  {
    name: 'No Google Data',
    platform: 'agoda',
    platformRating: 8.5,
    platformReviewCount: 500,
    google: null,
    expected: {
      direction: 'none',
      changed: false,
      blendedExact: 8.5,
      reason: 'No Google cross-reference available',
    },
  },

  {
    name: 'Google No Histogram',
    platform: 'booking',
    platformRating: 8.8,
    platformReviewCount: 300,
    google: { rating: 4.3, reviewCount: 200, histogram: null },
    expected: {
      direction: 'down',
      changed: true,
      blendedRange: [7.5, 8.7],
      reason: 'Google rating pulls platform rating down',
    },
  },

  {
    name: 'Google No Histogram Low Reviews',
    platform: 'booking',
    platformRating: 9.0,
    platformReviewCount: 500,
    google: { rating: 3.5, reviewCount: 15, histogram: null },
    expected: {
      direction: 'none',
      changed: false,
      blendedExact: 9.0,
      reason: 'Too few Google reviews',
    },
  },

  {
    name: 'Anomalous Google',
    platform: 'booking',
    platformRating: 8.7,
    platformReviewCount: 400,
    google: { rating: 4.8, reviewCount: 500, histogram: [5, 2, 2, 5, 486] },
    expected: {
      direction: 'up',
      changed: true,
      blendedRange: [8.7, 9.5],
      reason: 'Anomalous histogram does not block blending — Google rating still influences result',
    },
  },

  {
    name: 'Google Agrees',
    platform: 'agoda',
    platformRating: 8.0,
    platformReviewCount: 600,
    google: { rating: 4.0, reviewCount: 800, histogram: [48, 48, 120, 224, 360] },
    expected: {
      direction: 'minimal',
      changed: true,
      maxChange: 0.3,
      reason: 'Google normalized rating (8.0) matches platform exactly',
    },
  },

  {
    name: 'Low Google Reviews',
    platform: 'booking',
    platformRating: 9.0,
    platformReviewCount: 500,
    google: { rating: 3.5, reviewCount: 15, histogram: [3, 2, 2, 3, 5] },
    expected: {
      direction: 'none',
      changed: false,
      blendedExact: 9.0,
      reason: 'Google review count below minimum threshold (50)',
    },
  },
];
