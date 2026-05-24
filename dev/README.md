# Local visual review mock

A lightweight static page that loads the real `src/search/search.{html,css,js}`
against stubbed `chrome.*` APIs and a small fixture dataset. Lets you test the
UI without packing/loading the extension in Chrome — and lets `gsd-ui-review`
drive Playwright against a real URL.

## Run it

```bash
# from repo root
python3 -m http.server 8000
# then open http://localhost:8000/dev/search-mock.html
```

Or any equivalent static server (`npx serve .`, `caddy file-server`, etc.).
The mock auto-fills "ubud, bali" and clicks Search 60ms after DOMContentLoaded
so screenshots capture the rendered results state, not the empty form.

## What it stubs

`chrome-stub.js` (loaded before all real scripts) provides:

- `chrome.storage.local.{get,set,remove}` — backed by `sessionStorage`
- `chrome.runtime.onMessage.{addListener,removeListener,hasListener}` — pubsub
- `chrome.runtime.sendMessage` — synthesizes the `searchProgress` +
  `searchResults` flow from `window.MOCK_LISTINGS_BY_PLATFORM`, and the
  `searchXrefResult` flow from `window.MOCK_XREF_BY_URL`
- `chrome.runtime.getManifest` — returns `window.MOCK_MANIFEST`
- `chrome.tabs`, `chrome.alarms` — no-op shims

`mock-data.js` is the source of fixtures. Edit it freely to add edge cases
(empty results, all anomalies, only 1 platform returns, gigantic listing
counts, currency = JPY, etc.). Listings hit the real `scoreAndRankListings`
pipeline so anomaly detection / dedup / Bayesian / few-reviews flags compute
the same way they do in production.

## What it does NOT cover

- The popup (`src/popup/`) — separate surface
- The service worker (`src/background/service-worker.js`) — entirely stubbed
- Real platform scrapers in `src/content/*` — never invoked
- Anything that depends on actual `chrome://` permissions (host_permissions,
  scripting.executeScript, etc.) — those throw silently in the stub

## Visual review via gsd-ui-review

`gsd-ui-review` can drive Playwright against this mock automatically once
the Playwright MCP server is registered with Claude Code.

### One-time install

```bash
# user scope = available in every project, stored in ~/.claude.json
# --browser chromium = use the cached Chromium Playwright downloads itself,
# instead of system Chrome (which would require `sudo npx playwright install chrome`)
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --browser chromium

# then restart Claude Code so the new MCP args load
```

First-call download: when a Claude session first uses
`mcp__playwright__*`, it downloads Chromium (~150MB) into
`~/Library/Caches/ms-playwright/`. 30-60s one-time pause, then cached.

Verify install: `claude mcp get playwright` should show
`Args: -y @playwright/mcp@latest --browser chromium`.

If you previously installed without `--browser chromium`, the MCP will fail
with `Chromium distribution 'chrome' is not found at /Applications/Google
Chrome.app/...`. Fix:

```bash
claude mcp remove playwright -s user
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --browser chromium
# then restart Claude Code
```

### Per-session workflow

```bash
# in one terminal — leave running
python3 -m http.server 8000

# in Claude (with playwright MCP loaded)
/gsd-ui-review the search surface — drive http://localhost:8000/dev/search-mock.html
```

The auditor scans common dev ports (`:3000`/`:5173`/`:8080`/`:8000`) and
will pick up the mock automatically. It then captures the states listed
below and produces a UI-REVIEW.md with screenshots embedded.

### States the visual review should cover

(Add a `dev/states.md` checklist when this list grows beyond ~5 entries.)

- Initial render with results
- Currency combobox open, all 50+ currencies visible
- Currency combobox with "ph" typed, filtered to Philippine Peso match
- Hover the ⚠ anomaly icon → tooltip shows full signal list
- Hover the 📍 map pin icon → tooltip shows "Show on map"
- Click 📍 → map opens with marker popup
- Hover any rating cell → score breakdown tooltip
- Empty results state ("No Guest Favourite results under £X/night")

### Manual fallback

If Playwright MCP isn't installed (or isn't working in a session), take
screenshots manually and paste them into the conversation. Claude is
multimodal and reviews images directly. Slower than automated capture
but no setup overhead.

### CWS-capture mode

For Chrome Web Store submission screenshots (different deliverable from
the dev review above), append `?cws=1` to the URL:

```
http://localhost:8000/dev/search-mock.html?cws=1
```

The flag hides dev-only chrome (the `v0.0.0-mock` version badge) so the
capture matches the real extension popup. Run Playwright at **1280×800**
to match the CWS spec — the dev-review 1440×900 won't satisfy the store
upload form. Up to 5 screenshots per listing; choose states that sell
the trust angle from `launch-checklist.md` rather than edge cases.

## Future work (intentionally not done yet)

- **CI visual regression** via Playwright + GitHub Actions. Adds ~50KB of
  baseline PNGs per state and false-positive tuning overhead. Skip until the
  visual review actually catches enough regressions to justify the maintenance.
- **More fixture variety** — add when a specific edge case is missing (the
  current set covers ~10 listings exercising rating tiers, anomaly, few-reviews,
  long names, missing coords, cross-platform dedup, gmaps states).
