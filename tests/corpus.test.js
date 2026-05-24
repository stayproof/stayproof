var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var corpus = require('./fixtures/name-matching-corpus.json');

// ─── Corpus Structure Validation ────────────────────────────────────

describe('name-matching-corpus structure', function () {
  it('corpus contains 90-120 entries', function () {
    assert.ok(corpus.length >= 90, 'corpus has at least 90 entries (got ' + corpus.length + ')');
    assert.ok(corpus.length <= 120, 'corpus has at most 120 entries (got ' + corpus.length + ')');
  });

  it('every entry has required fields: nameA, nameB, expected, category, city', function () {
    corpus.forEach(function (entry, i) {
      assert.ok(typeof entry.nameA === 'string' && entry.nameA.length > 0,
        'entry ' + i + ' missing nameA');
      assert.ok(typeof entry.nameB === 'string' && entry.nameB.length > 0,
        'entry ' + i + ' missing nameB');
      assert.ok(typeof entry.expected === 'boolean',
        'entry ' + i + ' missing expected (boolean)');
      assert.ok(typeof entry.category === 'string' && entry.category.length > 0,
        'entry ' + i + ' missing category');
      assert.ok(typeof entry.city === 'string' && entry.city.length > 0,
        'entry ' + i + ' missing city');
    });
  });
});

describe('name-matching-corpus category balance', function () {
  it('true positives are 40-60% of corpus', function () {
    var tp = corpus.filter(function (e) { return e.expected === true; }).length;
    var pct = tp / corpus.length;
    assert.ok(pct >= 0.40, 'true positives should be >= 40% (got ' + (pct * 100).toFixed(1) + '%)');
    assert.ok(pct <= 0.60, 'true positives should be <= 60% (got ' + (pct * 100).toFixed(1) + '%)');
  });

  it('true negatives + hard negatives are 40-60% of corpus', function () {
    var tn = corpus.filter(function (e) { return e.expected === false; }).length;
    var pct = tn / corpus.length;
    assert.ok(pct >= 0.40, 'negatives should be >= 40% (got ' + (pct * 100).toFixed(1) + '%)');
    assert.ok(pct <= 0.60, 'negatives should be <= 60% (got ' + (pct * 100).toFixed(1) + '%)');
  });
});

describe('name-matching-corpus coverage', function () {
  it('at least 3 distinct cities represented', function () {
    var cities = {};
    corpus.forEach(function (e) { cities[e.city] = true; });
    var count = Object.keys(cities).length;
    assert.ok(count >= 3, 'need >= 3 cities (got ' + count + ': ' + Object.keys(cities).join(', ') + ')');
  });

  it('at least 3 distinct platform combinations represented', function () {
    var combos = {};
    corpus.forEach(function (e) {
      if (e.platforms && e.platforms.length > 0) {
        combos[e.platforms.slice().sort().join('+')] = true;
      }
    });
    var count = Object.keys(combos).length;
    assert.ok(count >= 3, 'need >= 3 platform combos (got ' + count + ': ' + Object.keys(combos).join(', ') + ')');
  });

  it('at least 5 pairs contain Vietnamese d-bar characters (U+0110 or U+0111)', function () {
    var dbarCount = corpus.filter(function (e) {
      return /[\u0110\u0111]/.test(e.nameA) || /[\u0110\u0111]/.test(e.nameB);
    }).length;
    assert.ok(dbarCount >= 5, 'need >= 5 d-bar pairs (got ' + dbarCount + ')');
  });
});

describe('name-matching-corpus required categories', function () {
  var requiredCategories = [
    'exact', 'transliteration', 'truncation', 'suffix-variation',
    'easy-negative', 'hard-negative-shared-token'
  ];

  requiredCategories.forEach(function (cat) {
    it('includes category: ' + cat, function () {
      var found = corpus.some(function (e) { return e.category === cat; });
      assert.ok(found, 'corpus must include category "' + cat + '"');
    });
  });
});
