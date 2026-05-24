// Mock listing fixtures for the local visual-review server.
//
// These hit the real scoring/dedup/render pipeline — the values are RAW
// (platform / name / url / rating / reviewCount / price / lat / lng) and
// scoreAndRankListings computes everything else (Bayesian, normalized,
// anomaly, tiers).
//
// Edit freely when adding new fixtures or stress-testing edge cases. The
// mock has no production weight.

(function () {
  // Booking.com — 0-10 scale ratings.
  var BOOKING = [
    {
      platform: 'booking',
      name: 'The Compass Rose Ubud',
      url: 'https://booking.com/hotel/id/the-compass-rose-ubud.html',
      rating: 9.4,
      reviewCount: 588,
      price: 980000,        // IDR per night
      currency: 'IDR',
      lat: -8.50,
      lng: 115.27,
    },
    {
      platform: 'booking',
      name: 'Adil Villa and Resort',
      url: 'https://booking.com/hotel/id/adil-villa.html',
      rating: 9.0,
      reviewCount: 2893,
      price: 560000,
      currency: 'IDR',
      // No coords — exercises the no-📍 path.
    },
    {
      platform: 'booking',
      name: 'Imperial Sanctuary Villa Ubud',
      url: 'https://booking.com/hotel/id/suspicious-palace.html',
      rating: 9.8,
      reviewCount: 412,
      price: 6500000,
      currency: 'IDR',
      lat: -8.51,
      lng: 115.26,
      // googleRating MUCH lower → anomaly detector fires.
      googleRating: 4.1,
      googleReviewCount: 230,
    },
    {
      platform: 'booking',
      name: 'Hidden Jungle Cabin Ubud',
      url: 'https://booking.com/hotel/id/tiny-new.html',
      rating: 9.5,
      reviewCount: 4,        // few-reviews path
      price: 720000,
      currency: 'IDR',
      lat: -8.49,
      lng: 115.28,
    },
    {
      platform: 'booking',
      name: 'Tjampuhan Ridge Resort & Spa',
      url: 'https://booking.com/hotel/id/tjampuhan-ridge.html',
      rating: 8.7,
      reviewCount: 1245,
      price: 880000,
      currency: 'IDR',
      lat: -8.505,
      lng: 115.255,
    },
    {
      platform: 'booking',
      name: 'Bisma Heights Ubud',
      url: 'https://booking.com/hotel/id/bisma-heights.html',
      rating: 9.1,
      reviewCount: 932,
      price: 1850000,
      currency: 'IDR',
      lat: -8.515,
      lng: 115.265,
    },
  ];

  // Airbnb — 0-5 scale ratings. `badges.isGuestFavorite` matches what the
  // production scraper sets; the Guest Favourite filter (enabled by default)
  // hides Airbnb listings without this badge, so mock listings need it.
  var AIRBNB = [
    {
      platform: 'airbnb',
      name: 'Hita House Living With Balinese Family',
      url: 'https://airbnb.com/rooms/12345678',
      rating: 4.9,
      reviewCount: 82,
      price: 600000,
      currency: 'IDR',
      lat: -8.48,
      lng: 115.25,
      badges: { isGuestFavorite: true },
    },
    {
      platform: 'airbnb',
      name: 'Cozy Home with Private Garden in Central Ubud',
      url: 'https://airbnb.com/rooms/87654321',
      rating: 4.7,
      reviewCount: 40,
      price: 1100000,
      currency: 'IDR',
      lat: -8.50,
      lng: 115.26,
      badges: { isGuestFavorite: true },
    },
    {
      platform: 'airbnb',
      name: 'Ubud Ku 6 - Modern Studio Loft',
      url: 'https://airbnb.com/rooms/55556666',
      rating: 4.85,
      reviewCount: 27,
      price: 800000,
      currency: 'IDR',
      lat: -8.51,
      lng: 115.27,
      badges: { isGuestFavorite: true },
    },
    {
      platform: 'airbnb',
      name: 'Jungle Treehouse with Pool',
      url: 'https://airbnb.com/rooms/22223333',
      rating: 4.92,
      reviewCount: 156,
      price: 1200000,
      currency: 'IDR',
      lat: -8.495,
      lng: 115.265,
      badges: { isGuestFavorite: true },
    },
    {
      platform: 'airbnb',
      name: 'Bamboo Villa near Monkey Forest',
      url: 'https://airbnb.com/rooms/33334444',
      rating: 4.81,
      reviewCount: 94,
      price: 950000,
      currency: 'IDR',
      lat: -8.518,
      lng: 115.262,
      badges: { isGuestFavorite: true },
    },
    {
      platform: 'airbnb',
      name: 'Riverside Bungalow, Rice Field Views',
      url: 'https://airbnb.com/rooms/44445555',
      rating: 4.95,
      reviewCount: 213,
      price: 1450000,
      currency: 'IDR',
      lat: -8.502,
      lng: 115.275,
      badges: { isGuestFavorite: true },
    },
    {
      platform: 'airbnb',
      name: 'Studio in Central Ubud with Yoga Deck',
      url: 'https://airbnb.com/rooms/66667777',
      rating: 4.74,
      reviewCount: 67,
      price: 520000,
      currency: 'IDR',
      lat: -8.508,
      lng: 115.258,
      badges: { isGuestFavorite: true },
    },
  ];

  // Agoda — 0-10 scale, normalized internally to Booking-equivalent.
  var AGODA = [
    {
      platform: 'agoda',
      name: 'Rumah Baris Ubud',
      url: 'https://agoda.com/rumah-baris-ubud',
      rating: 9.0,
      reviewCount: 48,
      price: 320000,
      currency: 'IDR',
      lat: -8.49,
      lng: 115.27,
    },
    {
      platform: 'agoda',
      name: 'Arnawa Bungalow',
      url: 'https://agoda.com/arnawa-bungalow',
      rating: 8.8,
      reviewCount: 85,
      price: 240000,
      currency: 'IDR',
      lat: -8.50,
      lng: 115.28,
    },
    // Same property on Booking too — exercises cross-platform dedup.
    {
      platform: 'booking',
      name: 'Rumah Baris Ubud',
      url: 'https://booking.com/hotel/id/rumah-baris-ubud.html',
      rating: 8.9,
      reviewCount: 51,
      price: 340000,
      currency: 'IDR',
      lat: -8.49,
      lng: 115.27,
    },
  ];

  window.MOCK_LISTINGS_BY_PLATFORM = {
    booking: BOOKING.concat(AGODA.filter(function (l) { return l.platform === 'booking'; })),
    airbnb: AIRBNB,
    agoda: AGODA.filter(function (l) { return l.platform === 'agoda'; }),
  };

  // Pre-baked Google Maps cross-reference results (keyed by listing URL).
  // Drives the "Check"/"Not found"/star-rating display in the gmaps column.
  //
  // Shape mirrors what the background script sends as the `data` field of a
  // `searchXrefResult` message — handleXrefResult requires `data.rating` AND
  // `data.googleName` to count as a match (anything else lands as 'not-found').
  // The `histogram` field is [1-star, 2-star, 3-star, 4-star, 5-star] counts
  // — it drives anomaly detection (bimodal / unnatural distribution flags).
  window.MOCK_XREF_BY_URL = {
    'https://booking.com/hotel/id/the-compass-rose-ubud.html': {
      rating: 4.8,
      reviewCount: 387,
      googleName: 'The Compass Rose Ubud',
    },
    'https://booking.com/hotel/id/adil-villa.html': {
      error: 'not-found',
    },
    'https://booking.com/hotel/id/suspicious-palace.html': {
      // Platform claims 9.8/10 but Google says 3.5/5 (= 7.0 normalized).
      // Gap of 2.8 exceeds RATING_GAP_THRESHOLD (2.0) → rating-gap anomaly
      // fires, listing renders the ⚠ icon + tooltip. googleName must
      // fuzzy-match the platform listing name or handleXrefResult rejects
      // the xref as a mis-match.
      rating: 3.5,
      reviewCount: 230,
      googleName: 'Imperial Sanctuary Villa Ubud',
      histogram: [120, 25, 10, 25, 50],
    },
    'https://agoda.com/rumah-baris-ubud': {
      rating: 4.9,
      reviewCount: 24,
      googleName: 'Rumah Baris Ubud',
    },
  };

  // Optional manifest override — keep in lockstep with package version when
  // taking before/after screenshots.
  window.MOCK_MANIFEST = { manifest_version: 3, name: 'StayProof (mock)', version: '0.0.0-mock' };
})();
