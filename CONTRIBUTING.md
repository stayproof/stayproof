# Contributing to StayProof

Thanks for taking an interest. StayProof is maintained as time allows — scrapers break
as the platforms evolve, PRs are welcome, no SLA.

---

## Dev setup

Zero dependencies. No build step.

```
git clone https://github.com/stayproof/stayproof.git
cd stayproof
```

Load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** and select the repo root

That's it — the extension is live.

---

## Run tests

```
node --test tests/*.test.js
```

722 tests, no build step. All must pass before submitting a PR.

---

## Dev visual review

To iterate on the search UI without reloading the extension:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/dev/search-mock.html` in a browser.

This loads the real `src/search/*` files against simulated `chrome.*` APIs and fixture
data from `dev/mock-data.js`. Useful for testing display edge cases (anomaly states,
currency variants, dedup scenarios) without a live scrape.

See `dev/README.md` for details.

---

## Submitting a PR

1. Fork the repo and create a branch off `main`
2. Make your change, run the tests
3. Open a PR against `main`

For scraper changes, test against a live search in addition to the unit tests (scrapers
break when platforms change their markup).

For scoring changes, add or update tests in `tests/scoring.test.js`.

---

## Reporting bugs and requesting features

Use the GitHub Issues template chooser:
**<https://github.com/stayproof/stayproof/issues/new/choose>**

Available templates (`.github/ISSUE_TEMPLATE/`):

- **Bug report** — broken scraper, display issue, or other malfunction
- **Feature request** — suggest a new capability or improvement
- **Incorrect or missed rating** — StayProof flagged a property incorrectly, or missed
  one that looks suspicious

---

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability reporting flow.
Do not open a public issue for security problems.

---

## CWS release (maintainer only)

Build the Chrome Web Store upload artifact:

```
bash scripts/package.sh
```

This produces `dist/stayproof-v<version>.zip` (version defaults to `manifest.json`).
Upload that zip manually to the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).
There is no publish script — the upload is manual.

---

## Code style

| Area | Convention |
|------|-----------|
| Content script files (`src/content/`) | `var` — broad browser compatibility; content scripts share page-level scope where `const` is not globally accessible |
| Service worker (`src/background/service-worker.js`) | `const`/`let` — modern module context |
| Tests | `node:test` built-in — no external test runner required |
| Scoring thresholds | Live in `src/shared/scoring-config.js`, never hardcoded inline |

See `CLAUDE.md` at the repo root for the full conventions reference.
