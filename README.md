# StayProof

**Compare the same hotel across Booking, Airbnb, and Agoda — with trust signals that flag fake-looking ratings.**

One search bar hits all three platforms, deduplicates properties that appear on multiple sites, and shows prices side-by-side. Google Maps is used as a cross-reference, and statistical anomaly detection on the review distribution flags suspect ratings.

## Status

Published as a reference implementation. **Not actively maintained** — scrapers against live sites break every few months as the platforms evolve. PRs welcome, but no guarantees on review time.

## What it does

- **One search, three platforms** — Booking, Airbnb, and Agoda results on one page
- **Cross-platform deduplication** — recognizes the same property across sites via fuzzy name matching, so you see "£120 on Booking vs £98 on Agoda" at a glance
- **Price normalization** — all prices shown per-night, currency-converted to USD
- **Trust signals** — Google Maps cross-reference surfaces review anomalies (distribution shape, star-pair inversions, volume-aware outliers)
- **Bayesian-adjusted scoring** — normalizes ratings across platform scales (Booking/Agoda 0–10, Airbnb 0–5) and adjusts for review count

## Install

**From source:**
```bash
git clone https://github.com/stayproof/stayproof.git
```
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the repo folder

## Run tests

```bash
node --test tests/*.test.js
```
~680 behavioral tests, no build step required.

## Project layout

- `src/search/` — search UI
- `src/background/service-worker.js` — tab management, scrapers, xref queue
- `src/shared/scoring.js` — scoring, name matching, anomaly detection
- `src/shared/scoring-config.js` — all numeric thresholds (frozen config)
- `src/popup/` — extension popup
- `src/content/` — content scripts (Google Maps inject)
- `tests/` — `node:test` behavioral tests

## Privacy

All data stays on your device. No StayProof servers, no analytics, no tracking. The only external calls are to Airbnb/Agoda autocomplete APIs for place resolution during search.

## License

MIT — see [LICENSE](LICENSE).
