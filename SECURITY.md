# Security Policy

## Scope

This policy covers vulnerabilities in **StayProof's own code only** — the files in this
repository (`src/`, `manifest.json`, and vendored dependencies under `src/vendor/`).

**Not in scope:**

- Vulnerabilities in Booking.com, Airbnb, Agoda, or Google Maps themselves — report those
  directly to those platforms.
- Issues with the platforms' APIs, review data, or rating systems.
- General browser or Chrome extension platform bugs.

## Supported Versions

Only the latest release is actively maintained. No security fixes are backported to older versions.

## Reporting a Vulnerability

Please use GitHub's Private Vulnerability Reporting to submit security issues privately.

**Use the "Report a vulnerability" button on the Security tab:**
<https://github.com/stayproof/stayproof/security>

Or go directly to the report form:
<https://github.com/stayproof/stayproof/security/advisories/new>

No email channel is used for security reports. Private Vulnerability Reporting keeps your
report confidential until a fix is published.

## What to Expect

This is a solo-maintained open-source project. Response is best-effort — I aim to acknowledge
reports within a few days, but cannot commit to a fixed SLA.

Please do not publicly disclose the vulnerability until it has been patched, or until 90 days
have passed since you reported it, whichever comes first.

## What to Report

Examples of in-scope issues:

- Data-leak vectors that expose user search queries or browsing activity beyond what the
  extension's stated permissions require.
- CSP, permissions, or sandboxing weaknesses that could allow a compromised scraper tab to
  access sensitive extension state.
- Supply-chain concerns in vendored dependencies (e.g. Leaflet under `src/vendor/`).
- Injection vulnerabilities in scraped content reaching the extension's UI.

## Out of Scope

The following are explicitly out of scope for this project:

- Vulnerabilities in Booking.com, Airbnb, Agoda, or Google Maps sites or their data — report
  those to those platforms directly (Booking.com Bug Bounty, Airbnb Bug Bounty, etc.).
- Issues that require physical access to the user's device.
- Theoretical attacks with no demonstrated exploit path.
