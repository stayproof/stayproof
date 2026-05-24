# StayProof

**Compare hotels across Booking, Airbnb, and Agoda — with trust signals that flag fake-looking ratings.**

[Chrome Web Store](https://chromewebstore.google.com/detail/stayproof) &nbsp;·&nbsp; MIT License

## Install

**From source:**

```bash
git clone https://github.com/stayproof/stayproof.git
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the cloned directory

## What it does

- **One search, three platforms** — Booking, Airbnb, and Agoda results on one page
- **Cross-platform deduplication** — recognizes the same property across sites via fuzzy name matching, so you see "£120 on Booking vs £98 on Agoda" at a glance
- **Price normalization** — all prices shown per-night, currency-converted
- **Trust signals** — statistical anomaly detection on review distributions flags suspect ratings
- **Bayesian-adjusted scoring** — normalizes ratings across platform scales (Booking/Agoda 0–10, Airbnb 0–5) and adjusts for review count
- **Google Maps cross-reference** — surfaces independent rating data and cross-checks review volume

## How we detect fake reviews

Transparency is the product. Here is exactly what the extension computes — and where:

- **Statistical anomaly detection** — [`reviewDistributionAnomaly()`](src/shared/scoring.js) measures Jensen-Shannon divergence of the star-count distribution against real luxury hotel benchmarks. Legitimate hotels have a natural distribution; fake-review spam creates a hollow-middle spike pattern.
- **Bimodal spike detection** — [`bimodalityCoefficient()`](src/shared/scoring.js) flags the extreme-spike / hollow-middle signature characteristic of coordinated fake reviews.
- **Bayesian-adjusted cross-platform scoring** — [`src/shared/scoring.js`](src/shared/scoring.js) blends ratings across platforms using a credibility curve that down-weights properties with very few reviews.
- **Google Maps cross-reference** — [`selectXrefCandidates()`](src/shared/xref-candidates.js) decides which listings get automatic Google Maps lookups; a large divergence between the booking-platform rating and the Google Maps rating is an anomaly signal.
- **Cross-platform deduplication** — [`nameMatchConfidence()`](src/shared/name-matching.js) and [`softTfIdfScore()`](src/shared/name-matching.js) use Soft TF-IDF with Jaro-Winkler token matching to identify the same property across Booking, Airbnb, and Agoda.
- **Every external HTTP call is visible** — all scraper logic is in [`src/background/service-worker.js`](src/background/service-worker.js). The extension makes no calls beyond Booking, Airbnb, Agoda, and Google Maps.

## Project layout

| Path | Role |
|------|------|
| `src/search/` | Search UI (search.html, search.js, search.css) |
| `src/background/service-worker.js` | Tab management, scrapers, xref queue |
| `src/shared/scoring.js` | Trust scoring, anomaly detection, Bayesian model |
| `src/shared/scoring-config.js` | All numeric thresholds (frozen config object) |
| `src/shared/name-matching.js` | Cross-platform fuzzy name matching |
| `src/shared/xref-candidates.js` | Google Maps cross-reference candidate selection |
| `src/popup/` | Extension popup |
| `src/content/` | Content scripts (Google Maps inject) |
| `tests/` | `node:test` behavioral tests |
| `dev/` | Local visual review mock (stubbed chrome.* APIs + fixtures) |

## Run tests

```bash
node --test tests/*.test.js
```

722 behavioral tests, no build step required.

## Privacy

All data stays on your device. No StayProof servers, no analytics, no tracking. The only external calls are to Booking, Airbnb, Agoda, and Google Maps — every one is visible in [`src/background/service-worker.js`](src/background/service-worker.js).

See [privacy.html](privacy.html) for the full privacy policy.

## Status

Maintained as time allows. Scrapers break as Booking/Airbnb/Agoda update their sites — that is normal. PRs welcome; no SLA on review time.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
