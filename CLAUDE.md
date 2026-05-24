# Sift — Cross-platform accommodation search Chrome extension

## Project structure
- `src/search/` — search UI (search.js, search.html, search.css)
- `src/background/service-worker.js` — tab management, scrapers, xref queue
- `src/shared/scoring.js` — scoring, name matching, anomaly detection
- `src/shared/scoring-config.js` — all numeric thresholds (frozen config)
- `src/popup/` — extension popup
- `src/content/` — content scripts (Google Maps inject)
- `tests/` — node:test behavioral tests
- `dev/` — local visual review mock (see "Visual review" section below)

## Running tests
```
node --test tests/*.test.js
```

## Visual review (local browser, no extension reload)
- `dev/search-mock.html` loads the real `src/search/*` files against stubbed
  `chrome.*` APIs + fixture data. Renders the search results state without
  needing to pack and load the extension.
- Run: `python3 -m http.server 8000` from repo root, then open
  `http://localhost:8000/dev/search-mock.html`.
- `gsd-ui-review` will auto-detect this dev server when `mcp__playwright__*`
  tools are available.
- Edit `dev/mock-data.js` to add edge cases (anomaly states, currency
  variants, dedup scenarios, etc.).
- See `dev/README.md` for full details.

## Development workflow
- Write behavioral tests FIRST for expected outcomes, then implement
- Tests define what "correct" looks like — prevents regressions
- Run all tests before committing: all 298+ must pass
- Test file per domain: scoring.test.js, scraper.test.js, url-builders.test.js, etc.

## Key conventions
- All JS uses `var` (no let/const in content scripts for broad compat)
- Service worker uses `const/let` (modern context)
- Scoring thresholds live in scoring-config.js, never hardcoded
- CSS tooltips via `data-tooltip` attribute (native title doesn't work in extension popups)
- Platform scale: Booking/Agoda = 0-10, Airbnb = 0-5 (normalized to 0-10)

## Architecture
- Three search platforms: Booking.com, Airbnb, Agoda
- Google Maps = cross-reference trust signal (not a primary source)
- Deduplication groups same property across platforms via nameMatchConfidence()
- Price normalization: all prices converted to per-night internally
- Scrapers run in hidden tabs, results merged in search.js
