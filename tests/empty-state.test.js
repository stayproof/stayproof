var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

// ── Pure logic copied from src/search/search.js — must stay in sync ──
// search.js is not a module, so we duplicate the pure logic here for testing.
// Mirrors the empty-state branch in renderResults (~line 1604).

function buildEmptyMessage(opts) {
  var listingsLen = opts.listingsLen;
  var filterGF = !!opts.filterGF;
  var filterTR = !!opts.filterTR;
  var maxPrice = opts.maxPrice;
  var currencySymbol = opts.currencySymbol || '$';
  var formatPrice = opts.formatPrice || function (n) { return String(n); };

  if (listingsLen === 0) return 'No results found';

  var labelBits = [];
  if (filterGF) labelBits.push('Guest Favourite');
  if (filterTR) labelBits.push('Top Rated');
  var subject = labelBits.length ? 'No ' + labelBits.join(' / ') + ' results' : 'No results';
  var suffix = (maxPrice && !isNaN(maxPrice))
    ? ' under ' + currencySymbol + formatPrice(maxPrice) + '/night'
    : '';
  return subject + suffix;
}

// Mirrors the rating-floor guard in renderResults — only run the floor
// pass when there's something for it to act on, so an empty result from
// price/GF filtering doesn't silently un-check the Top Rated checkbox.
function shouldApplyRatingFloor(filteredLen) {
  return filteredLen > 0;
}

// ── buildEmptyMessage ────────────────────────────────────────────────

describe('buildEmptyMessage', function () {
  it('returns "No results found" when there are zero listings before any filter', function () {
    var msg = buildEmptyMessage({ listingsLen: 0, filterGF: true, filterTR: true, maxPrice: 100 });
    assert.equal(msg, 'No results found');
  });

  it('names both Guest Favourite and Top Rated when both are active', function () {
    var msg = buildEmptyMessage({
      listingsLen: 10, filterGF: true, filterTR: true, maxPrice: 1,
      currencySymbol: '£', formatPrice: function (n) { return n.toString(); }
    });
    assert.equal(msg, 'No Guest Favourite / Top Rated results under £1/night');
  });

  it('names only Guest Favourite when Top Rated is off', function () {
    var msg = buildEmptyMessage({
      listingsLen: 10, filterGF: true, filterTR: false, maxPrice: 50,
      currencySymbol: '$', formatPrice: function (n) { return n.toString(); }
    });
    assert.equal(msg, 'No Guest Favourite results under $50/night');
  });

  it('names only Top Rated when Guest Favourite is off', function () {
    var msg = buildEmptyMessage({
      listingsLen: 10, filterGF: false, filterTR: true, maxPrice: 50,
      currencySymbol: '$', formatPrice: function (n) { return n.toString(); }
    });
    assert.equal(msg, 'No Top Rated results under $50/night');
  });

  it('omits the filter subject when no filters are active', function () {
    var msg = buildEmptyMessage({
      listingsLen: 10, filterGF: false, filterTR: false, maxPrice: 50,
      currencySymbol: '$', formatPrice: function (n) { return n.toString(); }
    });
    assert.equal(msg, 'No results under $50/night');
  });

  it('omits the price suffix when max price is null', function () {
    var msg = buildEmptyMessage({
      listingsLen: 10, filterGF: true, filterTR: true, maxPrice: null
    });
    assert.equal(msg, 'No Guest Favourite / Top Rated results');
  });

  it('omits the price suffix when max price is NaN', function () {
    var msg = buildEmptyMessage({
      listingsLen: 10, filterGF: false, filterTR: true, maxPrice: NaN
    });
    assert.equal(msg, 'No Top Rated results');
  });

  it('uses the currency symbol passed in (not a hardcoded prefix)', function () {
    var msg = buildEmptyMessage({
      listingsLen: 5, filterGF: true, filterTR: false, maxPrice: 1000,
      currencySymbol: '¥', formatPrice: function (n) { return n.toString(); }
    });
    assert.equal(msg, 'No Guest Favourite results under ¥1000/night');
  });

  it('uses the formatPrice fn passed in (so thousands separators stay consistent)', function () {
    var msg = buildEmptyMessage({
      listingsLen: 5, filterGF: false, filterTR: true, maxPrice: 250000,
      currencySymbol: 'Rp', formatPrice: function (n) { return n.toLocaleString('en-US'); }
    });
    assert.equal(msg, 'No Top Rated results under Rp250,000/night');
  });
});

// ── shouldApplyRatingFloor ──────────────────────────────────────────

describe('shouldApplyRatingFloor', function () {
  it('returns false for an empty filtered set', function () {
    // Guards the silent-Top-Rated-uncheck bug: when price/GF empties the
    // pre-floor list, applyRatingFloor must NOT run, because that path
    // calls updateFloorIndicator(0, true) which unchecks Top Rated.
    assert.equal(shouldApplyRatingFloor(0), false);
  });

  it('returns true for a single-listing filtered set', function () {
    assert.equal(shouldApplyRatingFloor(1), true);
  });

  it('returns true for a larger filtered set', function () {
    assert.equal(shouldApplyRatingFloor(50), true);
  });
});
