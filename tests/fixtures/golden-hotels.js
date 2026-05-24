// Golden scenario hotel fixtures — realistic archetypes covering the full trust spectrum.
// Each hotel has booking, google, price, and expected tier (1=best, 4=worst).
// Tier ordering is validated by relational assertions in golden.test.js.

module.exports = [
  // ─── Tier 1: Genuine, trustworthy ───────────────────────────────────

  {
    name: 'Genuine Luxury',
    booking: { rating: 8.6, reviewCount: 2400, isNew: false },
    google: { rating: 4.5, reviewCount: 3200, histogram: [128, 96, 320, 736, 1920] },
    price: 180,
    tier: 1,
  },

  {
    name: 'Solid Mid-Range',
    booking: { rating: 8.2, reviewCount: 800, isNew: false },
    google: { rating: 4.3, reviewCount: 1200, histogram: [60, 60, 144, 300, 636] },
    price: 90,
    tier: 1,
  },

  {
    name: 'Popular Budget',
    booking: { rating: 7.8, reviewCount: 400, isNew: false },
    google: { rating: 4.0, reviewCount: 600, histogram: [42, 42, 90, 168, 258] },
    price: 45,
    tier: 1,
  },

  // ─── Tier 2: Decent but limited data ────────────────────────────────

  {
    name: 'Good But New',
    booking: { rating: 8.4, reviewCount: 80, isNew: false },
    google: { rating: 4.2, reviewCount: 120, histogram: [6, 6, 14, 30, 64] },
    price: 110,
    tier: 2,
  },

  {
    name: 'Established Average',
    booking: { rating: 7.5, reviewCount: 300, isNew: false },
    google: { rating: 3.8, reviewCount: 400, histogram: [28, 28, 72, 112, 160] },
    price: 60,
    tier: 2,
  },

  {
    name: 'Cheap And Cheerful',
    booking: { rating: 7.0, reviewCount: 600, isNew: false },
    google: { rating: 3.5, reviewCount: 800, histogram: [96, 80, 144, 200, 280] },
    price: 30,
    tier: 2,
  },

  // ─── Tier 3: Suspicious signals ─────────────────────────────────────

  {
    name: 'Inflated Newcomer',
    booking: { rating: 9.5, reviewCount: 12, isNew: false },
    google: { rating: 4.9, reviewCount: 18, histogram: null },
    price: 120,
    tier: 3,
  },

  {
    name: 'Rating Gap',
    booking: { rating: 9.0, reviewCount: 150, isNew: false },
    google: { rating: 3.8, reviewCount: 500, histogram: [35, 35, 75, 140, 215] },
    price: 100,
    tier: 3,
  },

  {
    name: 'Too Perfect',
    booking: { rating: 9.8, reviewCount: 25, isNew: false },
    google: { rating: 4.8, reviewCount: 40, histogram: null },
    price: 95,
    tier: 3,
  },

  // ─── Tier 4: Confirmed fake/anomalous ───────────────────────────────

  {
    name: 'SeaColor Beachstay',
    booking: { rating: 9.1, reviewCount: 560, isNew: false },
    google: { rating: 4.5, reviewCount: 283, histogram: [30, 3, 3, 8, 239] },
    price: 65,
    tier: 4,
  },

  {
    name: 'Confirmed Fake',
    booking: { rating: 9.2, reviewCount: 50, isNew: false },
    google: { rating: 3.5, reviewCount: 2000, histogram: [300, 200, 150, 100, 1250] },
    price: 70,
    tier: 4,
  },

  {
    name: 'Incentivized Reviews',
    booking: { rating: 9.1, reviewCount: 920, isNew: false },
    google: { rating: 4.9, reviewCount: 2333, histogram: [23, 23, 23, 30, 2234] },
    price: 85,
    tier: 4,
  },

  {
    name: 'Extreme Manipulation',
    booking: { rating: 9.8, reviewCount: 8, isNew: false },
    google: { rating: 4.9, reviewCount: 15, histogram: null },
    price: 150,
    tier: 4,
  },

  {
    name: 'Clean Fake (SHI HOUSE pattern)',
    booking: { rating: 9.5, reviewCount: 285, isNew: false },
    google: { rating: 4.9, reviewCount: 371, histogram: [5, 3, 3, 10, 350] },
    price: 25,
    tier: 4,
  },

  {
    name: 'Golden Lotus Grand Da Nang (bought reviews at volume)',
    booking: { rating: 9.6, reviewCount: 8899, isNew: false },
    google: { rating: 4.9, reviewCount: 3521, histogram: [100, 120, 80, 150, 3071] },
    price: 87,
    tier: 4,
  },
];
