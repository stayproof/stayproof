// Chrome MV3 API stub for the local visual-review mock.
// Loaded BEFORE the real shared scripts and search.js so window.chrome exists
// when those modules first reference it. Keep behavior shallow — the goal is
// to let the page render mock results, not to faithfully simulate the
// background scraper pipeline.

(function () {
  // ---- chrome.storage.local ----
  // Backed by sessionStorage so reloads in the same tab keep your last picked
  // currency, but a fresh tab gets a clean slate (good for screenshot runs).
  var KEY = '__stayproof_mock_storage';
  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch (_) { return {}; }
  }
  function save(s) { sessionStorage.setItem(KEY, JSON.stringify(s)); }

  var storage = {
    local: {
      get: function (keys, cb) {
        var s = load();
        var out = {};
        if (typeof keys === 'string') {
          if (s[keys] !== undefined) out[keys] = s[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach(function (k) { if (s[k] !== undefined) out[k] = s[k]; });
        } else if (keys && typeof keys === 'object') {
          Object.keys(keys).forEach(function (k) { out[k] = s[k] !== undefined ? s[k] : keys[k]; });
        } else {
          out = s;
        }
        Promise.resolve().then(function () { cb && cb(out); });
      },
      set: function (items, cb) {
        var s = load();
        Object.keys(items).forEach(function (k) { s[k] = items[k]; });
        save(s);
        Promise.resolve().then(function () { cb && cb(); });
      },
      remove: function (keys, cb) {
        var s = load();
        var arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(function (k) { delete s[k]; });
        save(s);
        Promise.resolve().then(function () { cb && cb(); });
      },
    },
  };

  // ---- chrome.runtime.onMessage ----
  var listeners = [];
  var onMessage = {
    addListener: function (fn) { listeners.push(fn); },
    removeListener: function (fn) {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: function (fn) { return listeners.indexOf(fn) >= 0; },
  };
  function fire(msg) { listeners.forEach(function (l) { try { l(msg); } catch (e) { console.warn(e); } }); }

  // ---- chrome.runtime.sendMessage ----
  // The real background does scraping + xref. Here we mock by reading from
  // window.MOCK_LISTINGS_BY_PLATFORM and synthesizing the same `searchResults`
  // and `searchProgress` messages the page expects.
  function sendMessage(message, cb) {
    var t = message && message.type;
    if (t === 'startSearch') {
      // Simulate a brief progress phase, then deliver per-platform results.
      ['booking', 'airbnb', 'agoda'].forEach(function (platform, i) {
        setTimeout(function () {
          fire({ type: 'searchProgress', platform: platform, status: 'scraping' });
        }, 50 + i * 60);
        setTimeout(function () {
          var listings = (window.MOCK_LISTINGS_BY_PLATFORM || {})[platform] || [];
          fire({ type: 'searchResults', platform: platform, listings: listings });
        }, 200 + i * 80);
      });
    } else if (t === 'probeXrefCache') {
      // Real shape: { hits: [{ listingId, hotelName, data }] } — only matched
      // entries (with both `rating` and `googleName`) qualify as cache hits.
      var xref = window.MOCK_XREF_BY_URL || {};
      var hits = [];
      (message.listings || []).forEach(function (l) {
        var entry = xref[l.listingId];
        if (entry && entry.rating && entry.googleName) {
          hits.push({ listingId: l.listingId, hotelName: l.hotelName, data: entry });
        }
      });
      Promise.resolve().then(function () { cb && cb({ hits: hits }); });
    } else if (t === 'searchXref') {
      // Always fire a result so xrefState transitions out of 'checking'. If
      // the URL has no MOCK entry, an empty data object → handleXrefResult
      // marks the listing as 'not-found' (mirrors real "no Google match").
      var xref2 = window.MOCK_XREF_BY_URL || {};
      var data = xref2[message.listingId] || {};
      setTimeout(function () {
        fire({
          type: 'searchXrefResult',
          listingId: message.listingId,
          hotelName: message.hotelName,
          data: data,
        });
      }, 100);
    } else {
      // Unknown message — silently no-op. cb may still expect a response.
      Promise.resolve().then(function () { cb && cb(undefined); });
    }
  }

  // ---- chrome.runtime.getManifest ----
  // Read from window.MOCK_MANIFEST if set; otherwise default to v0.0.0-mock.
  function getManifest() {
    return window.MOCK_MANIFEST || { manifest_version: 3, name: 'StayProof (mock)', version: '0.0.0-mock' };
  }

  window.chrome = window.chrome || {};
  window.chrome.storage = storage;
  window.chrome.runtime = window.chrome.runtime || {};
  window.chrome.runtime.onMessage = onMessage;
  window.chrome.runtime.sendMessage = sendMessage;
  window.chrome.runtime.getManifest = getManifest;
  window.chrome.tabs = window.chrome.tabs || { sendMessage: function () {} };
  window.chrome.alarms = window.chrome.alarms || { create: function () {}, onAlarm: { addListener: function () {} } };
})();
