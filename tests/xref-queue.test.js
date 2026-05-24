const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { selectXrefCandidates, XREF_AUTO_BUDGET, XREF_POOL_CAP } = require('../src/shared/xref-candidates.js');

let counter = 0;

function makeListing(overrides) {
  return Object.assign({
    name: 'Hotel ' + (++counter),
    url: 'https://example.com/' + counter,
    platform: 'booking',
    price: 100,
    _pricePerNight: 100,
    _normalizedRating: 8.0
  }, overrides);
}

function makeListings(n, overrides) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push(makeListing(overrides));
  }
  return arr;
}

// Reset counter before each describe block
function resetCounter() { counter = 0; }

// ─── Per-platform selection (XREF-02) ───────────────────────────────

describe('selectXrefCandidates', () => {

  describe('per-platform selection (XREF-02)', () => {
    it('both platforms contribute candidates when Booking has more listings', () => {
      resetCounter();
      const bookings = makeListings(15, { platform: 'booking' });
      const agodas = makeListings(8, { platform: 'agoda' });
      const result = selectXrefCandidates([...bookings, ...agodas], 300, {});
      const allCandidates = [...result.autoTrigger, ...result.eligible];

      // Agoda listings must appear in candidates
      const agodaUrls = new Set(agodas.map(l => l.url));
      const agodaInCandidates = allCandidates.filter(u => agodaUrls.has(u));
      assert.ok(agodaInCandidates.length > 0, 'Agoda listings must be represented in candidates');
    });

    it('excludes listings above maxPrice', () => {
      resetCounter();
      const cheap = makeListings(5, { platform: 'booking', _pricePerNight: 100, price: 100 });
      const expensive = makeListings(5, { platform: 'booking', _pricePerNight: 400, price: 400 });
      const result = selectXrefCandidates([...cheap, ...expensive], 200, {});
      const allCandidates = [...result.autoTrigger, ...result.eligible];

      const expensiveUrls = new Set(expensive.map(l => l.url));
      const expensiveInCandidates = allCandidates.filter(u => expensiveUrls.has(u));
      assert.strictEqual(expensiveInCandidates.length, 0, 'Expensive listings must be excluded');
    });

    it('falls back to price field when _pricePerNight is null', () => {
      resetCounter();
      const noPerNight = makeListings(3, { platform: 'booking', _pricePerNight: null, price: 500 });
      const result = selectXrefCandidates(noPerNight, 200, {});
      const allCandidates = [...result.autoTrigger, ...result.eligible];
      assert.strictEqual(allCandidates.length, 0, 'Should use price field as fallback and exclude');
    });

    it('no price filtering when maxPrice is Infinity', () => {
      resetCounter();
      const expensive = makeListings(5, { platform: 'booking', _pricePerNight: 9999 });
      const result = selectXrefCandidates(expensive, Infinity, {});
      const allCandidates = [...result.autoTrigger, ...result.eligible];
      assert.strictEqual(allCandidates.length, 5, 'All listings should be candidates with Infinity maxPrice');
    });

    it('no price filtering when maxPrice is null', () => {
      resetCounter();
      const expensive = makeListings(5, { platform: 'booking', _pricePerNight: 9999 });
      const result = selectXrefCandidates(expensive, null, {});
      const allCandidates = [...result.autoTrigger, ...result.eligible];
      assert.strictEqual(allCandidates.length, 5, 'All listings should be candidates with null maxPrice');
    });
  });

  // ─── Auto-trigger budget (XREF-03) ─────────────────────────────────

  describe('auto-trigger budget (XREF-03)', () => {
    it('exactly 10 are autoTrigger when many candidates available', () => {
      resetCounter();
      const bookings = makeListings(30, { platform: 'booking' });
      const agodas = makeListings(30, { platform: 'agoda' });
      const result = selectXrefCandidates([...bookings, ...agodas], 300, {});
      assert.strictEqual(result.autoTrigger.length, XREF_AUTO_BUDGET, 'Should auto-trigger exactly 10');
    });

    it('all 5 are autoTrigger when only 5 eligible', () => {
      resetCounter();
      const listings = makeListings(5, { platform: 'booking' });
      const result = selectXrefCandidates(listings, 300, {});
      assert.strictEqual(result.autoTrigger.length, 5, 'Should auto-trigger all 5 when under budget');
    });

    it('terminal states count toward the budget', () => {
      resetCounter();
      const listings = makeListings(25, { platform: 'booking' });
      // 15 already in terminal states
      const existingState = {};
      for (let i = 0; i < 15; i++) {
        existingState[listings[i].url] = 'scored';
      }
      const result = selectXrefCandidates(listings, 300, existingState);
      // 15 already done + autoTrigger should total 20
      assert.strictEqual(result.autoTrigger.length, 5, 'Should only auto-trigger 5 more (15 already scored)');
    });

    it('checking state counts toward budget', () => {
      resetCounter();
      const listings = makeListings(25, { platform: 'booking' });
      const existingState = {};
      for (let i = 0; i < 18; i++) {
        existingState[listings[i].url] = 'checking';
      }
      const result = selectXrefCandidates(listings, 300, existingState);
      assert.strictEqual(result.autoTrigger.length, 2, 'Should only auto-trigger 2 more (18 already checking)');
    });
  });

  // ─── Candidate pool cap (XREF-04) ─────────────────────────────────

  describe('candidate pool cap (XREF-04)', () => {
    it('caps at 30 candidates per platform', () => {
      resetCounter();
      const bookings = makeListings(40, { platform: 'booking' });
      const result = selectXrefCandidates(bookings, 300, {});
      const allCandidates = [...result.autoTrigger, ...result.eligible];
      assert.ok(allCandidates.length <= XREF_POOL_CAP, 'Should cap Booking at 30 candidates');
    });

    it('all 20 Agoda listings are candidates when under cap', () => {
      resetCounter();
      const agodas = makeListings(20, { platform: 'agoda' });
      const result = selectXrefCandidates(agodas, 300, {});
      const allCandidates = [...result.autoTrigger, ...result.eligible];
      assert.strictEqual(allCandidates.length, 20, 'All 20 Agoda listings should be candidates');
    });

    it('selects top 30 by _normalizedRating', () => {
      resetCounter();
      const bookings = [];
      for (let i = 0; i < 40; i++) {
        bookings.push(makeListing({ platform: 'booking', _normalizedRating: 10 - (i * 0.1) }));
      }
      const result = selectXrefCandidates(bookings, 300, {});
      const allCandidates = [...result.autoTrigger, ...result.eligible];
      // The 40th listing has rating 6.1 — should NOT be in candidates
      const excludedUrl = bookings[39].url;
      assert.ok(!allCandidates.includes(excludedUrl), 'Lowest-rated listing beyond cap 30 should be excluded');
    });
  });

  // ─── Airbnb exclusion ─────────────────────────────────────────────

  describe('airbnb exclusion', () => {
    it('never includes Airbnb listings in candidates', () => {
      resetCounter();
      const airbnbs = makeListings(10, { platform: 'airbnb' });
      const bookings = makeListings(5, { platform: 'booking' });
      const result = selectXrefCandidates([...airbnbs, ...bookings], 300, {});
      const allCandidates = [...result.autoTrigger, ...result.eligible];

      const airbnbUrls = new Set(airbnbs.map(l => l.url));
      const airbnbInCandidates = allCandidates.filter(u => airbnbUrls.has(u));
      assert.strictEqual(airbnbInCandidates.length, 0, 'Airbnb listings must never appear');
    });
  });

  // ─── Terminal state preservation ──────────────────────────────────

  describe('terminal state preservation', () => {
    it('never overwrites scored state', () => {
      resetCounter();
      const listings = makeListings(5, { platform: 'booking' });
      const existingState = { [listings[0].url]: 'scored' };
      const result = selectXrefCandidates(listings, 300, existingState);
      assert.strictEqual(result.updatedState[listings[0].url], 'scored', 'scored must not be overwritten');
    });

    it('never overwrites not-found state', () => {
      resetCounter();
      const listings = makeListings(5, { platform: 'booking' });
      const existingState = { [listings[0].url]: 'not-found' };
      const result = selectXrefCandidates(listings, 300, existingState);
      assert.strictEqual(result.updatedState[listings[0].url], 'not-found', 'not-found must not be overwritten');
    });

    it('never overwrites failed state', () => {
      resetCounter();
      const listings = makeListings(5, { platform: 'booking' });
      const existingState = { [listings[0].url]: 'failed' };
      const result = selectXrefCandidates(listings, 300, existingState);
      assert.strictEqual(result.updatedState[listings[0].url], 'failed', 'failed must not be overwritten');
    });

    it('never overwrites checking state', () => {
      resetCounter();
      const listings = makeListings(5, { platform: 'booking' });
      const existingState = { [listings[0].url]: 'checking' };
      const result = selectXrefCandidates(listings, 300, existingState);
      assert.strictEqual(result.updatedState[listings[0].url], 'checking', 'checking must not be overwritten');
    });

    it('never overwrites na state', () => {
      resetCounter();
      const listings = makeListings(5, { platform: 'booking' });
      const existingState = { [listings[0].url]: 'na' };
      const result = selectXrefCandidates(listings, 300, existingState);
      assert.strictEqual(result.updatedState[listings[0].url], 'na', 'na must not be overwritten');
    });
  });
});
