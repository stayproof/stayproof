/* global chrome, trustRating, nameMatchConfidence, valueScores, airbnbToNormalizedRating, agodaToNormalizedRating, platformLabel, blendRating, SCORING_CONFIG, selectXrefCandidates, L, detectCurrency, getCurrencySymbol, CURRENCY_NAMES */

// Global state
var allListings = [];
var platformsReceived = { booking: false, airbnb: false, agoda: false };
var xrefState = {};       // keyed by listing.url → 'pending'|'checking'|'scored'|'not-found'|'failed'|'na'
var searchDestination = '';
var maxPrice = Infinity;   // no default price cap
var searchNights = 1;      // derived from checkin/checkout dates
var devMode = false;       // show raw + Bayesian scores side by side
var hoverLocked = false;
var pendingRerank = null;  // deferred re-rank function while hover-locked
var currentSort = { column: null, direction: 'asc' };
var ratingFloorValue = SCORING_CONFIG.RATING_FLOOR.DEFAULT;
var mapInstance = null;
var mapLayerGroup = null;
var mapVisible = false;
var mapUserInteracted = false;
var mapAutoFitting = false;
var lastFiltered = [];
var markersByUrl = {};
// 3-letter currency code (e.g. 'GBP', 'IDR'). Auto-detected on first run and
// stored — explicit selection thereafter. There's no persistent "auto" mode;
// users with a stale browser-locale signal can re-pick from the dropdown.
var selectedCurrency = null;
var currencyCode = 'USD';

// Platform display names
var platformNames = { booking: 'Booking.com', airbnb: 'Airbnb', agoda: 'Agoda' };

// ---- Dev helper: dump current listings for test fixtures ----
// Call window.dumpListings() in devtools console, paste into tests/fixtures/
function dumpListings() {
  var raw = allListings.map(function (l) {
    var o = {
      name: l.name, platform: l.platform, rating: l.rating,
      reviewCount: l.reviewCount, price: l.price, url: l.url
    };
    if (l.badges) o.badges = l.badges;
    if (l._googleData) o._googleData = {
      rating: l._googleData.rating,
      reviewCount: l._googleData.reviewCount,
      histogram: l._googleData.histogram || null
    };
    return o;
  });
  var fixture = {
    destination: searchDestination,
    date: new Date().toISOString().slice(0, 10),
    searchNights: searchNights,
    listings: raw
  };
  var json = JSON.stringify(fixture, null, 2);
  console.log(json);
  if (typeof copy === 'function') copy(json);
  return fixture;
}
window.dumpListings = dumpListings;

// Call window.dumpRatingPairs() after search to extract cross-platform rating pairs.
// Uses pre-dedup raw listings to find same property on different platforms.
var rawPreDedup = [];
function dumpRatingPairs() {
  if (rawPreDedup.length === 0) {
    console.log('[StayProof] No data — run a search first.');
    return null;
  }
  var groups = [];
  for (var i = 0; i < rawPreDedup.length; i++) {
    var listing = rawPreDedup[i];
    var matched = false;
    for (var g = 0; g < groups.length; g++) {
      if (groups[g][0].platform === listing.platform) continue;
      var alreadyHas = false;
      for (var x = 0; x < groups[g].length; x++) {
        if (groups[g][x].platform === listing.platform) { alreadyHas = true; break; }
      }
      if (alreadyHas) continue;
      var conf = nameMatchConfidence(listing.name, groups[g][0].name, searchDestination);
      if (conf >= SCORING_CONFIG.MATCHING.DEDUP_THRESHOLD) {
        groups[g].push(listing);
        matched = true;
        break;
      }
    }
    if (!matched) groups.push([listing]);
  }
  var pairs = [];
  for (var g = 0; g < groups.length; g++) {
    if (groups[g].length < 2) continue;
    var entry = { name: groups[g][0].name, platforms: {} };
    for (var m = 0; m < groups[g].length; m++) {
      entry.platforms[groups[g][m].platform] = {
        rating: groups[g][m].rating,
        reviewCount: groups[g][m].reviewCount,
        name: groups[g][m].name
      };
    }
    pairs.push(entry);
  }
  var output = { destination: searchDestination, date: new Date().toISOString().slice(0, 10), pairs: pairs };
  var json = JSON.stringify(output, null, 2);
  console.log(json);
  if (typeof copy === 'function') copy(json);
  console.log('[StayProof] ' + pairs.length + ' cross-platform pairs found. JSON copied to clipboard.');
  return output;
}
window.dumpRatingPairs = dumpRatingPairs;

// ---- Message listener (MUST be at top level, not inside DOMContentLoaded) ----
chrome.runtime.onMessage.addListener(function (message) {
  if (message.type === 'searchResults') handleSearchResults(message);
  if (message.type === 'searchProgress') handleSearchProgress(message);
  if (message.type === 'searchError') handleSearchError(message);
  if (message.type === 'searchXrefResult') handleXrefResult(message);
  if (message.type === 'settingsChanged' && message.settings && message.settings.selectedCurrency) {
    selectedCurrency = message.settings.selectedCurrency;
    currencyCode = selectedCurrency;
    syncComboboxInputValue();
    updatePricePrefix();
  }
});

// ---- DOM-dependent setup ----
document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('search-form');
  var searchBtn = document.getElementById('search-btn');

  var versionBadge = document.getElementById('version-badge');
  if (versionBadge && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    versionBadge.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // ---- Date default helpers (SRCH-01) ----
  function getNextFriday(from) {
    var d = new Date(from);
    var day = d.getDay(); // 0=Sun ... 5=Fri
    var daysUntilFriday = (5 - day + 7) % 7 || 7; // always next Friday, not today
    d.setDate(d.getDate() + daysUntilFriday);
    return d;
  }

  function toDateString(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // Pre-fill check-in (next Friday) and check-out (following Sunday)
  var today = new Date();
  var checkinDate = getNextFriday(today);
  var checkoutDate = new Date(checkinDate);
  checkoutDate.setDate(checkoutDate.getDate() + 2); // Sunday

  document.getElementById('checkin').value = toDateString(checkinDate);
  document.getElementById('checkout').value = toDateString(checkoutDate);

  // ---- Destination persistence — load saved value (SRCH-02) ----
  chrome.storage.local.get('lastDestination', function (data) {
    if (data.lastDestination) {
      document.getElementById('destination').value = data.lastDestination;
    }
  });

  // ---- Currency detection and saved preference ----
  chrome.storage.local.get('settings', function (data) {
    var settings = data.settings || {};
    if (settings.selectedCurrency && settings.selectedCurrency !== 'auto') {
      selectedCurrency = settings.selectedCurrency;
      currencyCode = settings.selectedCurrency;
    } else {
      // First run (or migrating away from the legacy 'auto' value) — detect
      // once from the browser locale and persist the resolved code, then treat
      // it as an explicit choice from then on.
      currencyCode = detectCurrency();
      selectedCurrency = currencyCode;
      settings.selectedCurrency = currencyCode;
      chrome.storage.local.set({ settings: settings });
    }
    // Wire up the searchable combobox now that selectedCurrency/currencyCode
    // are resolved from storage. setupCurrencyCombobox seeds the input value
    // from these vars and attaches the commit/filter/keyboard handlers.
    setupCurrencyCombobox(form);
    updatePricePrefix();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var destination = document.getElementById('destination').value.trim();
    var checkin = document.getElementById('checkin').value;
    var checkout = document.getElementById('checkout').value;

    // Validate all fields filled
    if (!destination || !checkin || !checkout) {
      return;
    }

    // Validate checkout > checkin
    if (checkout <= checkin) {
      updateStatus('checkout-error', 'Check-out must be after check-in', true);
      return;
    }

    // Calculate nights from dates
    var d1 = new Date(checkin);
    var d2 = new Date(checkout);
    searchNights = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));

    // Store destination for xref city parameter
    searchDestination = destination;

    // Persist destination across browser sessions (SRCH-02)
    chrome.storage.local.set({ lastDestination: destination });

    // Clear filter UI state for a fresh search (does NOT touch xrefCache —
    // scraper results live in the service worker and are correctly preserved
    // across searches).
    // Read maxPrice fresh from the input at submit time — the input listener
    // keeps the module var in sync during typing, but reading fresh here
    // defends against any path that mutates the input without firing 'input'
    // (autofill, formatter-style replacements, future code paths).
    var __maxPriceEl = document.getElementById('max-price');
    maxPrice = (__maxPriceEl && __maxPriceEl.value) ? parseInt(__maxPriceEl.value, 10) : Infinity;

    // Reset state for new search
    allListings = [];
    platformsReceived = { booking: false, airbnb: false, agoda: false };

    xrefState = {};
    hoverLocked = false;
    pendingRerank = null;
    currentSort = { column: null, direction: 'asc' };
    mapUserInteracted = false;

    // Clear previous results and status
    var resultsEl = document.getElementById('results');
    resultsEl.innerHTML = '';
    var statusEl = document.getElementById('status');
    statusEl.innerHTML = '';
    statusParts = {};

    // Clear map pins and status
    if (mapLayerGroup) mapLayerGroup.clearLayers();
    var mapStatusEl = document.getElementById('map-status');
    if (mapStatusEl) mapStatusEl.textContent = '';

    // Show initial status
    updateStatus('booking', 'Searching Booking.com...', false);
    updateStatus('airbnb', 'Searching Airbnb...', false);
    updateStatus('agoda', 'Searching Agoda...', false);

    // Disable submit during search and show spinner
    searchBtn.disabled = true;
    searchBtn.classList.add('search-btn-loading');
    searchBtn.innerHTML = '<span class="search-btn-spinner"></span> Searching...';

    // Read filter checkbox states
    var entireHomesOnly = document.getElementById('entire-homes-only').checked;
    var guestFavourite = document.getElementById('guest-favourite-only').checked;

    // Send search message to service worker
    chrome.runtime.sendMessage({
      type: 'startSearch',
      destination: destination,
      checkin: checkin,
      checkout: checkout,
      entireHomesOnly: entireHomesOnly,
      guestFavourite: guestFavourite,
      maxPrice: isFinite(maxPrice) ? maxPrice : null,
      currency: selectedCurrency,
    });
  });

  // Live price filter — re-render when value changes (after results exist)
  var maxPriceInput = document.getElementById('max-price');
  if (maxPriceInput) {
    maxPriceInput.addEventListener('input', function () {
      maxPrice = maxPriceInput.value ? parseInt(maxPriceInput.value, 10) : Infinity;
      if (allListings.length > 0) {
        renderResults(allListings);
      }
    });
  }

  // Live Guest Favourite filter — re-render when checkbox changes
  var gfCheckbox = document.getElementById('guest-favourite-only');
  if (gfCheckbox) {
    gfCheckbox.addEventListener('change', function () {
      if (allListings.length > 0) renderResults(allListings);
    });
  }

  // Top Rated toggle — enable/disable rating floor
  var topRatedCheckbox = document.getElementById('top-rated-only');
  if (topRatedCheckbox) {
    topRatedCheckbox.addEventListener('change', function () {
      if (topRatedCheckbox.checked) {
        ratingFloorValue = SCORING_CONFIG.RATING_FLOOR.DEFAULT;
      } else {
        ratingFloorValue = 0;
      }
      if (allListings.length > 0) renderResults(allListings);
    });
  }

  // Dev mode toggle — show raw vs Bayesian scores
  var devCheckbox = document.getElementById('dev-mode');
  if (devCheckbox) {
    devCheckbox.addEventListener('change', function () {
      devMode = devCheckbox.checked;
      if (allListings.length > 0) renderResults(allListings);
    });
  }

  // Currency selector — combobox commit (replaces the old <select> change
  // listener). Setup is deferred until chrome.storage.local.get('settings')
  // resolves so the input can seed its visible value from the persisted
  // selection. The commit handler inside setupCurrencyCombobox handles
  // persistence + re-search dispatch — same flow as the v1.0.2 listener.

  // Map toggle button
  var mapToggleBtn = document.getElementById('map-toggle-btn');
  if (mapToggleBtn) mapToggleBtn.addEventListener('click', toggleMap);
});

// ---- Status helpers ----

var statusParts = {};
function updateStatus(key, text, isError) {
  statusParts[key] = { text: text, isError: isError };
  var statusEl = document.getElementById('status');
  if (!statusEl) return;
  var parts = [];
  var order = ['booking', 'airbnb', 'agoda'];
  for (var i = 0; i < order.length; i++) {
    var p = statusParts[order[i]];
    if (p) {
      var span = '<span class="status-line' + (p.isError ? ' status-error' : '') + '">' + p.text + '</span>';
      parts.push(span);
    }
  }
  statusEl.innerHTML = parts.join(' <span class="status-sep">\u00b7</span> ');
}


// ---- Message handlers ----
function handleSearchProgress(message) {
  var platform = message.platform;
  var status = message.status;
  var count = message.count;
  var name = platformNames[platform] || platform;

  if (status === 'loading') {
    updateStatus(platform, 'Searching ' + name + '...', false);
  } else if (status === 'scraping') {
    updateStatus(platform, 'Scraping ' + name + '...', false);
  } else if (status === 'done') {
    var countText = (count === 0) ? '0 results' : count + ' results found';
    updateStatus(platform, name + ': ' + countText, false);
  }
}

function handleSearchResults(message) {
  var platform = message.platform;
  var listings = message.listings || [];
  var name = platformNames[platform] || platform;

  // Ensure each listing has a platform field
  for (var i = 0; i < listings.length; i++) {
    if (!listings[i].platform) {
      listings[i].platform = platform;
    }
  }

  // Mark Airbnb listings as N/A for xref — they are never cross-referenced
  if (platform === 'airbnb') {
    for (var a = 0; a < listings.length; a++) {
      if (listings[a].url) {
        xrefState[listings[a].url] = 'na';
      }
    }
  }

  // Merge into global list
  allListings = allListings.concat(listings);

  // Score and rank all listings
  scoreAndRankListings(allListings);
  if (currentSort.column) applyUserSort(allListings);

  // Render results
  renderResults(allListings);

  // Track received platforms
  platformsReceived[platform] = true;
  updateStatus(platform, name + ': ' + listings.length + ' results found', false);

  // Trigger auto cross-reference for top 10 Booking/Agoda results
  if ((platform === 'booking' || platform === 'agoda') && listings.length > 0) {
    triggerAutoXref();
  }

  // When all platforms have responded, deduplicate and re-render
  if (platformsReceived.booking && platformsReceived.airbnb && platformsReceived.agoda) {
    var searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.classList.remove('search-btn-loading');
      searchBtn.textContent = 'Search';
    }

    rawPreDedup = allListings.slice();
    computePerNightPrices(allListings, searchNights);
    var deduped = deduplicateListings(allListings);
    scoreAndRankListings(deduped);
    if (currentSort.column) applyUserSort(deduped);
    allListings = deduped;
    renderResults(allListings);

  }
}

function handleSearchError(message) {
  var platform = message.platform;
  var error = message.error || 'Unknown error';
  var name = platformNames[platform] || platform;

  updateStatus(platform, name + ': Failed -- ' + error, true);

  // Track as received so we don't block on failed platform
  platformsReceived[platform] = true;

  if (platformsReceived.booking && platformsReceived.airbnb && platformsReceived.agoda) {
    var searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.classList.remove('search-btn-loading');
      searchBtn.textContent = 'Search';
    }
  }
}

// ---- Cross-reference auto-check ----
function triggerAutoXref() {
  var TERMINAL = { scored: 1, 'not-found': 1, failed: 1, checking: 1, na: 1, pending: 1 };

  // Build list of candidates to probe (booking + agoda, not already terminal)
  var probeCandidates = [];
  for (var pi = 0; pi < allListings.length; pi++) {
    var pListing = allListings[pi];
    if (pListing.platform !== 'booking' && pListing.platform !== 'agoda') continue;
    if (!pListing.url || !pListing.name) continue;
    if (TERMINAL[xrefState[pListing.url]]) continue;
    probeCandidates.push({ listingId: pListing.url, hotelName: pListing.name });
  }

  function runBudgetSelection() {
    var result = selectXrefCandidates(allListings, maxPrice, xrefState);

    // Merge updatedState into xrefState (only set keys not already terminal)
    for (var key in result.updatedState) {
      if (result.updatedState.hasOwnProperty(key)) {
        xrefState[key] = result.updatedState[key];
      }
    }

    renderResults(allListings);

    // Build lookup for auto-trigger listings (need name + city for searchXref)
    var listingByUrl = {};
    for (var i = 0; i < allListings.length; i++) {
      if (allListings[i].url) listingByUrl[allListings[i].url] = allListings[i];
    }

    // Queue in batches of 3 with 300ms between batches
    var autoUrls = result.autoTrigger;
    var batchSize = 3;
    var batchIndex = 0;

    function sendBatch() {
      var start = batchIndex * batchSize;
      var end = Math.min(start + batchSize, autoUrls.length);
      if (start >= autoUrls.length) return;

      for (var b = start; b < end; b++) {
        var url = autoUrls[b];
        var listing = listingByUrl[url];
        if (!listing) continue;

        xrefState[url] = 'checking';

        chrome.runtime.sendMessage({
          type: 'searchXref',
          hotelName: listing.name,
          city: searchDestination,
          listingId: url
        });
      }

      renderResults(allListings);
      batchIndex++;

      if (batchIndex * batchSize < autoUrls.length) {
        setTimeout(sendBatch, 300);
      }
    }

    sendBatch();
  }

  if (probeCandidates.length === 0) {
    runBudgetSelection();
    return;
  }

  chrome.runtime.sendMessage({ type: 'probeXrefCache', listings: probeCandidates }, function (response) {
    // Process cache hits through handleXrefResult so they get xrefState = 'scored'
    if (response && response.hits) {
      for (var h = 0; h < response.hits.length; h++) {
        handleXrefResult({
          listingId: response.hits[h].listingId,
          hotelName: response.hits[h].hotelName,
          data: response.hits[h].data
        });
      }
    }
    // Budget selection now runs with cached listings already marked 'scored'
    runBudgetSelection();
  });
}

// ---- Cross-reference result handler ----
function handleXrefResult(message) {
  var listingId = message.listingId;
  var data = message.data;

  // Find the listing in allListings
  var listing = null;
  for (var i = 0; i < allListings.length; i++) {
    if (allListings[i].url === listingId) {
      listing = allListings[i];
      break;
    }
  }
  if (!listing) return;

  // Error case
  if (data && data.error) {
    xrefState[listingId] = 'not-found';
    if (hoverLocked) { updateCardsInPlace(allListings); } else { renderResults(allListings); }
    return;
  }

  // No data or no rating or no Google name
  if (!data || !data.rating || !data.googleName) {
    xrefState[listingId] = 'not-found';
    if (hoverLocked) { updateCardsInPlace(allListings); } else { renderResults(allListings); }
    return;
  }

  // Name match check
  var confidence = nameMatchConfidence(listing.name, data.googleName, searchDestination);
  if (confidence < SCORING_CONFIG.MATCHING.STAGE2_THRESHOLD) {
    xrefState[listingId] = 'not-found';
    if (hoverLocked) { updateCardsInPlace(allListings); } else { renderResults(allListings); }
    return;
  }

  // Store match confidence and Google data on listing and force recomputation
  listing._matchConfidence = confidence;
  listing._googleData = { rating: data.rating, reviewCount: data.reviewCount, histogram: data.histogram || null, placeUrl: data.placeUrl || null };
  listing._anomalyDirty = true;

  xrefState[listingId] = 'scored';

  // Recompute scores and animated re-rank
  scoreAndRankListings(allListings);
  if (currentSort.column) applyUserSort(allListings);
  renderResultsAnimated(allListings);
}

// ---- Per-night price computation (runs before dedup so sort can use _pricePerNight) ----
function computePerNightPrices(listings, nights) {
  for (var i = 0; i < listings.length; i++) {
    if (listings[i].price != null) {
      if (listings[i].platform === 'agoda') {
        // Agoda already shows per-night
        listings[i]._pricePerNight = listings[i].price;
      } else {
        // Booking & Airbnb show total stay price
        listings[i]._pricePerNight = Math.round(listings[i].price / nights);
      }
    }
  }
}

// ---- Deduplication — group same property across platforms ----
function deduplicateListings(listings) {
  var groups = []; // each group: { primary: listing, others: [listing, ...] }

  for (var i = 0; i < listings.length; i++) {
    var listing = listings[i];
    var matched = false;

    for (var g = 0; g < groups.length; g++) {
      // Skip if this platform is already in the group
      var hasPlatform = groups[g].primary.platform === listing.platform;
      if (!hasPlatform) {
        for (var o = 0; o < groups[g].others.length; o++) {
          if (groups[g].others[o].platform === listing.platform) { hasPlatform = true; break; }
        }
      }
      if (hasPlatform) continue;

      var confidence = nameMatchConfidence(listing.name, groups[g].primary.name, searchDestination);
      if (confidence >= SCORING_CONFIG.MATCHING.DEDUP_THRESHOLD) {
        console.log('[StayProof DEDUP]', listing.platform, '"' + listing.name + '" matched', groups[g].primary.platform, '"' + groups[g].primary.name + '" score=' + confidence.toFixed(3));
        groups[g].others.push(listing);
        matched = true;
        break;
      }
    }

    if (!matched) {
      groups.push({ primary: listing, others: [] });
    }
  }

  // For each group, pick the best-scored listing as primary and attach others
  var deduped = [];
  for (var g = 0; g < groups.length; g++) {
    var all = [groups[g].primary].concat(groups[g].others);

    // Pick primary: cheapest per-night price (best deal for user)
    all.sort(function (a, b) {
      var aPrice = a._pricePerNight != null ? a._pricePerNight : Infinity;
      var bPrice = b._pricePerNight != null ? b._pricePerNight : Infinity;
      return aPrice - bPrice;
    });

    var primary = all[0];
    primary._otherPrices = [];

    for (var j = 0; j < all.length; j++) {
      primary._otherPrices.push({
        platform: all[j].platform,
        pricePerNight: all[j]._pricePerNight,
        price: all[j].price,
        url: all[j].url,
      });
    }

    // Inherit coordinates from group if primary lacks them
    if (primary.lat == null || primary.lng == null) {
      for (var c = 1; c < all.length; c++) {
        if (all[c].lat != null && all[c].lng != null) {
          primary.lat = all[c].lat;
          primary.lng = all[c].lng;
          break;
        }
      }
    }

    // Use best per-night price for value scoring
    var bestPrice = null;
    for (var k = 0; k < primary._otherPrices.length; k++) {
      var ppn = primary._otherPrices[k].pricePerNight;
      if (ppn != null && (bestPrice === null || ppn < bestPrice)) {
        bestPrice = ppn;
      }
    }
    if (bestPrice !== null) primary._pricePerNight = bestPrice;

    deduped.push(primary);
  }

  return deduped;
}

// ---- Sort helpers (synced with tests/sort.test.js) ----
function getListingTier(listing) {
  if (listing._anomaly) return 1;
  return 0;
}

function applyUserSort(listings) {
  if (!currentSort.column) return listings;
  listings.sort(function (a, b) {
    var aTier = getListingTier(a);
    var bTier = getListingTier(b);
    if (aTier !== bTier) return aTier - bTier;

    var dir = currentSort.direction === 'asc' ? 1 : -1;
    if (currentSort.column === 'price') {
      var aPrice = a._pricePerNight != null ? a._pricePerNight : Infinity;
      var bPrice = b._pricePerNight != null ? b._pricePerNight : Infinity;
      return dir * (aPrice - bPrice);
    }
    if (currentSort.column === 'rating') {
      var aRating = a._bayesianRating != null ? a._bayesianRating : (a._normalizedRating != null ? a._normalizedRating : -1);
      var bRating = b._bayesianRating != null ? b._bayesianRating : (b._normalizedRating != null ? b._normalizedRating : -1);
      return dir * (aRating - bRating);
    }
    if (currentSort.column === 'distance') {
      var aDist = a._distanceKm != null ? a._distanceKm : Infinity;
      var bDist = b._distanceKm != null ? b._distanceKm : Infinity;
      return dir * (aDist - bDist);
    }
    if (currentSort.column === 'name') {
      var aName = (a.name || '').toLowerCase();
      var bName = (b.name || '').toLowerCase();
      if (aName < bName) return -1 * dir;
      if (aName > bName) return 1 * dir;
      return 0;
    }
    return 0;
  });
  return listings;
}

function toggleSort(column) {
  var defaults = { price: 'asc', rating: 'desc', name: 'asc', distance: 'asc' };
  if (currentSort.column === column) {
    if (currentSort.direction === 'asc') {
      currentSort = { column: column, direction: 'desc' };
    } else {
      currentSort = { column: null, direction: 'asc' };
    }
  } else {
    currentSort = { column: column, direction: defaults[column] || 'asc' };
  }
  if (currentSort.column) {
    applyUserSort(allListings);
  } else {
    // Reset to default composite score ordering
    allListings.sort(function (a, b) {
      var aTier = getListingTier(a);
      var bTier = getListingTier(b);
      if (aTier !== bTier) return aTier - bTier;
      return (b._smartScore || 0) - (a._smartScore || 0);
    });
  }
  renderResultsAnimated(allListings);
}

// ---- Scoring and ranking ----
function scoreAndRankListings(listings) {
  for (var i = 0; i < listings.length; i++) {
    var listing = listings[i];

    // Normalized rating
    if (listing._normalizedRating === undefined) {
      if (listing.rating != null) {
        if (listing.platform === 'booking') {
          listing._normalizedRating = listing.rating;
        } else if (listing.platform === 'agoda') {
          listing._normalizedRating = agodaToNormalizedRating(listing.rating);
        } else if (listing.platform === 'airbnb') {
          listing._normalizedRating = airbnbToNormalizedRating(listing.rating);
        } else {
          listing._normalizedRating = listing.rating * 2;
        }
      } else {
        listing._normalizedRating = null;
      }
    }

    // Anomaly detection via trustRating (recompute when xref arrives)
    if (listing._anomaly === undefined || listing._anomalyDirty) {
      var crossRef = listing._googleData || null;
      var badges = listing.platform === 'airbnb' ? listing.badges : null;
      var result = trustRating(listing.reviewCount, crossRef, badges, listing.rating, listing.platform);
      listing._anomaly = result.anomaly;
      listing._anomalySignals = result.breakdown.anomalySignals || [];
      listing._trustScore = result.trust;
      listing._anomalyDirty = false;

      // Blend platform rating with Google data when available
      var blendResult = blendRating(listing.rating, listing.platform, listing._googleData || null);
      listing._blendResult = blendResult;
    }
  }

  // Compute per-night prices for any listings that don't have it yet
  // (computePerNightPrices() runs before dedup; this handles xref-triggered rescoring)
  for (var pn = 0; pn < listings.length; pn++) {
    if (listings[pn].price != null && listings[pn]._pricePerNight == null) {
      if (listings[pn].platform === 'agoda') {
        // Agoda already shows per-night
        listings[pn]._pricePerNight = listings[pn].price;
      } else {
        // Booking & Airbnb show total stay price
        listings[pn]._pricePerNight = Math.round(listings[pn].price / searchNights);
      }
    }
  }

  // ── Price: compute median for log-relative scoring ──
  var prices = [];
  var priceIndices = [];
  for (var pi = 0; pi < listings.length; pi++) {
    if (listings[pi]._pricePerNight != null) {
      prices.push(listings[pi]._pricePerNight);
      priceIndices.push(pi);
    }
  }
  // Keep valueScores for UI tier colouring
  var vScores = valueScores(prices);
  for (var vi = 0; vi < priceIndices.length; vi++) {
    listings[priceIndices[vi]]._valueScore = vScores[vi];
  }
  // Median price for log-relative scoring
  var sortedPrices = prices.slice().sort(function (a, b) { return a - b; });
  var medianPrice = sortedPrices.length > 0
    ? (sortedPrices.length % 2 === 0
        ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
        : sortedPrices[Math.floor(sortedPrices.length / 2)])
    : null;

  // ── Non-linear rating curve: (r/10)^2 * 10 ──
  // Convex curve that separates excellent ratings (9+) more from mediocre (8.0)
  // Examples: 10.0 -> 10.0, 9.0 -> 8.1, 8.0 -> 6.4, 7.0 -> 4.9
  function ratingCurve(r) { return Math.pow(r / 10, 2) * 10; }

  // ── Bayesian review confidence with platform-aware caps ──
  // Smoothly blends observed rating toward dataset mean based on review count.
  // Airbnb cap=30 (fewer reviews per listing), Booking/Agoda cap=200
  var ratingSum = 0, ratingCount = 0;
  for (var mi = 0; mi < listings.length; mi++) {
    var miRating = (listings[mi]._blendResult && listings[mi]._blendResult.changed)
      ? listings[mi]._blendResult.blended : listings[mi]._normalizedRating;
    if (miRating != null) {
      ratingSum += miRating;
      ratingCount++;
    }
  }
  var datasetMean = ratingCount > 0 ? ratingSum / ratingCount : 7.5;

  // ── Composite score: non-linear Bayesian-weighted rating (no price component) ──
  // Formula: score = ratingCurve(confidence * rawRating + (1 - confidence) * datasetMean)
  // where ratingCurve(r) = (r/10)^2 * 10
  //
  // Rating-first ranking: pure quality signal. Price is available for user sort
  // but does not affect default ranking. Non-linear curve rewards excellence:
  //   9.5 -> 9.025, 9.0 -> 8.1, 8.0 -> 6.4 (top ratings separate clearly)
  //
  // Platform-aware confidence caps (from Phase 44 reviewConfidence):
  //   Airbnb: cap=30 (fewer reviews per listing)
  //   Booking/Agoda: cap=200

  for (var ci = 0; ci < listings.length; ci++) {
    // Rating for ranking: use blended (platform+Google) when available, else normalized
    // Trust score excluded — trust is for anomaly detection, not ranking
    var rawRating = (listings[ci]._blendResult && listings[ci]._blendResult.changed)
      ? listings[ci]._blendResult.blended
      : (listings[ci]._normalizedRating != null ? listings[ci]._normalizedRating : 0);
    // Platform-aware Bayesian confidence
    var v = listings[ci].reviewCount || 0;
    var cap = (listings[ci].platform === 'airbnb') ? 30 : 200;
    var confidence = Math.min(1, v / cap);
    var bayesianRating = confidence * rawRating + (1 - confidence) * datasetMean;
    listings[ci]._bayesianRating = bayesianRating;
    // Anomalous listings: skip Bayesian boost, use raw rating
    var effectiveRating = listings[ci]._anomaly ? rawRating : bayesianRating;
    listings[ci]._compositeScore = ratingCurve(effectiveRating);
    // Smart score: blend rating quality (70%) with price value (30%)
    var valueComponent = (listings[ci]._valueScore != null ? listings[ci]._valueScore : 50) / 10;
    listings[ci]._smartScore = 0.7 * listings[ci]._compositeScore + 0.3 * valueComponent;
    // Demote few-reviews listings so they don't outrank well-reviewed alternatives
    var fewCap = listings[ci].platform === 'airbnb' ? 10 : 30;
    if ((listings[ci].reviewCount || 0) < fewCap) {
      listings[ci]._smartScore *= 0.85;
      listings[ci]._fewReviews = true;
    }
  }

  // Sort: anomalies demoted, then smart score descending
  listings.sort(function (a, b) {
    var aTier = getListingTier(a);
    var bTier = getListingTier(b);
    if (aTier !== bTier) return aTier - bTier;
    return (b._smartScore || 0) - (a._smartScore || 0);
  });
}

// ---- Confidence label for Google Maps match tooltip ----
function confidenceLabel(score) {
  if (score >= 0.95) return 'Exact match';
  if (score >= 0.85) return 'High confidence match';
  return 'Likely match';
}

// ---- Rendering ----
function formatRating(listing) {
  if (listing.rating == null) return '--';
  // Primary: Bayesian-smoothed score (what we sort by)
  var bayesian = listing._bayesianRating;
  // Fallback to blended or normalized if scoring hasn't run yet
  if (bayesian == null) {
    bayesian = (listing._blendResult && listing._blendResult.changed)
      ? listing._blendResult.blended
      : listing._normalizedRating;
  }
  if (bayesian == null) return '--';
  var r = bayesian.toFixed(1);
  if (listing.reviewCount) r += ' (' + listing.reviewCount + ')';
  if (listing._fewReviews) r += ' · few reviews';
  // Dev mode: show raw platform rating for comparison
  if (devMode) {
    var raw = (listing.platform === 'airbnb')
      ? listing.rating.toFixed(2) + '/5'
      : listing.rating.toFixed(1) + '/10';
    r += ' [' + raw + ']';
  }
  return r;
}

function formatPriceNumber(n) {
  if (n == null || isNaN(n)) return '';
  return Math.round(n).toLocaleString('en-US');
}

function formatPrice(listing) {
  if (listing.price == null) return '--';
  var sym = getCurrencySymbol(currencyCode);
  if (listing._pricePerNight != null && searchNights > 1) {
    return sym + formatPriceNumber(listing._pricePerNight) + '/night';
  }
  return sym + formatPriceNumber(listing.price);
}

function formatPriceTotal(listing) {
  if (listing.price == null || searchNights <= 1) return null;
  var sym = getCurrencySymbol(currencyCode);
  if (listing.platform === 'agoda') {
    return sym + formatPriceNumber(listing.price * searchNights) + ' total (' + searchNights + ' nights)';
  }
  return sym + formatPriceNumber(listing.price) + ' total (' + searchNights + ' nights)';
}

function updatePricePrefix() {
  var el = document.querySelector('.price-prefix');
  if (el) el.textContent = getCurrencySymbol(currencyCode);
}

// Sync the closed-state combobox input value from the current currencyCode.
// Compact label ('£ GBP') — the full name appears in dropdown options when
// picking, but the closed widget stays terse to fit the form chip aesthetic.
function syncComboboxInputValue() {
  var input = document.getElementById('currency-input');
  if (!input) return;
  input.value = getCurrencySymbol(currencyCode) + ' ' + currencyCode;
}

/**
 * Wire up the searchable currency combobox.
 *
 * Implements the W3C ARIA APG combobox-autocomplete-list pattern:
 *   - input has role="combobox", aria-expanded, aria-controls, aria-activedescendant
 *   - listbox has role="listbox"
 *   - options have role="option"; section dividers role="presentation"
 *
 * Data source: CURRENCY_NAMES / CURRENCY_SYMBOLS (read off window — currency.js
 * defines them at module scope with `var`, so they're page-context globals).
 *
 * Called once from the chrome.storage.local.get('settings') callback after
 * selectedCurrency / currencyCode are resolved.
 */
function setupCurrencyCombobox(form) {
  var combobox = document.getElementById('currency-combobox');
  var input = document.getElementById('currency-input');
  var listbox = document.getElementById('currency-listbox');
  if (!combobox || !input || !listbox) return;
  var caret = combobox.querySelector('.combobox-caret');

  var POPULAR = ['USD', 'EUR', 'GBP', 'SGD', 'JPY', 'AUD', 'CAD', 'IDR', 'THB', 'MYR', 'PHP'];

  // `filtered` mirrors the visible options in DOM order; index 0 is always
  // the Auto row. activeIndex tracks keyboard focus inside `filtered`.
  var filtered = [];
  var activeIndex = -1;

  // Build the canonical list of currency entries from CURRENCY_NAMES, sorted
  // alphabetically by code. Symbols come from the curated CURRENCY_SYMBOLS map
  // (falling back to getCurrencySymbol for safety, which itself falls back).
  function getAllCurrencies() {
    var codes = Object.keys(CURRENCY_NAMES);
    codes.sort();
    var out = [];
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i];
      out.push({ code: code, sym: getCurrencySymbol(code) || code, name: CURRENCY_NAMES[code] });
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch];
    });
  }

  // Wrap the first case-insensitive substring match in <mark>, escape-safe.
  function highlightMatch(text, q) {
    if (!q) return escapeHtml(text);
    var i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, i)) +
      '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' +
      escapeHtml(text.slice(i + q.length));
  }

  function makeOptionId(code) {
    return 'currency-opt-' + code;
  }

  function renderList(query) {
    var q = (query || '').trim().toLowerCase();
    listbox.innerHTML = '';
    filtered = [];

    // ---- Build filtered Popular and All sections ----
    var all = getAllCurrencies();
    var popularSet = {};
    for (var p = 0; p < POPULAR.length; p++) popularSet[POPULAR[p]] = true;

    var popularItems = [];
    for (var pi = 0; pi < POPULAR.length; pi++) {
      var pcode = POPULAR[pi];
      if (!CURRENCY_NAMES[pcode]) continue;
      var pent = { code: pcode, sym: getCurrencySymbol(pcode) || pcode, name: CURRENCY_NAMES[pcode] };
      if (!q || pent.code.toLowerCase().indexOf(q) >= 0 || pent.name.toLowerCase().indexOf(q) >= 0) {
        popularItems.push(pent);
      }
    }

    var allOtherItems = [];
    for (var ai = 0; ai < all.length; ai++) {
      var a = all[ai];
      if (popularSet[a.code]) continue;
      if (!q || a.code.toLowerCase().indexOf(q) >= 0 || a.name.toLowerCase().indexOf(q) >= 0) {
        allOtherItems.push(a);
      }
    }

    // ---- Empty state (filter excludes everything except Auto) ----
    if (q && popularItems.length === 0 && allOtherItems.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'combobox-empty';
      empty.setAttribute('role', 'presentation');
      empty.textContent = 'No currencies match "' + query + '"';
      listbox.appendChild(empty);
      activeIndex = 0;
      refreshActive();
      return;
    }

    // ---- Render Popular section ----
    if (popularItems.length > 0) {
      var popHeader = document.createElement('li');
      popHeader.className = 'combobox-section';
      popHeader.setAttribute('role', 'presentation');
      popHeader.textContent = 'Popular';
      listbox.appendChild(popHeader);
      for (var pj = 0; pj < popularItems.length; pj++) {
        appendCurrencyOption(popularItems[pj], q);
      }
    }

    // ---- Render All currencies section ----
    if (allOtherItems.length > 0) {
      var allHeader = document.createElement('li');
      allHeader.className = 'combobox-section';
      allHeader.setAttribute('role', 'presentation');
      allHeader.textContent = 'All currencies';
      listbox.appendChild(allHeader);
      for (var aj = 0; aj < allOtherItems.length; aj++) {
        appendCurrencyOption(allOtherItems[aj], q);
      }
    }

    // Jump active focus to the first option (Auto-pinned-row was removed
    // when the persistent auto mode was deleted).
    activeIndex = filtered.length > 0 ? 0 : -1;
    refreshActive();
  }

  function appendCurrencyOption(c, q) {
    var li = document.createElement('li');
    li.className = 'combobox-option';
    li.id = makeOptionId(c.code);
    li.setAttribute('role', 'option');
    li.setAttribute('data-code', c.code);
    li.setAttribute('aria-selected', selectedCurrency === c.code ? 'true' : 'false');
    li.innerHTML =
      '<span class="sym">' + escapeHtml(c.sym) + '</span>' +
      '<span class="code">' + highlightMatch(c.code, q) + '</span>' +
      '<span class="name">' + highlightMatch(c.name, q) + '</span>';
    li.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      commit(c.code);
    });
    listbox.appendChild(li);
    filtered.push({ code: c.code });
  }

  function refreshActive() {
    var opts = listbox.querySelectorAll('.combobox-option');
    for (var i = 0; i < opts.length; i++) {
      opts[i].classList.toggle('active', i === activeIndex);
    }
    if (activeIndex >= 0 && opts[activeIndex]) {
      input.setAttribute('aria-activedescendant', opts[activeIndex].id);
      opts[activeIndex].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function open() {
    if (combobox.classList.contains('open')) return;
    combobox.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
    renderList('');
  }

  function close() {
    if (!combobox.classList.contains('open')) return;
    combobox.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
    // Restore the closed-state label from the committed selection so a
    // half-typed filter doesn't linger as the visible value.
    syncComboboxInputValue();
  }

  function commit(code) {
    selectedCurrency = code;
    currencyCode = code;
    syncComboboxInputValue();
    updatePricePrefix();
    // Persist + re-search — identical flow to the v1.0.2 change listener.
    chrome.storage.local.get('settings', function (data) {
      var settings = data.settings || {};
      settings.selectedCurrency = selectedCurrency;
      chrome.storage.local.set({ settings: settings });
    });
    if (allListings.length > 0 && form) {
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
    // Close without re-focusing — re-focusing on iOS would re-open the
    // dropdown and trap the user. Keyboard Enter naturally keeps focus.
    combobox.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  // ---- Wire events ----
  input.addEventListener('focus', function () {
    open();
    // Select all on focus so the next keystroke replaces the committed label
    // and starts a filter from scratch.
    input.select();
  });

  input.addEventListener('input', function () {
    if (!combobox.classList.contains('open')) {
      combobox.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }
    renderList(input.value);
  });

  input.addEventListener('keydown', function (e) {
    var isOpen = combobox.classList.contains('open');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) { open(); return; }
      activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
      refreshActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) { open(); return; }
      activeIndex = Math.max(activeIndex - 1, 0);
      refreshActive();
    } else if (e.key === 'Home') {
      if (!isOpen) return;
      e.preventDefault();
      activeIndex = 0;
      refreshActive();
    } else if (e.key === 'End') {
      if (!isOpen) return;
      e.preventDefault();
      activeIndex = filtered.length - 1;
      refreshActive();
    } else if (e.key === 'Enter') {
      if (!isOpen) return; // let the form's submit handler take over
      e.preventDefault();
      if (filtered[activeIndex]) commit(filtered[activeIndex].code);
    } else if (e.key === 'Escape') {
      if (!isOpen) return;
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Don't preventDefault — let Tab move focus naturally to the next field.
      if (isOpen) close();
    }
  });

  caret.addEventListener('click', function (e) {
    e.preventDefault();
    if (combobox.classList.contains('open')) {
      close();
    } else {
      input.focus();
      open();
    }
  });

  // Outside-click closes without committing.
  document.addEventListener('click', function (e) {
    if (!combobox.contains(e.target)) close();
  });

  // Seed initial value from resolved selection.
  syncComboboxInputValue();
}

function renderGmapsColumn(listing) {
  var el = document.createElement('span');
  el.className = 'result-gmaps';
  var state = listing.url ? xrefState[listing.url] : null;

  if (listing._googleData && listing._googleData.rating != null) {
    // Matched — always link (fallback to Maps search if no direct placeUrl)
    var gmapsUrl = listing._googleData.placeUrl ||
        'https://www.google.com/maps/search/' + encodeURIComponent(listing.name);
    var link = document.createElement('a');
    link.href = gmapsUrl;
    link.target = '_blank';
    var gReviews = listing._googleData.reviewCount || 0;
    if (gReviews < 10) {
      link.textContent = '★ (' + gReviews + ')';
      link.className = 'gmaps-link gmaps-low-reviews';
      link.setAttribute('data-tooltip', 'Too few Google reviews to be reliable');
    } else {
      link.textContent = listing._googleData.rating.toFixed(1) + '★ (' + gReviews + ')';
      var gTier = gmapsTier(listing._googleData.rating);
      link.className = 'gmaps-link gmaps-tier-' + gTier;
      if (listing._matchConfidence != null) {
        var confLabel = confidenceLabel(listing._matchConfidence);
        var tipText = listing._googleData.rating.toFixed(1) + ' on Google Maps (' + confLabel + ')';
        if (listing._anomalySignals && listing._anomalySignals.length > 0) {
          tipText += '\n⚠ ' + listing._anomalySignals.join(', ');
        }
        link.setAttribute('data-tooltip', tipText);
      }
    }
    link.onclick = function(e) { e.stopPropagation(); };
    el.appendChild(link);
  } else if (state === 'pending') {
    el.className += ' gmaps-pending';
    el.textContent = 'Pending';
  } else if (state === 'checking') {
    el.className += ' gmaps-checking';
    var spinner = document.createElement('span');
    spinner.className = 'gmaps-spinner';
    el.appendChild(spinner);
  } else if (state === 'eligible') {
    var checkBtn = document.createElement('button');
    checkBtn.className = 'xref-check-btn';
    checkBtn.textContent = 'Check';
    checkBtn.onclick = (function(lst) {
      return function(e) {
        e.stopPropagation();
        handleCheckClick(lst);
      };
    })(listing);
    el.appendChild(checkBtn);
  } else if (state === 'not-found' || state === 'failed') {
    el.className += ' gmaps-not-found';
    el.textContent = 'Not found';
  } else if (state !== 'na' && listing.platform !== 'airbnb') {
    // No xref state yet (outside auto-budget) — show Check button
    var fallbackBtn = document.createElement('button');
    fallbackBtn.className = 'xref-check-btn';
    fallbackBtn.textContent = 'Check';
    fallbackBtn.onclick = (function(lst) {
      return function(e) {
        e.stopPropagation();
        handleCheckClick(lst);
      };
    })(listing);
    el.appendChild(fallbackBtn);
  }

  return el;
}

// ---- Manual cross-reference check ----
function handleCheckClick(listing) {
  xrefState[listing.url] = 'checking';
  renderResults(allListings); // Re-render to show spinner

  chrome.runtime.sendMessage({
    type: 'searchXref',
    hotelName: listing.name,
    city: searchDestination,
    listingId: listing.url
  });
}

// ---- Rating floor and top picks (synced with tests/rating-floor.test.js) ----
function applyRatingFloor(listings, requestedFloor) {
  var floor = requestedFloor;
  var passed;
  while (floor > SCORING_CONFIG.RATING_FLOOR.MIN_FLOOR) {
    passed = listings.filter(function (l) {
      return l._normalizedRating != null && l._normalizedRating >= floor;
    });
    if (passed.length >= SCORING_CONFIG.RATING_FLOOR.MIN_RESULTS) {
      return { filtered: passed, effectiveFloor: floor, relaxed: floor < requestedFloor };
    }
    floor -= SCORING_CONFIG.RATING_FLOOR.STEP;
  }
  return { filtered: listings, effectiveFloor: 0, relaxed: requestedFloor > 0 };
}

function updateFloorIndicator(effectiveFloor, relaxed) {
  var checkbox = document.getElementById('top-rated-only');
  if (!checkbox) return;
  var label = checkbox.parentElement;

  if (effectiveFloor === 0) {
    // Floor disabled — uncheck and show generic label
    checkbox.checked = false;
    label.childNodes[label.childNodes.length - 1].textContent = ' Top Rated';
    label.removeAttribute('data-tooltip');
    return;
  }

  // Floor active — check and show effective value
  checkbox.checked = true;
  label.childNodes[label.childNodes.length - 1].textContent = ' Top Rated (' + effectiveFloor.toFixed(1) + '+)';
  if (relaxed) {
    label.setAttribute('data-tooltip', 'Adjusted \u2014 not enough highly-rated results');
  } else {
    label.removeAttribute('data-tooltip');
  }
}

// ---- Distance / centroid helpers ----
function haversineKm(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeCentroid(listings) {
  var sumLat = 0;
  var sumLng = 0;
  var count = 0;
  for (var i = 0; i < listings.length; i++) {
    var l = listings[i];
    if (l.lat == null || l.lng == null) continue;
    if (l.lat === 0 && l.lng === 0) continue;
    sumLat += l.lat;
    sumLng += l.lng;
    count++;
  }
  if (count === 0) return null;
  return { lat: sumLat / count, lng: sumLng / count };
}

// ---- Map functions ----
function getPinColor(listing) {
  var tier = getListingTier(listing);
  if (tier === 1) return '#d97706';
  return '#16a34a';
}

function createPinIcon(listing) {
  var color = getPinColor(listing);
  var price = listing._pricePerNight != null ? getCurrencySymbol(currencyCode) + formatPriceNumber(listing._pricePerNight) : '?';
  var anomalyCls = listing._anomaly ? ' pin-anomaly' : '';
  return L.divIcon({
    className: 'map-pin' + anomalyCls,
    html: '<div class="pin-label" style="background:' + color + '">' + price + '</div>',
    iconSize: [50, 22],
    iconAnchor: [25, 11]
  });
}

function highlightResultRow(url) {
  var prev = document.querySelector('.result-row.pin-highlighted');
  if (prev) prev.classList.remove('pin-highlighted');
  var row = document.querySelector('.result-row[data-listing-url="' + CSS.escape(url) + '"]');
  if (!row) return;
  row.classList.add('pin-highlighted');
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(function () { row.classList.remove('pin-highlighted'); }, 2000);
}

function highlightMapPin(url) {
  var marker = markersByUrl[url];
  if (!marker) return;
  var el = marker.getElement();
  if (el) {
    var label = el.querySelector('.pin-label');
    if (label) label.classList.add('pin-active');
    el.style.zIndex = 1000;
  }
}

function unhighlightMapPin(url) {
  var marker = markersByUrl[url];
  if (!marker) return;
  var el = marker.getElement();
  if (el) {
    var label = el.querySelector('.pin-label');
    if (label) label.classList.remove('pin-active');
    el.style.zIndex = '';
  }
}

function createPopupContent(listing) {
  var container = document.createElement('div');
  container.className = 'pin-popup';

  var nameEl = document.createElement('div');
  nameEl.className = 'pin-popup-name';
  var name = listing.name || 'Unknown';
  nameEl.textContent = name.length > 40 ? name.substring(0, 40) + '...' : name;
  container.appendChild(nameEl);

  var detailsEl = document.createElement('div');
  detailsEl.className = 'pin-popup-details';
  var parts = [];
  parts.push(platformLabel(listing.platform));
  if (listing._pricePerNight != null) parts.push(getCurrencySymbol(currencyCode) + formatPriceNumber(listing._pricePerNight) + '/night');
  if (listing.rating != null) parts.push(listing.rating.toFixed(1) + '/10');
  if (listing._anomaly) {
    parts.push('Anomaly');
  } else {
    parts.push('Trusted');
  }
  detailsEl.textContent = parts.join(' \u00b7 ');
  container.appendChild(detailsEl);

  return container;
}

function initMap() {
  mapInstance = L.map('map-container', {
    zoomControl: true,
    attributionControl: true
  }).setView([0, 0], 2);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd'
  }).addTo(mapInstance);

  mapLayerGroup = L.layerGroup().addTo(mapInstance);

  mapInstance.on('moveend', function () {
    if (!mapAutoFitting) {
      mapUserInteracted = true;
    }
  });
}

function syncMapPins(filtered) {
  if (!mapInstance || !mapVisible) return;

  mapLayerGroup.clearLayers();
  markersByUrl = {};

  var bounds = [];
  var mapped = 0;
  var total = filtered.length;

  for (var i = 0; i < filtered.length; i++) {
    var listing = filtered[i];
    if (listing.lat == null || listing.lng == null) continue;
    if (listing.lat === 0 && listing.lng === 0) continue;

    var marker = L.marker([listing.lat, listing.lng], {
      icon: createPinIcon(listing)
    });

    marker.bindPopup(createPopupContent(listing), { className: 'pin-popup-container', maxWidth: 250 });

    marker._listingUrl = listing.url;
    marker._listingData = listing;
    if (listing.url) markersByUrl[listing.url] = marker;

    marker.on('click', function (e) {
      highlightResultRow(e.target._listingUrl);
    });

    marker.addTo(mapLayerGroup);
    bounds.push([listing.lat, listing.lng]);
    mapped++;
  }

  var statusEl = document.getElementById('map-status');
  if (statusEl) {
    statusEl.textContent = mapped + ' of ' + total + ' listings mapped';
  }

  if (bounds.length > 0 && !mapUserInteracted) {
    mapAutoFitting = true;
    mapInstance.fitBounds(bounds, { padding: [30, 30] });
    setTimeout(function () { mapAutoFitting = false; }, 500);
  }
}

function toggleMap() {
  mapVisible = !mapVisible;

  var container = document.getElementById('map-container');
  var btn = document.getElementById('map-toggle-btn');

  if (container) container.style.display = mapVisible ? 'block' : 'none';
  if (btn) btn.textContent = mapVisible ? 'Hide Map' : 'Show Map';

  if (mapVisible) {
    if (!mapInstance) initMap();
    mapUserInteracted = false;
    mapInstance.invalidateSize();
    syncMapPins(lastFiltered);
  }
}

// Rating tier: based on Bayesian-smoothed score (what we sort by)
function ratingTier(listing) {
  var r = listing._bayesianRating != null ? listing._bayesianRating
    : listing._normalizedRating;
  if (r == null) return 0;
  if (r >= 9) return 5;
  if (r >= 8) return 4;
  if (r >= 7) return 3;
  if (r >= 6) return 2;
  return 1;
}

function gmapsTier(rating) {
  // Google Maps hotel ratings cluster 4.0-5.0 — use 7 tiers with
  // 0.2-point steps in the dense zone for visible gradient separation
  if (rating == null) return 0;
  if (rating >= 4.8) return 7;
  if (rating >= 4.6) return 6;
  if (rating >= 4.4) return 5;
  if (rating >= 4.2) return 4;
  if (rating >= 4.0) return 3;
  if (rating >= 3.5) return 2;
  return 1;
}

function renderResults(listings) {
  var container = document.getElementById('results');
  container.innerHTML = '';

  // Read Guest Favourite checkbox state fresh every render
  var gfEl = document.getElementById('guest-favourite-only');
  var filterGF = gfEl && gfEl.checked;
  var trEl = document.getElementById('top-rated-only');
  var filterTR = trEl && trEl.checked;

  // Apply price and GF filters
  var filtered = listings.filter(function (l) {
    // Hide listings with no price (no availability for selected dates)
    var filterPrice = l._pricePerNight != null ? l._pricePerNight : l.price;
    if (filterPrice == null) return false;
    // Price cap filter (per-night)
    if (maxPrice && !isNaN(maxPrice) && filterPrice > maxPrice) return false;
    // Guest Favourite filter (Airbnb only, when checked)
    if (filterGF && l.platform === 'airbnb' && !(l.badges && l.badges.isGuestFavorite)) return false;
    return true;
  });

  // Rating floor — only run when there's something to act on. Skipping
  // when filtered is empty avoids silently un-checking Top Rated when the
  // price/GF filter alone emptied the result set.
  if (filtered.length > 0) {
    var floorResult = applyRatingFloor(filtered, ratingFloorValue);
    filtered = floorResult.filtered;
    updateFloorIndicator(floorResult.effectiveFloor, floorResult.relaxed);
  }
  var centroid = computeCentroid(listings);
  lastFiltered = filtered;

  if (filtered.length === 0) {
    var emptyEl = document.createElement('div');
    emptyEl.className = 'results-empty';
    if (listings.length === 0) {
      emptyEl.textContent = 'No results found';
    } else {
      var labelBits = [];
      if (filterGF) labelBits.push('Guest Favourite');
      if (filterTR) labelBits.push('Top Rated');
      var subject = labelBits.length ? 'No ' + labelBits.join(' / ') + ' results' : 'No results';
      var suffix = (maxPrice && !isNaN(maxPrice))
        ? ' under ' + getCurrencySymbol(currencyCode) + formatPriceNumber(maxPrice) + '/night'
        : '';
      emptyEl.textContent = subject + suffix;
    }
    container.appendChild(emptyEl);
    var mapToolbarEmpty = document.getElementById('map-toolbar');
    if (mapToolbarEmpty) mapToolbarEmpty.style.display = 'none';
    return;
  }

  // Column header
  var header = document.createElement('div');
  header.className = 'column-header';
  var cols = [
    { label: '', cls: '', sortKey: null },
    { label: filtered.length + ' results', cls: '', sortKey: 'name' },
    { label: 'Dist', cls: 'header-distance', sortKey: 'distance' },
    { label: 'Price', cls: 'header-price', sortKey: 'price' },
    { label: 'Rating', cls: 'header-rating', sortKey: 'rating' },
    { label: 'Google Maps', cls: 'header-gmaps', sortKey: null }
  ];
  for (var c = 0; c < cols.length; c++) {
    var col = document.createElement('span');
    var sortClass = '';
    if (cols[c].sortKey && currentSort.column === cols[c].sortKey) {
      sortClass = currentSort.direction === 'asc' ? ' sort-asc' : ' sort-desc';
    }
    col.className = 'column-header-cell' + (cols[c].cls ? ' ' + cols[c].cls : '') + sortClass;
    col.textContent = cols[c].label;
    if (cols[c].sortKey) {
      col.setAttribute('data-sort-key', cols[c].sortKey);
      col.onclick = (function (key) {
        return function () { toggleSort(key); };
      })(cols[c].sortKey);
    }
    header.appendChild(col);
  }
  container.appendChild(header);

  // Compute price tiers (quintiles) for colour coding
  var filteredPrices = [];
  for (var fp = 0; fp < filtered.length; fp++) {
    var fpVal = filtered[fp]._pricePerNight != null ? filtered[fp]._pricePerNight : filtered[fp].price;
    if (fpVal != null) filteredPrices.push(fpVal);
  }
  filteredPrices.sort(function (a, b) { return a - b; });
  function priceTier(p) {
    if (p == null || filteredPrices.length === 0) return 0;
    var rank = 0;
    for (var k = 0; k < filteredPrices.length; k++) { if (filteredPrices[k] <= p) rank = k; }
    var pct = rank / (filteredPrices.length - 1 || 1);
    if (pct <= 0.2) return 1;
    if (pct <= 0.4) return 2;
    if (pct <= 0.6) return 3;
    if (pct <= 0.8) return 4;
    return 5;
  }
  // Rating tier: defined at module scope (used by both renderResults and updateCardsInPlace)

  for (var i = 0; i < filtered.length; i++) {
    var listing = filtered[i];
    var row = document.createElement('div');
    row.className = 'result-row';
    row.setAttribute('data-listing-url', listing.url || '');
    row.setAttribute('role', 'link');
    row.setAttribute('tabindex', '0');
    var ariaParts = [];
    ariaParts.push(platformLabel(listing.platform));
    ariaParts.push(listing.name || 'Unknown');
    if (listing._pricePerNight != null) ariaParts.push(getCurrencySymbol(currencyCode) + formatPriceNumber(listing._pricePerNight) + ' per night');
    if (listing.rating != null) ariaParts.push('rating ' + listing.rating + (listing.platform === 'airbnb' ? ' out of 5' : ' out of 10'));
    if (listing._anomaly) ariaParts.push('flagged for review pattern anomaly');
    row.setAttribute('aria-label', ariaParts.join(', ') + '. Opens in new tab.');

    // Hover deferral listeners + map pin highlight
    row.addEventListener('mouseenter', function () {
      hoverLocked = true;
      var url = this.getAttribute('data-listing-url');
      if (url) highlightMapPin(url);
    });
    row.addEventListener('mouseleave', function () {
      hoverLocked = false;
      var url = this.getAttribute('data-listing-url');
      if (url) unhighlightMapPin(url);
      if (pendingRerank) {
        var fn = pendingRerank;
        pendingRerank = null;
        fn();
      }
    });

    // Platform badge(s)
    var badgeContainer = document.createElement('span');
    badgeContainer.className = 'badge-container';
    if (listing._otherPrices && listing._otherPrices.length > 1) {
      // Grouped listing — show badges for all platforms
      for (var bp = 0; bp < listing._otherPrices.length; bp++) {
        var b = document.createElement('span');
        var plat = listing._otherPrices[bp].platform;
        b.className = 'platform-badge badge-' + plat + ' badge-mini';
        b.textContent = platformLabel(plat);
        b.setAttribute('data-tooltip', platformNames[plat] || platformLabel(plat));
        badgeContainer.appendChild(b);
      }
    } else {
      var badge = document.createElement('span');
      badge.className = 'platform-badge badge-' + listing.platform;
      badge.textContent = platformLabel(listing.platform);
      badge.setAttribute('data-tooltip', platformNames[listing.platform] || platformLabel(listing.platform));
      badgeContainer.appendChild(badge);
    }
    row.appendChild(badgeContainer);

    // Name + anomaly warning + map pin (icons must be SIBLINGS of nameEl,
    // not children — nameEl has overflow:hidden for ellipsis, which would
    // clip the icons' tooltip ::after pseudos).
    var nameCell = document.createElement('span');
    nameCell.className = 'result-name-cell';
    var nameEl = document.createElement('span');
    nameEl.className = 'result-name';
    nameEl.textContent = listing.name || 'Unknown';
    nameCell.appendChild(nameEl);
    if (listing._anomaly) {
      var warn = document.createElement('span');
      warn.className = 'anomaly-warn';
      warn.innerHTML = '<svg class="icon-warn" viewBox="0 0 128 128" aria-hidden="true">' +
        '<path d="M64 14 L118 110 L10 110 Z" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/>' +
        '<line x1="64" y1="50" x2="64" y2="80" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>' +
        '<circle cx="64" cy="98" r="6" fill="currentColor"/>' +
      '</svg>';
      var anomalyText = (listing._anomalySignals || []).join(', ');
      if (anomalyText) {
        warn.setAttribute('data-tooltip', anomalyText);
        warn.setAttribute('aria-label', 'Anomaly signals: ' + anomalyText);
      } else {
        warn.setAttribute('aria-label', 'Flagged for review pattern anomaly');
      }
      nameCell.appendChild(warn);
      row.className += ' anomaly-flagged';
    }
    if (listing.lat != null && listing.lng != null) {
      var pin = document.createElement('span');
      pin.className = 'map-pin-icon';
      pin.innerHTML = '<svg class="icon-pin" viewBox="0 0 128 128" aria-hidden="true">' +
        '<path d="M64 12 C42 12 26 28 26 50 C26 80 64 116 64 116 C64 116 102 80 102 50 C102 28 86 12 64 12 Z" ' +
        'fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/>' +
        '<circle cx="64" cy="50" r="14" fill="none" stroke="currentColor" stroke-width="8"/>' +
      '</svg>';
      pin.setAttribute('data-tooltip', 'Show on map');
      pin.setAttribute('role', 'button');
      pin.setAttribute('tabindex', '0');
      pin.setAttribute('aria-label', 'Show ' + (listing.name || 'this listing') + ' on map');
      var openOnMap = (function (lat, lng, url) {
        return function (e) {
          e.stopPropagation();
          if (!mapVisible) toggleMap();
          var mapEl = document.getElementById('map-container');
          if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (mapInstance) mapInstance.setView([lat, lng], 16);
          var marker = url ? markersByUrl[url] : null;
          if (marker && typeof marker.openPopup === 'function') marker.openPopup();
        };
      })(listing.lat, listing.lng, listing.url);
      pin.onclick = openOnMap;
      pin.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOnMap(e); }
      };
      nameCell.appendChild(pin);
    }
    row.appendChild(nameCell);

    // Distance from centroid
    var distEl = document.createElement('span');
    distEl.className = 'result-distance';
    if (centroid && listing.lat != null && listing.lng != null && !(listing.lat === 0 && listing.lng === 0)) {
      var dist = haversineKm(centroid.lat, centroid.lng, listing.lat, listing.lng);
      listing._distanceKm = dist;
      distEl.textContent = dist.toFixed(1) + ' km';
    } else {
      listing._distanceKm = null;
    }
    row.appendChild(distEl);

    // Price — show multi-platform prices for grouped listings
    var priceEl = document.createElement('span');
    var pt = priceTier(listing._pricePerNight != null ? listing._pricePerNight : listing.price);
    priceEl.className = 'result-price' + (pt ? ' price-tier-' + pt : '');
    if (listing._otherPrices && listing._otherPrices.length > 1) {
      priceEl.textContent = formatPrice(listing);
      // Build tooltip with all platform prices
      var priceParts = [];
      for (var pp = 0; pp < listing._otherPrices.length; pp++) {
        var op = listing._otherPrices[pp];
        var platLabel = platformLabel(op.platform);
        if (op.pricePerNight != null) {
          priceParts.push(platLabel + ' ' + getCurrencySymbol(currencyCode) + formatPriceNumber(op.pricePerNight) + '/night');
        }
      }
      if (priceParts.length > 0) priceEl.setAttribute('data-tooltip', priceParts.join(' · '));
    } else {
      priceEl.textContent = formatPrice(listing);
      var totalTip = formatPriceTotal(listing);
      if (totalTip) priceEl.setAttribute('data-tooltip', totalTip);
    }
    row.appendChild(priceEl);

    // Rating
    var ratingEl = document.createElement('span');
    var rt = ratingTier(listing);
    var isFewReviews = !!listing._fewReviews;
    ratingEl.className = 'result-rating' + (rt ? ' rating-tier-' + rt : '') + (isFewReviews ? ' few-reviews' : '');
    ratingEl.textContent = formatRating(listing);
    // Tooltip: always show score breakdown
    var tipLines = [];
    var scale = (listing.platform === 'booking' || listing.platform === 'agoda') ? '/10' : '/5';
    tipLines.push('Platform: ' + listing.rating + scale + ' (' + listing.reviewCount + ' reviews)');
    if (isFewReviews) tipLines.push('⚠ Few reviews — rating adjusted toward average');
    if (listing._normalizedRating != null) tipLines.push('Normalized: ' + listing._normalizedRating.toFixed(1));
    if (listing._blendResult && listing._blendResult.changed) tipLines.push('Blended: ' + listing._blendResult.blended.toFixed(1));
    if (listing._bayesianRating != null) tipLines.push('Bayesian: ' + listing._bayesianRating.toFixed(2));
    ratingEl.setAttribute('data-tooltip', tipLines.join('\n'));
    row.appendChild(ratingEl);

    // Google Maps / cross-ref column
    row.appendChild(renderGmapsColumn(listing));

    // Click + keyboard handlers (role=link with tabindex=0)
    row.onclick = (function (url) {
      return function () {
        window.open(url, '_blank');
      };
    })(listing.url);
    row.onkeydown = (function (url) {
      return function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.open(url, '_blank');
        }
      };
    })(listing.url);

    container.appendChild(row);

    // Dedup sub-row: show links to all platforms for grouped listings
    if (listing._otherPrices && listing._otherPrices.length > 1) {
      var subRow = document.createElement('div');
      subRow.className = 'dedup-row';
      var label = document.createElement('span');
      label.className = 'dedup-label';
      label.textContent = 'Also on:';
      subRow.appendChild(label);
      // Sort cheapest first
      var sortedPrices = listing._otherPrices.slice().sort(function (a, b) {
        var ap = a.pricePerNight != null ? a.pricePerNight : Infinity;
        var bp = b.pricePerNight != null ? b.pricePerNight : Infinity;
        return ap - bp;
      });
      for (var dp = 0; dp < sortedPrices.length; dp++) {
        var op = sortedPrices[dp];
        var link = document.createElement('a');
        link.className = 'dedup-link badge-' + op.platform;
        link.setAttribute('data-tooltip', platformNames[op.platform] || platformLabel(op.platform));
        link.href = op.url || '#';
        link.target = '_blank';
        var platLabel = platformLabel(op.platform);
        var priceLabel = op.pricePerNight != null ? ' ' + getCurrencySymbol(currencyCode) + formatPriceNumber(op.pricePerNight) + '/night' : '';
        link.textContent = platLabel + priceLabel;
        link.onclick = function(e) { e.stopPropagation(); };
        subRow.appendChild(link);
      }
      container.appendChild(subRow);
    }
  }

  // Map sync
  if (mapVisible && mapInstance) {
    syncMapPins(filtered);
  }
  // Show map toolbar when results exist
  var mapToolbar = document.getElementById('map-toolbar');
  if (mapToolbar) mapToolbar.style.display = filtered.length > 0 ? 'flex' : 'none';
}

// ---- In-place card update (no re-ordering) ----
function updateCardsInPlace(listings) {
  var container = document.getElementById('results');
  var rows = container.querySelectorAll('.result-row');
  for (var r = 0; r < rows.length; r++) {
    var url = rows[r].getAttribute('data-listing-url');
    if (!url) continue;
    var listing = null;
    for (var i = 0; i < listings.length; i++) {
      if (listings[i].url === url) { listing = listings[i]; break; }
    }
    if (!listing) continue;

    var oldGmaps = rows[r].querySelector('.result-gmaps');
    if (oldGmaps) {
      oldGmaps.parentNode.replaceChild(renderGmapsColumn(listing), oldGmaps);
    }

    // Update rating text and tooltip (blending may have changed after xref)
    var ratingEl = rows[r].querySelector('.result-rating');
    if (ratingEl) {
      ratingEl.textContent = formatRating(listing);
      var rt = ratingTier(listing);
      ratingEl.className = 'result-rating' + (rt ? ' rating-tier-' + rt : '');
      var tipLines = [];
      var scale = (listing.platform === 'booking' || listing.platform === 'agoda') ? '/10' : '/5';
      tipLines.push('Platform: ' + listing.rating + scale + ' (' + listing.reviewCount + ' reviews)');
      if (listing._normalizedRating != null) tipLines.push('Normalized: ' + listing._normalizedRating.toFixed(1));
      if (listing._blendResult && listing._blendResult.changed) tipLines.push('Blended: ' + listing._blendResult.blended.toFixed(1));
      if (listing._bayesianRating != null) tipLines.push('Bayesian: ' + listing._bayesianRating.toFixed(2));
      ratingEl.setAttribute('data-tooltip', tipLines.join('\n'));
    }
  }
}

// ---- Animated re-ranking ----
function renderResultsAnimated(listings) {
  // If hover-locked, update card content in-place but defer re-ordering
  if (hoverLocked) {
    updateCardsInPlace(listings);
    pendingRerank = function () {
      renderResultsAnimated(listings);
    };
    return;
  }

  var container = document.getElementById('results');

  // Record current positions of all result rows
  var oldPositions = {};
  var rows = container.querySelectorAll('.result-row');
  for (var r = 0; r < rows.length; r++) {
    var url = rows[r].getAttribute('data-listing-url');
    if (url) {
      oldPositions[url] = rows[r].getBoundingClientRect().top;
    }
  }

  // Re-render in new order
  renderResults(listings);

  // Apply FLIP animation
  var newRows = container.querySelectorAll('.result-row');
  for (var n = 0; n < newRows.length; n++) {
    var newUrl = newRows[n].getAttribute('data-listing-url');
    if (newUrl && oldPositions[newUrl] !== undefined) {
      var newTop = newRows[n].getBoundingClientRect().top;
      var delta = oldPositions[newUrl] - newTop;
      if (Math.abs(delta) > 1) {
        newRows[n].style.transform = 'translateY(' + delta + 'px)';
        newRows[n].style.transition = 'none';
        // Force reflow
        newRows[n].offsetHeight; // eslint-disable-line no-unused-expressions
        newRows[n].style.transition = 'transform 0.3s ease-out';
        newRows[n].style.transform = 'translateY(0)';
      }
    }
  }
}
