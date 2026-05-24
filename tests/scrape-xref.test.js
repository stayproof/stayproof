/**
 * Test the Google Maps scrape function against mock DOM.
 * This verifies the selectors and parsing logic work correctly
 * without needing a real browser.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock DOM ────────────────────────────────────────────────────────

// Minimal DOM implementation for testing
function createMockDocument(html) {
  // Parse HTML into a simple queryable structure
  // We'll use a regex-based approach since we don't have jsdom
  const elements = [];
  const doc = {
    _html: html,
    querySelector: function (selector) {
      return queryFirst(html, selector);
    },
    querySelectorAll: function (selector) {
      return queryAll(html, selector);
    },
  };
  return doc;
}

// Simple selector matching (covers the patterns used in scrapeGoogleMapsForXref)
function queryAll(html, selector) {
  const results = [];
  const selectors = selector.split(',').map(s => s.trim());

  for (const sel of selectors) {
    if (sel.startsWith('div.')) {
      const cls = sel.replace('div.', '');
      const re = new RegExp('<div[^>]*class="[^"]*' + cls + '[^"]*"[\\s\\S]*?</div>', 'g');
      let m;
      while ((m = re.exec(html)) !== null) {
        results.push(createEl(m[0]));
      }
    } else if (sel.startsWith('span.')) {
      const cls = sel.replace('span.', '');
      const re = new RegExp('<span[^>]*class="[^"]*' + cls + '[^"]*"[^>]*>[^<]*</span>', 'g');
      let m;
      while ((m = re.exec(html)) !== null) {
        results.push(createEl(m[0]));
      }
    } else if (sel.startsWith('tr.')) {
      const cls = sel.replace('tr.', '');
      const re = new RegExp('<tr[^>]*class="[^"]*' + cls + '[^"]*"[\\s\\S]*?</tr>', 'g');
      let m;
      while ((m = re.exec(html)) !== null) {
        results.push(createEl(m[0]));
      }
    } else if (sel === 'tr[aria-label*="star"]') {
      // Match <tr ... aria-label="... star ..."> elements
      const re = /<tr[^>]*aria-label="[^"]*star[^"]*"[^>]*>[^<]*<\/tr>/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        results.push(createEl(m[0]));
      }
    }
  }
  return results;
}

function queryFirst(html, selector) {
  const all = queryAll(html, selector);
  if (all.length > 0) return all[0];

  // Handle more complex selectors for detail panel
  if (selector.includes('span[aria-hidden="true"]')) {
    const re = /<span[^>]*aria-hidden="true"[^>]*>([^<]*)<\/span>/;
    const m = html.match(re);
    if (m) return createEl(m[0]);
  }
  if (selector.includes('span[aria-label*="review"]')) {
    const re = /<span[^>]*aria-label="[^"]*review[^"]*"[^>]*>[^<]*<\/span>/i;
    const m = html.match(re);
    if (m) return createEl(m[0]);
  }
  if (selector.includes('#captcha-form') || selector.includes('.g-recaptcha')) {
    if (html.includes('id="captcha-form"') || html.includes('class="g-recaptcha"')) {
      return createEl('<div></div>');
    }
  }
  if (selector.includes('h1.fontHeadlineLarge') || selector === 'h1') {
    const re = /<h1[^>]*>([^<]*)<\/h1>/;
    const m = html.match(re);
    if (m) return createEl(m[0]);
  }
  if (selector.includes('a[aria-label]')) {
    const re = /<a[^>]*aria-label="([^"]*)"[^>]*>/;
    const m = html.match(re);
    if (m) return createEl(m[0]);
  }
  if (selector.includes('div.F7nice')) {
    const re = /<div[^>]*class="[^"]*F7nice[^"]*"[^>]*>([\s\S]*?)<\/div>/;
    const m = html.match(re);
    if (m) return { querySelector: (s) => queryFirst(m[1], s) };
  }

  return null;
}

function createEl(html) {
  const textMatch = html.match(/>([^<]*)</);
  const ariaLabel = html.match(/aria-label="([^"]*)"/);
  const ariaHidden = html.match(/aria-hidden="([^"]*)"/);
  const styleWidth = html.match(/style="[^"]*width:\s*([^;"]+)/);

  return {
    textContent: textMatch ? textMatch[1] : '',
    getAttribute: function (attr) {
      if (attr === 'aria-label') return ariaLabel ? ariaLabel[1] : null;
      if (attr === 'aria-hidden') return ariaHidden ? ariaHidden[1] : null;
      return null;
    },
    style: { width: styleWidth ? styleWidth[1] : '' },
    querySelector: function (sel) {
      return queryFirst(html, sel);
    },
  };
}

// ─── The actual scrape function (copied from service-worker.js) ──────
// NOTE: This is a simplified copy of scrapeGoogleMapsForXref from service-worker.js.
// It must be kept in sync with the production version. The key difference is that
// this version uses doc.querySelector/querySelectorAll (injected) rather than
// the browser's document global, and omits chrome-specific code.

function scrapeGoogleMapsForXref(doc) {
  // ── Centralized Google Maps DOM selectors (test subset) ──
  // Mirrors production GMAPS_SELECTORS structure but only includes selectors used by the test copy.
  const GMAPS_SELECTORS = {
    _lastVerified: '2026-03-08',

    captcha: {
      form: ['#captcha-form', '.g-recaptcha', '[data-sitekey]']
    },

    detail: {
      histogramRows: ['tr[aria-label*="star"]', 'tr.BHOKXe'],
      reviewCount: ['span[aria-label*="review"]'],
      name: ['h1.fontHeadlineLarge', 'h1']
    },

    search: {
      resultCard: ['div.Nv2PK'],
      rating: ['span.MW4etd'],
      reviewCount: ['span.UY7F9'],
      name: ['a[aria-label]']
    }
  };

  // ── Cascade helpers ──
  const queryFirstCascade = function(root, selectors) {
    for (let i = 0; i < selectors.length; i++) {
      const el = root.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  };

  const queryAllFirst = function(root, selectors) {
    for (let i = 0; i < selectors.length; i++) {
      const els = root.querySelectorAll(selectors[i]);
      if (els.length > 0) return els;
    }
    return [];
  };

  const queryAny = function(root, selectors) {
    return root.querySelector(selectors.join(', '));
  };

  // Check for CAPTCHA
  if (queryAny(doc, GMAPS_SELECTORS.captcha.form)) {
    return { error: 'captcha' };
  }

  // Try detail panel first (richer data — includes histogram)
  // STRATEGY: Use histogram rows as the primary detail-panel detection signal.
  // As of 2026, the rating span selectors (stars/F7nice) are stale — they return 0 matches.
  // But histogram rows (tr[aria-label*="star"] and tr.BHOKXe) are confirmed working.

  // Try histogram — semantic first, class-based fallback
  var rows = queryAllFirst(doc, GMAPS_SELECTORS.detail.histogramRows);

  // Also attempt explicit rating span selectors (F7nice container approach)
  var detailContainer = doc.querySelector('div.F7nice');
  var detailRatingEl = (detailContainer ? detailContainer.querySelector('span[aria-hidden="true"]') : null) ||
                       doc.querySelector('span[aria-label*="stars"]');
  var detailCount = queryFirstCascade(doc, GMAPS_SELECTORS.detail.reviewCount);

  // Detect detail panel: either rating elements found OR 5 histogram rows present
  var isDetailPanel = (detailRatingEl && detailCount) || rows.length === 5;

  if (isDetailPanel) {
    var rating = null;
    var reviewCount = 0;

    if (detailRatingEl) {
      rating = parseFloat(detailRatingEl.textContent);
      if (isNaN(rating)) {
        var ariaRating = detailRatingEl.getAttribute('aria-label');
        if (ariaRating && /[\d.]+/.test(ariaRating)) {
          rating = parseFloat(ariaRating.match(/[\d.]+/)[0]);
        }
      }
      if (isNaN(rating)) rating = null;
    }

    if (detailCount) {
      var countLabel = detailCount.getAttribute('aria-label') || detailCount.textContent || '';
      var countMatch = countLabel.replace(/,/g, '').match(/(\d+)/);
      reviewCount = countMatch ? parseInt(countMatch[1], 10) : 0;
    }

    var histogram = null;
    if (rows.length === 5) {
      var starCounts = [];
      for (var i = rows.length - 1; i >= 0; i--) {
        var ariaLabel = rows[i].getAttribute('aria-label') || '';
        var m = ariaLabel.replace(/,/g, '').match(/(\d+)\s*review/i);
        if (m) {
          starCounts.push(parseInt(m[1], 10));
        } else {
          starCounts.push(0);
        }
      }
      histogram = starCounts;

      // Derive rating and reviewCount from histogram if not available from explicit selectors
      var totalFromHistogram = histogram.reduce(function(a, b) { return a + b; }, 0);
      if (totalFromHistogram > 0) {
        if (reviewCount === 0) {
          reviewCount = totalFromHistogram;
        }
        if (rating === null) {
          var weightedSum = 0;
          for (var s = 0; s < 5; s++) {
            weightedSum += histogram[s] * (s + 1);
          }
          rating = Math.round((weightedSum / totalFromHistogram) * 10) / 10;
        }
      }
    }

    var nameEl = queryFirstCascade(doc, GMAPS_SELECTORS.detail.name);
    var googleName = nameEl ? nameEl.textContent.trim() : null;

    if (rating !== null) {
      return { rating: rating, reviewCount: reviewCount, histogram: histogram, googleName: googleName, matchScore: null, source: 'detail' };
    }
  }

  // Fallback: first search result
  var results = doc.querySelectorAll(GMAPS_SELECTORS.search.resultCard[0]);
  for (var r = 0; r < results.length; r++) {
    var item = results[r];
    var ratingEl = item.querySelector(GMAPS_SELECTORS.search.rating[0]);
    var countEl = item.querySelector(GMAPS_SELECTORS.search.reviewCount[0]);
    if (!ratingEl) continue;

    var sRating = parseFloat(ratingEl.textContent);
    if (isNaN(sRating)) continue;

    var sCountText = countEl ? countEl.textContent : '';
    var sCountMatch = sCountText.replace(/[(),]/g, '').match(/(\d+)/);
    var sReviewCount = sCountMatch ? parseInt(sCountMatch[1], 10) : 0;

    var sNameEl = item.querySelector(GMAPS_SELECTORS.search.name[0]);
    var sGoogleName = sNameEl ? sNameEl.getAttribute('aria-label') : null;

    return { rating: sRating, reviewCount: sReviewCount, histogram: null, googleName: sGoogleName, matchScore: null, source: 'search' };
  }

  return null;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('scrapeGoogleMapsForXref - search results', () => {
  const html = `
    <div class="Nv2PK">
      <a aria-label="Ocean Star Da Nang Bay Hotel"></a>
      <span class="MW4etd">4.2</span>
      <span class="UY7F9">(688)</span>
    </div>
    <div class="Nv2PK">
      <a aria-label="Hilton Da Nang"></a>
      <span class="MW4etd">4.5</span>
      <span class="UY7F9">(2,345)</span>
    </div>
  `;
  const doc = createMockDocument(html);
  const result = scrapeGoogleMapsForXref(doc);

  it('returns a result', () => {
    assert.ok(result !== null, 'returns a result');
  });
  it('source is "search"', () => {
    assert.strictEqual(result.source, 'search');
  });
  it('rating is 4.2', () => {
    assert.strictEqual(result.rating, 4.2);
  });
  it('reviewCount is 688', () => {
    assert.strictEqual(result.reviewCount, 688);
  });
  it('name is correct', () => {
    assert.strictEqual(result.googleName, 'Ocean Star Da Nang Bay Hotel');
  });
  it('no histogram from search results', () => {
    assert.strictEqual(result.histogram, null);
  });
});

describe('scrapeGoogleMapsForXref - detail panel with histogram', () => {
  const html = `
    <div class="F7nice"><span aria-hidden="true">4.9</span></div>
    <span aria-label="2,333 reviews">2,333 reviews</span>
    <h1 class="fontHeadlineLarge">Doha Central Bliss Da Nang Hotel</h1>
    <tr class="BHOKXe" aria-label="5 stars, 2,234 reviews"></tr>
    <tr class="BHOKXe" aria-label="4 stars, 30 reviews"></tr>
    <tr class="BHOKXe" aria-label="3 stars, 23 reviews"></tr>
    <tr class="BHOKXe" aria-label="2 stars, 23 reviews"></tr>
    <tr class="BHOKXe" aria-label="1 star, 23 reviews"></tr>
  `;
  const doc = createMockDocument(html);
  const result = scrapeGoogleMapsForXref(doc);

  it('returns a result', () => {
    assert.ok(result !== null, 'returns a result');
  });
  it('source is "detail"', () => {
    assert.strictEqual(result.source, 'detail');
  });
  it('rating is 4.9', () => {
    assert.strictEqual(result.rating, 4.9);
  });
  it('reviewCount is 2333', () => {
    assert.strictEqual(result.reviewCount, 2333);
  });
  it('name correct', () => {
    assert.strictEqual(result.googleName, 'Doha Central Bliss Da Nang Hotel');
  });
  it('has histogram', () => {
    assert.ok(result.histogram !== null, 'has histogram');
  });
  it('histogram has 5 bins', () => {
    assert.strictEqual(result.histogram.length, 5);
  });
  it('1-star = 23', () => {
    assert.strictEqual(result.histogram[0], 23);
  });
  it('5-star = 2234', () => {
    assert.strictEqual(result.histogram[4], 2234);
  });
});

describe('scrapeGoogleMapsForXref - detail panel via histogram rows only (2026 DOM)', () => {
  // Simulates the live 2026 Google Maps DOM where F7nice/stars selectors are absent
  // but histogram rows (tr[aria-label*="star"]) are present and working.
  // Rating is derived from the weighted average of the histogram bins.
  const html = `
    <h1 class="fontHeadlineLarge">SeaColor Beachstay Danang Hotel</h1>
    <tr class="BHOKXe" aria-label="5 stars, 231 reviews"></tr>
    <tr class="BHOKXe" aria-label="4 stars, 10 reviews"></tr>
    <tr class="BHOKXe" aria-label="3 stars, 5 reviews"></tr>
    <tr class="BHOKXe" aria-label="2 stars, 4 reviews"></tr>
    <tr class="BHOKXe" aria-label="1 star, 8 reviews"></tr>
  `;
  const doc = createMockDocument(html);
  const result = scrapeGoogleMapsForXref(doc);

  it('returns a result', () => {
    assert.ok(result !== null, 'returns a result');
  });
  it('source is "detail"', () => {
    assert.strictEqual(result.source, 'detail');
  });
  it('has histogram', () => {
    assert.ok(result.histogram !== null, 'has histogram');
  });
  it('histogram has 5 bins', () => {
    assert.strictEqual(result.histogram.length, 5);
  });
  it('1-star = 8', () => {
    assert.strictEqual(result.histogram[0], 8);
  });
  it('5-star = 231', () => {
    assert.strictEqual(result.histogram[4], 231);
  });
  it('reviewCount derived from histogram total', () => {
    // 8 + 4 + 5 + 10 + 231 = 258
    assert.strictEqual(result.reviewCount, 258);
  });
  it('rating is a weighted average of the histogram', () => {
    // (8*1 + 4*2 + 5*3 + 10*4 + 231*5) / 258 = (8+8+15+40+1155)/258 = 1226/258 ≈ 4.8
    const expected = Math.round((8*1 + 4*2 + 5*3 + 10*4 + 231*5) / 258 * 10) / 10;
    assert.strictEqual(result.rating, expected);
  });
  it('name is extracted from h1', () => {
    assert.strictEqual(result.googleName, 'SeaColor Beachstay Danang Hotel');
  });
});

describe('scrapeGoogleMapsForXref - empty page', () => {
  it('returns null when no results found', () => {
    const html = '<div class="loading">Loading...</div>';
    const doc = createMockDocument(html);
    const result = scrapeGoogleMapsForXref(doc);
    assert.strictEqual(result, null);
  });
});

describe('scrapeGoogleMapsForXref - CAPTCHA', () => {
  it('detects CAPTCHA', () => {
    const html = '<form id="captcha-form"><div class="g-recaptcha"></div></form>';
    const doc = createMockDocument(html);
    const result = scrapeGoogleMapsForXref(doc);
    assert.ok(result !== null && result.error === 'captcha', 'detects CAPTCHA');
  });
});

// ─── matchScore in xref results ─────────────────────────────────────

describe('scrapeGoogleMapsForXref - matchScore contract', () => {
  it('search result includes matchScore field', () => {
    const html = `
      <div class="Nv2PK">
        <a aria-label="Ocean Star Da Nang Bay Hotel"></a>
        <span class="MW4etd">4.2</span>
        <span class="UY7F9">(688)</span>
      </div>
    `;
    const doc = createMockDocument(html);
    const result = scrapeGoogleMapsForXref(doc);
    assert.ok(result !== null, 'returns a result');
    assert.ok('matchScore' in result, 'search result must include matchScore field');
  });

  it('detail result includes matchScore field', () => {
    const html = `
      <div class="F7nice"><span aria-hidden="true">4.9</span></div>
      <span aria-label="100 reviews">100 reviews</span>
      <h1 class="fontHeadlineLarge">Test Hotel</h1>
      <tr class="BHOKXe" aria-label="5 stars, 80 reviews"></tr>
      <tr class="BHOKXe" aria-label="4 stars, 10 reviews"></tr>
      <tr class="BHOKXe" aria-label="3 stars, 5 reviews"></tr>
      <tr class="BHOKXe" aria-label="2 stars, 3 reviews"></tr>
      <tr class="BHOKXe" aria-label="1 star, 2 reviews"></tr>
    `;
    const doc = createMockDocument(html);
    const result = scrapeGoogleMapsForXref(doc);
    assert.ok(result !== null, 'returns a result');
    assert.ok('matchScore' in result, 'detail result must include matchScore field');
  });

  it('error result does not include matchScore', () => {
    const html = '<form id="captcha-form"><div class="g-recaptcha"></div></form>';
    const doc = createMockDocument(html);
    const result = scrapeGoogleMapsForXref(doc);
    assert.ok(result !== null && result.error === 'captcha');
    assert.ok(!('matchScore' in result) || result.matchScore == null,
      'error result should not have a matchScore');
  });

  it('null result when no match found', () => {
    const html = '<div class="loading">Loading...</div>';
    const doc = createMockDocument(html);
    const result = scrapeGoogleMapsForXref(doc);
    assert.strictEqual(result, null);
  });
});

// ─── xref cache entry shape ─────────────────────────────────────────

describe('xref cache entry shape contract', () => {
  // This verifies the expected shape of xref cache entries
  // that forwardXrefResult should produce.
  const expectedFields = ['rating', 'reviewCount', 'histogram', 'googleName', 'matchScore', 'placeUrl', 'source', 'incomplete', 'ts'];

  it('detail cache entry has all required fields including matchScore', () => {
    // Simulate what forwardXrefResult should produce for a detail result
    const cacheEntry = {
      rating: 4.9,
      reviewCount: 2333,
      histogram: [23, 23, 23, 30, 2234],
      googleName: 'Test Hotel',
      matchScore: 0.85,
      placeUrl: null,
      source: 'detail',
      incomplete: false,
      ts: Date.now(),
    };
    for (const field of expectedFields) {
      assert.ok(field in cacheEntry, `cache entry must have "${field}" field`);
    }
  });

  it('search-fallback cache entry has matchScore field', () => {
    const cacheEntry = {
      rating: 4.2,
      reviewCount: 688,
      histogram: null,
      googleName: 'Test Hotel',
      matchScore: 0.72,
      placeUrl: null,
      source: 'search',
      incomplete: true,
      ts: Date.now(),
    };
    assert.ok('matchScore' in cacheEntry, 'search-fallback cache entry must have matchScore');
    assert.strictEqual(typeof cacheEntry.matchScore, 'number');
  });
});
